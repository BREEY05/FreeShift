import type {
  AggregateBoard,
  AppUser,
  BoardCell,
  CellDetail,
  DayPart,
  PersonalBoard,
  PersonalCell,
  Schedule,
  Weekday,
} from '@freeshift/shared';
import { WEEKDAY_ORDER, isWeekIncluded } from '@freeshift/shared';
import type { SqlValue } from '../db/index.ts';
import { all } from '../db/index.ts';
import { badRequest } from '../lib/errors.ts';
import type { ScheduleRow } from '../lib/mappers.ts';
import { mapSchedule } from '../lib/mappers.ts';
import {
  getActiveSemester,
  getSemesterSlots,
  getUserById,
  listActiveUsers,
  resolveWeek,
} from './context.ts';

export type BoardFilter = 'all' | 'full_free' | 'partial';

export interface AggregateBoardQuery {
  week?: number;
  userIds?: number[];
  dayParts?: DayPart[];
  filter?: BoardFilter;
}

interface OccurrenceRow {
  weekday: number;
  slot_id: number;
  user_id: number;
}

function cellKey(weekday: number, slotId: number): string {
  return weekday + ':' + slotId;
}

/**
 * 一次性取回某周全部占用点（可按用户过滤），避免逐格查询（禁止 N+1）。
 * 返回 cellKey -> 占用用户 id 集合。
 */
export function loadWeekOccupancy(
  semesterId: number,
  weekNo: number,
  userIds?: number[],
): Map<string, Set<number>> {
  const params: SqlValue[] = [semesterId, weekNo];
  let sql = 'SELECT weekday, slot_id, user_id FROM schedule_occurrence WHERE semester_id = ? AND week_no = ?';
  if (userIds && userIds.length > 0) {
    sql += ' AND user_id IN (' + userIds.map(() => '?').join(', ') + ')';
    params.push(...userIds);
  }
  const rows = all<OccurrenceRow>(sql, params);
  const map = new Map<string, Set<number>>();
  for (const row of rows) {
    const key = cellKey(Number(row.weekday), Number(row.slot_id));
    const bucket = map.get(key);
    if (bucket) bucket.add(Number(row.user_id));
    else map.set(key, new Set([Number(row.user_id)]));
  }
  return map;
}

export function filterBoardCells(cells: BoardCell[], filter: BoardFilter): BoardCell[] {
  if (filter === 'full_free') {
    return cells.filter((cell) => cell.totalUsers > 0 && cell.freeCount === cell.totalUsers);
  }
  if (filter === 'partial') {
    return cells.filter((cell) => cell.freeCount > 0 && cell.freeCount < cell.totalUsers);
  }
  return cells;
}

/**
 * 主界面聚合：slots / users 决定完整网格，occupancy 只查一次，
 * 每格的 freeUserIds 与 freeCount 同源。
 */
export function getAggregateBoard(query: AggregateBoardQuery = {}): AggregateBoard {
  const semester = getActiveSemester();
  const week = resolveWeek(semester, query.week);
  const allSlots = getSemesterSlots(semester);
  const dayParts = query.dayParts && query.dayParts.length > 0 ? new Set(query.dayParts) : null;
  const slots = dayParts ? allSlots.filter((slot) => dayParts.has(slot.dayPart)) : allSlots;

  const activeUsers = listActiveUsers();
  const idFilter = query.userIds && query.userIds.length > 0 ? new Set(query.userIds) : null;
  const users = idFilter ? activeUsers.filter((user) => idFilter.has(user.id)) : activeUsers;
  const scopedUserIds = users.map((user) => user.id);

  const occupancy = loadWeekOccupancy(semester.id, week.weekNo, idFilter ? scopedUserIds : undefined);

  const cells: BoardCell[] = [];
  for (const weekday of WEEKDAY_ORDER) {
    for (const slot of slots) {
      const occupiedSet = occupancy.get(cellKey(weekday, slot.id));
      const freeUserIds: number[] = [];
      const occupiedUserIds: number[] = [];
      for (const user of users) {
        if (occupiedSet && occupiedSet.has(user.id)) occupiedUserIds.push(user.id);
        else freeUserIds.push(user.id);
      }
      cells.push({
        weekday,
        slotId: slot.id,
        freeCount: freeUserIds.length,
        totalUsers: users.length,
        freeUserIds,
        occupiedUserIds,
      });
    }
  }

  return {
    week,
    semester,
    slots,
    users,
    cells: filterBoardCells(cells, query.filter ?? 'all'),
  };
}

export function getCellDetail(params: { week?: number; weekday: number; slotId: number }): CellDetail {
  if (!Number.isInteger(params.weekday) || params.weekday < 1 || params.weekday > 7) {
    throw badRequest('weekday 必须为 1-7 的整数');
  }
  const semester = getActiveSemester();
  const week = resolveWeek(semester, params.week);
  const slots = getSemesterSlots(semester);
  const slot = slots.find((item) => item.id === params.slotId);
  if (!slot) {
    throw badRequest('时间段不属于当前启用模板', [
      { path: 'slot_id', message: '时间段不属于当前启用模板' },
    ]);
  }
  const users = listActiveUsers();
  const occupancy = loadWeekOccupancy(semester.id, week.weekNo);
  const occupiedSet = occupancy.get(cellKey(params.weekday, slot.id)) ?? new Set<number>();
  const freeUsers: AppUser[] = [];
  const occupiedUsers: AppUser[] = [];
  for (const user of users) {
    if (occupiedSet.has(user.id)) occupiedUsers.push(user);
    else freeUsers.push(user);
  }
  return {
    week,
    weekday: params.weekday as Weekday,
    slot,
    freeUsers,
    occupiedUsers,
  };
}

/**
 * 个人视图：用 schedule 区间 + 单双周规则命中该周占用，
 * scheduleId 指向可编辑的原始 schedule。
 */
export function getPersonalBoard(userId: number, weekNo?: number): PersonalBoard {
  const user = getUserById(userId);
  const semester = getActiveSemester();
  const week = resolveWeek(semester, weekNo);
  const slots = getSemesterSlots(semester);
  const templateId = semester.activeTemplateId ?? -1;

  const rows = all<ScheduleRow>(
    `SELECT s.* FROM schedule s
       JOIN time_slot ts ON ts.id = s.slot_id
      WHERE s.semester_id = ?
        AND s.user_id = ?
        AND ts.template_id = ?
        AND s.start_week <= ?
        AND s.end_week >= ?
      ORDER BY s.weekday ASC, ts.sort_order ASC, s.id ASC`,
    [semester.id, user.id, templateId, week.weekNo, week.weekNo],
  );

  const hitByCell = new Map<string, Schedule>();
  for (const row of rows) {
    const schedule = mapSchedule(row);
    if (!isWeekIncluded(schedule.parity, week.parity)) continue;
    const key = cellKey(schedule.weekday, schedule.slotId);
    if (!hitByCell.has(key)) hitByCell.set(key, schedule);
  }

  const cells: PersonalCell[] = [];
  for (const weekday of WEEKDAY_ORDER) {
    for (const slot of slots) {
      const hit = hitByCell.get(cellKey(weekday, slot.id));
      cells.push({
        weekday,
        slotId: slot.id,
        scheduleId: hit ? hit.id : null,
        note: hit ? hit.note : '',
      });
    }
  }

  return { week, semester, user, slots, cells };
}

/** 个人区间安排列表（编辑用），默认整个学期；按周区间重叠过滤 */
export function listUserSchedules(userId: number, fromWeek?: number, toWeek?: number): Schedule[] {
  const semester = getActiveSemester();
  getUserById(userId);
  const from = fromWeek ?? 1;
  const to = toWeek ?? semester.totalWeeks;
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1 || from > to || to > semester.totalWeeks) {
    throw badRequest('周次范围不合法：' + from + ' ~ ' + to);
  }
  const templateId = semester.activeTemplateId ?? -1;
  const rows = all<ScheduleRow>(
    `SELECT s.* FROM schedule s
       JOIN time_slot ts ON ts.id = s.slot_id
      WHERE s.semester_id = ?
        AND s.user_id = ?
        AND ts.template_id = ?
        AND s.start_week <= ?
        AND s.end_week >= ?
      ORDER BY s.weekday ASC, ts.sort_order ASC, s.id ASC`,
    [semester.id, userId, templateId, to, from],
  );
  return rows.map(mapSchedule);
}
