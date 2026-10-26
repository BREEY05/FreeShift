import { z } from 'zod';
import type { BatchScheduleResult, ConflictDetail, Parity, Schedule, Semester } from '@freeshift/shared';
import { get, run, all, transaction, type SqlValue } from '../db/index.ts';
import { AppError, notFound } from '../lib/errors.ts';
import { mapSchedule, type ScheduleRow, type SlotRow } from '../lib/mappers.ts';
import { getActiveSemester, getSemesterById, getUserById } from './context.ts';
import { assertNoConflicts, detectConflicts, rethrowUniqueConflict, type ConflictQuery } from './conflictService.ts';
import { expandWeeks, insertOccurrences, removeOccurrences, type ScheduleKey } from './occurrence.ts';

const weekdaySchema = z
  .number({ invalid_type_error: '星期必须为数字' })
  .int('星期必须为整数')
  .min(1, '星期必须在 1-7 之间')
  .max(7, '星期必须在 1-7 之间');

const paritySchema = z.enum(['all', 'odd', 'even'], {
  errorMap: () => ({ message: '单双周必须为 all、odd 或 even' }),
});

const weekSchema = z
  .number({ invalid_type_error: '周次必须为数字' })
  .int('周次必须为整数')
  .min(1, '周次必须在 1-60 之间')
  .max(60, '周次必须在 1-60 之间');

const baseScheduleSchema = z.object({
  userId: z.number({ invalid_type_error: '用户 ID 必须为数字' }).int('用户 ID 必须为正整数').positive('用户 ID 必须为正整数'),
  weekday: weekdaySchema,
  slotId: z
    .number({ invalid_type_error: '时间段 ID 必须为数字' })
    .int('时间段 ID 必须为正整数')
    .positive('时间段 ID 必须为正整数'),
  startWeek: weekSchema,
  endWeek: weekSchema,
  parity: paritySchema.optional(),
  note: z.string().max(200, '备注不能超过 200 个字符').optional(),
});

export const scheduleInputSchema = baseScheduleSchema.refine((value) => value.endWeek >= value.startWeek, {
  message: '结束周不能小于开始周',
  path: ['endWeek'],
});

export const schedulePatchSchema = baseScheduleSchema.partial();

const batchCellSchema = z.object({
  weekday: weekdaySchema,
  slotIds: z
    .array(z.number({ invalid_type_error: '时间段 ID 必须为数字' }).int('时间段 ID 必须为正整数').positive('时间段 ID 必须为正整数'))
    .min(1, '每个格子至少选择一个时间段'),
});

export const batchScheduleInputSchema = z.object({
  userId: z.number({ invalid_type_error: '用户 ID 必须为数字' }).int('用户 ID 必须为正整数').positive('用户 ID 必须为正整数'),
  cells: z.array(batchCellSchema).min(1, '请至少选择一个格子'),
  weeks: z.object({
    start: weekSchema,
    end: weekSchema,
    parity: paritySchema,
  }),
  mode: z.enum(['strict', 'skip'], { errorMap: () => ({ message: '模式必须为 strict 或 skip' }) }).optional(),
  note: z.string().max(200, '备注不能超过 200 个字符').optional(),
});

export const conflictCheckSchema = z.object({
  userId: z.number({ invalid_type_error: '用户 ID 必须为数字' }).int('用户 ID 必须为正整数').positive('用户 ID 必须为正整数'),
  weekday: weekdaySchema,
  slotIds: z
    .array(z.number({ invalid_type_error: '时间段 ID 必须为数字' }).int('时间段 ID 必须为正整数').positive('时间段 ID 必须为正整数'))
    .min(1, '请至少选择一个时间段'),
  startWeek: weekSchema,
  endWeek: weekSchema,
  parity: paritySchema.optional(),
  excludeScheduleId: z.number().int().positive().optional(),
});

export type ScheduleInputParsed = z.infer<typeof scheduleInputSchema>;
export type SchedulePatchParsed = z.infer<typeof schedulePatchSchema>;
export type BatchScheduleParsed = z.infer<typeof batchScheduleInputSchema>;
export type ConflictCheckParsed = z.infer<typeof conflictCheckSchema>;

export interface ScheduleFilters {
  userId?: number;
  fromWeek?: number;
  toWeek?: number;
  weekday?: number;
}

function assertWeekRange(startWeek: number, endWeek: number): void {
  if (endWeek < startWeek) {
    throw new AppError(422, 'VALIDATION_ERROR', '结束周不能小于开始周', [
      { path: 'endWeek', message: '结束周不能小于开始周' },
    ]);
  }
}

function assertUserExists(userId: number): void {
  getUserById(userId);
}

function assertSlotExists(slotId: number): void {
  const row = get<SlotRow>('SELECT * FROM time_slot WHERE id = ?', [slotId]);
  if (!row) throw notFound('时间段');
}

function loadScheduleRow(id: number): ScheduleRow | undefined {
  return get<ScheduleRow>('SELECT * FROM schedule WHERE id = ?', [id]);
}

function requireScheduleRow(id: number): ScheduleRow {
  const row = loadScheduleRow(id);
  if (!row) throw notFound('安排');
  return row;
}

function getScheduleOrThrow(id: number): Schedule {
  return mapSchedule(requireScheduleRow(id));
}

function scheduleKeyOf(row: ScheduleRow, overrides: Partial<ScheduleKey> = {}): ScheduleKey {
  return {
    id: Number(row.id),
    semesterId: Number(row.semester_id),
    userId: Number(row.user_id),
    weekday: Number(row.weekday),
    slotId: Number(row.slot_id),
    startWeek: Number(row.start_week),
    endWeek: Number(row.end_week),
    parity: row.parity,
    ...overrides,
  };
}

/** 展开并写入某条安排的 occurrence；周次裁剪到 1..totalWeeks（调用方负责事务） */
function writeOccurrences(semester: Semester, key: ScheduleKey): void {
  removeOccurrences(key.id);
  const weeks = expandWeeks(semester.week1Parity, key.startWeek, key.endWeek, key.parity).filter(
    (weekNo) => weekNo <= semester.totalWeeks,
  );
  insertOccurrences(key, weeks);
}

function insertScheduleRecord(
  semesterId: number,
  values: { userId: number; weekday: number; slotId: number; startWeek: number; endWeek: number; parity: Parity; note: string },
): number {
  const result = run(
    `INSERT INTO schedule (semester_id, user_id, weekday, slot_id, start_week, end_week, parity, note)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      semesterId,
      values.userId,
      values.weekday,
      values.slotId,
      values.startWeek,
      values.endWeek,
      values.parity,
      values.note,
    ],
  );
  return result.lastInsertRowid;
}

export function getSchedule(id: number): Schedule {
  return getScheduleOrThrow(id);
}

export function listSchedules(filters: ScheduleFilters = {}): Schedule[] {
  const semester = getActiveSemester();
  const conditions: string[] = ['semester_id = ?'];
  const params: SqlValue[] = [semester.id];
  if (filters.userId !== undefined) {
    conditions.push('user_id = ?');
    params.push(filters.userId);
  }
  if (filters.weekday !== undefined) {
    conditions.push('weekday = ?');
    params.push(filters.weekday);
  }
  if (filters.fromWeek !== undefined) {
    conditions.push('end_week >= ?');
    params.push(filters.fromWeek);
  }
  if (filters.toWeek !== undefined) {
    conditions.push('start_week <= ?');
    params.push(filters.toWeek);
  }
  const rows = all<ScheduleRow>(
    `SELECT * FROM schedule WHERE ${conditions.join(' AND ')}
     ORDER BY weekday ASC, start_week ASC, slot_id ASC, id ASC`,
    params,
  );
  return rows.map(mapSchedule);
}

export function createSchedule(input: ScheduleInputParsed): Schedule {
  const semester = getActiveSemester();
  assertUserExists(input.userId);
  assertSlotExists(input.slotId);
  const parity = input.parity ?? 'all';
  assertWeekRange(input.startWeek, input.endWeek);

  const conflictQuery: ConflictQuery = {
    semester,
    userId: input.userId,
    weekday: input.weekday,
    slotIds: [input.slotId],
    startWeek: input.startWeek,
    endWeek: input.endWeek,
    parity,
  };
  assertNoConflicts(conflictQuery);

  try {
    const scheduleId = transaction(() => {
      const id = insertScheduleRecord(semester.id, {
        userId: input.userId,
        weekday: input.weekday,
        slotId: input.slotId,
        startWeek: input.startWeek,
        endWeek: input.endWeek,
        parity,
        note: input.note ?? '',
      });
      writeOccurrences(semester, {
        id,
        semesterId: semester.id,
        userId: input.userId,
        weekday: input.weekday,
        slotId: input.slotId,
        startWeek: input.startWeek,
        endWeek: input.endWeek,
        parity,
      });
      return id;
    });
    return getScheduleOrThrow(scheduleId);
  } catch (error) {
    return rethrowUniqueConflict(error, () => detectConflicts(conflictQuery));
  }
}

export function updateSchedule(id: number, patch: SchedulePatchParsed): Schedule {
  const existing = requireScheduleRow(id);
  const semester = getSemesterById(Number(existing.semester_id));

  const userId = patch.userId ?? Number(existing.user_id);
  const weekday = patch.weekday ?? Number(existing.weekday);
  const slotId = patch.slotId ?? Number(existing.slot_id);
  const startWeek = patch.startWeek ?? Number(existing.start_week);
  const endWeek = patch.endWeek ?? Number(existing.end_week);
  const parity = patch.parity ?? existing.parity;
  const note = patch.note ?? existing.note;

  if (patch.userId !== undefined) assertUserExists(userId);
  if (patch.slotId !== undefined) assertSlotExists(slotId);
  assertWeekRange(startWeek, endWeek);

  const conflictQuery: ConflictQuery = {
    semester,
    userId,
    weekday,
    slotIds: [slotId],
    startWeek,
    endWeek,
    parity,
    excludeScheduleId: id,
  };
  assertNoConflicts(conflictQuery);

  try {
    transaction(() => {
      run(
        `UPDATE schedule
            SET user_id = ?, weekday = ?, slot_id = ?, start_week = ?, end_week = ?, parity = ?, note = ?,
                updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
          WHERE id = ?`,
        [userId, weekday, slotId, startWeek, endWeek, parity, note, id],
      );
      writeOccurrences(semester, {
        id,
        semesterId: semester.id,
        userId,
        weekday,
        slotId,
        startWeek,
        endWeek,
        parity,
      });
    });
    return getScheduleOrThrow(id);
  } catch (error) {
    return rethrowUniqueConflict(error, () => detectConflicts(conflictQuery));
  }
}

export function deleteSchedule(id: number): void {
  requireScheduleRow(id);
  run('DELETE FROM schedule WHERE id = ?', [id]);
}

export function checkConflicts(input: ConflictCheckParsed): ConflictDetail[] {
  const semester = getActiveSemester();
  assertUserExists(input.userId);
  assertWeekRange(input.startWeek, input.endWeek);
  return detectConflicts({
    semester,
    userId: input.userId,
    weekday: input.weekday,
    slotIds: input.slotIds,
    startWeek: input.startWeek,
    endWeek: input.endWeek,
    parity: input.parity ?? 'all',
    excludeScheduleId: input.excludeScheduleId,
  });
}

export function batchCreateSchedules(input: BatchScheduleParsed): BatchScheduleResult {
  const semester = getActiveSemester();
  assertUserExists(input.userId);
  const { start, end, parity } = input.weeks;
  assertWeekRange(start, end);

  // cells × 时间段，按 (weekday, slotId) 去重
  const pairs: { weekday: number; slotId: number }[] = [];
  const seen = new Set<string>();
  for (const cell of input.cells) {
    for (const slotId of cell.slotIds) {
      const key = cell.weekday + ':' + slotId;
      if (seen.has(key)) continue;
      seen.add(key);
      assertSlotExists(slotId);
      pairs.push({ weekday: cell.weekday, slotId });
    }
  }

  const mode = input.mode ?? 'strict';
  const conflicts: ConflictDetail[] = [];
  const creatable: { weekday: number; slotId: number }[] = [];

  for (const pair of pairs) {
    const found = detectConflicts({
      semester,
      userId: input.userId,
      weekday: pair.weekday,
      slotIds: [pair.slotId],
      startWeek: start,
      endWeek: end,
      parity,
    });
    if (found.length > 0) {
      conflicts.push(...found);
      if (mode === 'skip') continue;
    }
    creatable.push(pair);
  }

  if (mode === 'strict' && conflicts.length > 0) {
    throw new AppError(409, 'SCHEDULE_CONFLICT', '存在 ' + conflicts.length + ' 处时间冲突，批量保存已取消', conflicts);
  }

  const detectAll = (): ConflictDetail[] => {
    const allConflicts: ConflictDetail[] = [];
    for (const pair of pairs) {
      allConflicts.push(
        ...detectConflicts({
          semester,
          userId: input.userId,
          weekday: pair.weekday,
          slotIds: [pair.slotId],
          startWeek: start,
          endWeek: end,
          parity,
        }),
      );
    }
    return allConflicts;
  };

  try {
    const ids = transaction(() => {
      const createdIds: number[] = [];
      for (const pair of creatable) {
        const id = insertScheduleRecord(semester.id, {
          userId: input.userId,
          weekday: pair.weekday,
          slotId: pair.slotId,
          startWeek: start,
          endWeek: end,
          parity,
          note: input.note ?? '',
        });
        writeOccurrences(semester, {
          id,
          semesterId: semester.id,
          userId: input.userId,
          weekday: pair.weekday,
          slotId: pair.slotId,
          startWeek: start,
          endWeek: end,
          parity,
        });
        createdIds.push(id);
      }
      return createdIds;
    });
    const schedules = ids.map((id) => getScheduleOrThrow(id));
    return {
      created: schedules.length,
      skipped: pairs.length - creatable.length,
      schedules,
      conflicts,
    };
  } catch (error) {
    return rethrowUniqueConflict(error, detectAll);
  }
}
