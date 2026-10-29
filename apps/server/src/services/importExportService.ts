import type { ImportResult, Parity, TimeSlot } from '@freeshift/shared';
import type { SqlValue } from '../db/index.ts';
import { all, get, run, transaction } from '../db/index.ts';
import { badRequest } from '../lib/errors.ts';
import type { UserRow } from '../lib/mappers.ts';
import { mapUser } from '../lib/mappers.ts';
import { defaultOrgId, getActiveSemester, getSemesterSlots } from './context.ts';
import { expandWeeks, insertOccurrences } from './occurrence.ts';
import { parseCsv } from './csvService.ts';

const REQUIRED_COLUMNS = ['user', 'weekday', 'slot_label', 'start_week', 'end_week', 'parity'] as const;

interface AcceptedRow {
  userId: number;
  weekday: number;
  slot: TimeSlot;
  startWeek: number;
  endWeek: number;
  parity: Parity;
  note: string;
  weeks: number[];
}

function placeholders(count: number): string {
  return Array.from({ length: count }, () => '?').join(', ');
}

/**
 * 导入安排 CSV：按 user 名与当前启用模板 slot label 匹配，
 * 逐行校验（错误行带行号、不中断），写库时事务内插入 schedule + occurrence。
 * dryRun 时只校验不写库，created/skipped 为“将会”的结果。
 * 用户按名字只在本组织内匹配，跨组织同名成员不会被命中（也不会写进别的组织）。
 */
export function importSchedules(csvText: string, dryRun = false, orgId?: number): ImportResult {
  const org = orgId ?? defaultOrgId();
  if (typeof csvText !== 'string' || csvText.trim().length === 0) {
    throw badRequest('CSV 内容为空');
  }
  const rows = parseCsv(csvText).filter((row) => row.some((cell) => cell.trim().length > 0));
  if (rows.length === 0) throw badRequest('CSV 内容为空');

  const header = rows[0].map((cell) => cell.trim().toLowerCase());
  const columnIndex = new Map<string, number>();
  header.forEach((name, index) => {
    if (name.length > 0 && !columnIndex.has(name)) columnIndex.set(name, index);
  });
  const missing = REQUIRED_COLUMNS.filter((column) => !columnIndex.has(column));
  if (missing.length > 0) {
    throw badRequest('CSV 表头缺少列：' + missing.join(', '));
  }

  const semester = getActiveSemester(org);
  const slots = getSemesterSlots(semester);
  const slotByLabel = new Map(slots.map((slot) => [slot.label, slot]));
  const userByName = new Map(
    all<UserRow>('SELECT * FROM app_user WHERE org_id = ? ORDER BY id ASC', [org])
      .map(mapUser)
      .map((user) => [user.name, user] as const),
  );
  const noteIndex = columnIndex.get('note');

  const errors: ImportResult['errors'] = [];
  const accepted: AcceptedRow[] = [];
  /** 本次导入已占用的 (week:weekday:slot:user)，保证 dry_run 与真实导入结果一致 */
  const acceptedKeys = new Set<string>();
  let created = 0;
  let skipped = 0;

  for (let index = 1; index < rows.length; index += 1) {
    const cells = rows[index];
    // 行号按物理行计算（表头为第 1 行；多行引号字段时按记录序号近似）
    const line = index + 1;
    const read = (column: string): string => {
      const columnPosition = columnIndex.get(column);
      if (columnPosition === undefined) return '';
      const value = cells[columnPosition];
      return value === undefined ? '' : value.trim();
    };

    const rowErrors: string[] = [];
    const userName = read('user');
    const user = userByName.get(userName);
    if (userName.length === 0) rowErrors.push('user 不能为空');
    else if (!user) rowErrors.push('用户不存在：' + userName);

    const weekdayRaw = read('weekday');
    const weekday = Number(weekdayRaw);
    if (!/^[1-7]$/.test(weekdayRaw)) rowErrors.push('weekday 必须为 1-7 的整数');

    const slotLabel = read('slot_label');
    const slot = slotByLabel.get(slotLabel);
    if (slotLabel.length === 0) rowErrors.push('slot_label 不能为空');
    else if (!slot) rowErrors.push('时间段不存在：' + slotLabel);

    const startRaw = read('start_week');
    const endRaw = read('end_week');
    const startWeek = Number(startRaw);
    const endWeek = Number(endRaw);
    const startValid = /^\d+$/.test(startRaw);
    const endValid = /^\d+$/.test(endRaw);
    if (!startValid) rowErrors.push('start_week 必须为整数');
    if (!endValid) rowErrors.push('end_week 必须为整数');
    if (startValid && endValid && (startWeek < 1 || endWeek > semester.totalWeeks || startWeek > endWeek)) {
      rowErrors.push('周次范围不合法：' + startRaw + ' ~ ' + endRaw);
    }

    const parityRaw = read('parity').toLowerCase();
    const parityValue = parityRaw.length === 0 ? 'all' : parityRaw;
    if (!['all', 'odd', 'even'].includes(parityValue)) rowErrors.push('parity 必须为 all/odd/even');

    if (rowErrors.length > 0) {
      errors.push({ row: line, message: rowErrors.join('；') });
      continue;
    }

    const typedUser = user as NonNullable<typeof user>;
    const typedSlot = slot as NonNullable<typeof slot>;
    const parity = parityValue as Parity;
    const note = noteIndex === undefined ? '' : (cells[noteIndex] ?? '').trim();
    const weeks = expandWeeks(semester.week1Parity, startWeek, endWeek, parity);

    let conflict = false;
    for (const weekNo of weeks) {
      if (acceptedKeys.has(weekNo + ':' + weekday + ':' + typedSlot.id + ':' + typedUser.id)) {
        conflict = true;
        break;
      }
    }
    if (!conflict && weeks.length > 0) {
      const params: SqlValue[] = [semester.id, typedUser.id, weekday, typedSlot.id, ...weeks];
      const existing = get<{ n: number }>(
        `SELECT COUNT(*) AS n FROM schedule_occurrence
          WHERE semester_id = ? AND user_id = ? AND weekday = ? AND slot_id = ?
            AND week_no IN (${placeholders(weeks.length)})`,
        params,
      );
      if (existing && Number(existing.n) > 0) conflict = true;
    }
    if (conflict) {
      skipped += 1;
      continue;
    }

    created += 1;
    for (const weekNo of weeks) acceptedKeys.add(weekNo + ':' + weekday + ':' + typedSlot.id + ':' + typedUser.id);
    accepted.push({
      userId: typedUser.id,
      weekday,
      slot: typedSlot,
      startWeek,
      endWeek,
      parity,
      note,
      weeks,
    });
  }

  if (!dryRun && accepted.length > 0) {
    transaction(() => {
      for (const row of accepted) {
        const result = run(
          `INSERT INTO schedule (semester_id, user_id, weekday, slot_id, start_week, end_week, parity, note)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [semester.id, row.userId, row.weekday, row.slot.id, row.startWeek, row.endWeek, row.parity, row.note],
        );
        const scheduleId = Number(result.lastInsertRowid);
        insertOccurrences(
          {
            id: scheduleId,
            semesterId: semester.id,
            userId: row.userId,
            weekday: row.weekday,
            slotId: row.slot.id,
            startWeek: row.startWeek,
            endWeek: row.endWeek,
            parity: row.parity,
          },
          row.weeks,
        );
      }
    });
  }

  return { created, skipped, errors };
}
