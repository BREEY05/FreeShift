import type { ConflictDetail, Parity, Semester, Weekday } from '@freeshift/shared';
import { all, type SqlValue } from '../db/index.ts';
import { AppError } from '../lib/errors.ts';
import { expandWeeks } from './occurrence.ts';

export interface ConflictQuery {
  semester: Pick<Semester, 'id' | 'week1Parity' | 'totalWeeks'>;
  userId: number;
  weekday: number;
  slotIds: number[];
  startWeek: number;
  endWeek: number;
  parity: Parity;
  excludeScheduleId?: number | null;
}

interface ConflictRow {
  week_no: number;
  weekday: number;
  slot_id: number;
  schedule_id: number;
  start_week: number;
  end_week: number;
  parity: Parity;
  note: string;
  label: string;
}

/**
 * 冲突检测：同一用户 + 同一学期 + 同一 week_no + weekday + slot_id 已有占用。
 * 基于 schedule_occurrence 查询，返回可直接作为 409 details 的明细。
 */
export function detectConflicts(query: ConflictQuery): ConflictDetail[] {
  const slotIds = Array.from(new Set(query.slotIds));
  if (slotIds.length === 0) return [];

  const weeks = expandWeeks(query.semester.week1Parity, query.startWeek, query.endWeek, query.parity).filter(
    (weekNo) => weekNo <= query.semester.totalWeeks,
  );
  if (weeks.length === 0) return [];

  const slotPlaceholders = slotIds.map(() => '?').join(', ');
  const weekPlaceholders = weeks.map(() => '?').join(', ');
  const params: SqlValue[] = [query.semester.id, query.userId, query.weekday, ...slotIds, ...weeks];
  let excludeSql = '';
  if (query.excludeScheduleId) {
    excludeSql = ' AND o.schedule_id <> ?';
    params.push(query.excludeScheduleId);
  }

  const rows = all<ConflictRow>(
    `SELECT o.week_no,
            o.weekday,
            o.slot_id,
            o.schedule_id,
            s.start_week,
            s.end_week,
            s.parity,
            s.note,
            ts.label
       FROM schedule_occurrence o
       JOIN schedule s ON s.id = o.schedule_id
       JOIN time_slot ts ON ts.id = o.slot_id
      WHERE o.semester_id = ?
        AND o.user_id = ?
        AND o.weekday = ?
        AND o.slot_id IN (${slotPlaceholders})
        AND o.week_no IN (${weekPlaceholders})${excludeSql}
      ORDER BY o.week_no ASC, o.slot_id ASC`,
    params,
  );

  return rows.map((row) => ({
    weekNo: Number(row.week_no),
    weekday: Number(row.weekday) as Weekday,
    slotId: Number(row.slot_id),
    slotLabel: row.label,
    scheduleId: Number(row.schedule_id),
    startWeek: Number(row.start_week),
    endWeek: Number(row.end_week),
    parity: row.parity,
    note: row.note,
  }));
}

export function assertNoConflicts(query: ConflictQuery): void {
  const conflicts = detectConflicts(query);
  if (conflicts.length > 0) {
    throw new AppError(409, 'SCHEDULE_CONFLICT', '该时间段与已有安排冲突', conflicts);
  }
}

/** SQLite 唯一约束错误（含 UNIQUE / constraint 关键字）判定 */
export function isUniqueConstraintError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /UNIQUE|constraint/i.test(message);
}

/**
 * 并发兜底：写库时若命中唯一约束，转换为 409 SCHEDULE_CONFLICT。
 * conflicts 回调在事务回滚后执行，用于重新取回冲突明细。
 */
export function rethrowUniqueConflict(error: unknown, conflicts: () => ConflictDetail[]): never {
  if (isUniqueConstraintError(error)) {
    throw new AppError(409, 'SCHEDULE_CONFLICT', '该时间段与已有安排冲突', conflicts());
  }
  throw error;
}
