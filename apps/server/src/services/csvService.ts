import { WEEKDAY_LABELS, WEEKDAY_ORDER } from '@freeshift/shared';
import { all } from '../db/index.ts';
import { badRequest } from '../lib/errors.ts';
import { defaultOrgId, getActiveSemester, resolveWeek } from './context.ts';
import { getAggregateBoard } from './aggregateService.ts';

export const CSV_BOM = '\uFEFF';

export interface CsvExport {
  filename: string;
  contentType: string;
  content: string;
}

interface ScheduleExportRow {
  name: string;
  weekday: number;
  slot_label: string;
  start_week: number;
  end_week: number;
  parity: string;
  note: string;
}

/** 单字段转义：包含逗号、引号、换行时用双引号包裹，内部引号翻倍 */
export function escapeCsvField(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  const text = String(value);
  if (/[",\r\n]/.test(text)) return '"' + text.replace(/"/g, '""') + '"';
  return text;
}

/** 行数组 -> CSV 文本（CRLF 换行，兼容 Excel） */
export function toCsv(rows: (string | number | null | undefined)[][]): string {
  return rows.map((row) => row.map(escapeCsvField).join(',')).join('\r\n');
}

/** 解析 CSV 文本，支持双引号包裹、逗号与换行转义、"" 转义引号，容忍 BOM 与 CRLF */
export function parseCsv(text: string): string[][] {
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let index = 0;

  const pushField = () => {
    row.push(field);
    field = '';
  };
  const pushRow = () => {
    pushField();
    rows.push(row);
    row = [];
  };

  while (index < source.length) {
    const char = source[index];
    if (inQuotes) {
      if (char === '"') {
        if (source[index + 1] === '"') {
          field += '"';
          index += 2;
          continue;
        }
        inQuotes = false;
        index += 1;
        continue;
      }
      field += char;
      index += 1;
      continue;
    }
    if (char === '"') {
      inQuotes = true;
      index += 1;
      continue;
    }
    if (char === ',') {
      pushField();
      index += 1;
      continue;
    }
    if (char === '\r') {
      if (source[index + 1] === '\n') index += 1;
      pushRow();
      index += 1;
      continue;
    }
    if (char === '\n') {
      pushRow();
      index += 1;
      continue;
    }
    field += char;
    index += 1;
  }
  if (field.length > 0 || row.length > 0) {
    pushField();
    rows.push(row);
  }
  return rows;
}

function validateExportRange(fromWeek?: number, toWeek?: number, orgId?: number): { from: number; to: number } {
  const semester = getActiveSemester(orgId ?? defaultOrgId());
  const from = fromWeek ?? 1;
  const to = toWeek ?? semester.totalWeeks;
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1 || from > to || to > semester.totalWeeks) {
    throw badRequest('周次范围不合法：' + from + ' ~ ' + to);
  }
  return { from, to };
}

const SCHEDULE_HEADER = ['user', 'weekday', 'slot_label', 'start_week', 'end_week', 'parity', 'note'];

/** 导出安排 CSV（user,weekday,slot_label,start_week,end_week,parity,note），只导当前组织成员的安排 */
export function buildSchedulesCsv(fromWeek?: number, toWeek?: number, orgId?: number): CsvExport {
  const org = orgId ?? defaultOrgId();
  const semester = getActiveSemester(org);
  const { from, to } = validateExportRange(fromWeek, toWeek, org);
  const rows = all<ScheduleExportRow>(
    `SELECT u.name AS name, s.weekday, ts.label AS slot_label, s.start_week, s.end_week, s.parity, s.note
       FROM schedule s
       JOIN app_user u ON u.id = s.user_id
       JOIN time_slot ts ON ts.id = s.slot_id
      WHERE s.semester_id = ? AND s.start_week <= ? AND s.end_week >= ? AND u.org_id = ?
      ORDER BY u.sort_order ASC, u.id ASC, s.weekday ASC, ts.sort_order ASC, s.id ASC`,
    [semester.id, to, from, org],
  );
  const lines: (string | number)[][] = [SCHEDULE_HEADER];
  for (const row of rows) {
    lines.push([
      row.name,
      Number(row.weekday),
      row.slot_label,
      Number(row.start_week),
      Number(row.end_week),
      row.parity,
      row.note,
    ]);
  }
  return {
    filename: 'schedules.csv',
    contentType: 'text/csv; charset=utf-8',
    content: CSV_BOM + toCsv(lines),
  };
}

/** 导出某周聚合表 CSV：首列时间段，周一到周日，格子内容“空闲 N/M”，口径为当前组织成员 */
export function buildBoardCsv(weekNo?: number, orgId?: number): CsvExport {
  const org = orgId ?? defaultOrgId();
  const semester = getActiveSemester(org);
  const week = resolveWeek(semester, weekNo);
  const board = getAggregateBoard({ week: week.weekNo }, org);
  const totalUsers = board.users.length;
  const cellByKey = new Map(board.cells.map((cell) => [cell.weekday + ':' + cell.slotId, cell]));
  const lines: (string | number)[][] = [['时间段', ...WEEKDAY_ORDER.map((weekday) => WEEKDAY_LABELS[weekday])]];
  for (const slot of board.slots) {
    const row: (string | number)[] = [slot.label];
    for (const weekday of WEEKDAY_ORDER) {
      const cell = cellByKey.get(weekday + ':' + slot.id);
      const freeCount = cell ? cell.freeCount : 0;
      row.push('空闲 ' + freeCount + '/' + totalUsers);
    }
    lines.push(row);
  }
  return {
    filename: 'board-week' + week.weekNo + '.csv',
    contentType: 'text/csv; charset=utf-8',
    content: CSV_BOM + toCsv(lines),
  };
}
