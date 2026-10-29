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
import { badRequest, notFound } from '../lib/errors.ts';
import type { ScheduleRow } from '../lib/mappers.ts';
import { mapSchedule } from '../lib/mappers.ts';
import { defaultOrgId, getActiveSemester, getSemesterSlots, getUserById, listActiveUsers, resolveWeek } from './context.ts';

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

function resolveOrgId(orgId?: number): number {
  return orgId ?? defaultOrgId();
}

function placeholders(count: number): string {
  return Array.from({ length: count }, () => '?').join(', ');
}

/**
 * 一次性取回某周全部占用点（可按用户过滤），避免逐格查询（禁止 N+1）。
 * 返回 cellKey -> 占用用户 id 集合。
 * 传入 orgId（或省略时取 defaultOrgId）后只统计该组织的用户，避免跨组织串数据。
 */
export function loadWeekOccupancy(
  semesterId: number,
  weekNo: number,
  userIds?: number[],
  orgId?: number,
): Map<string, Set<number>> {
  const org = resolveOrgId(orgId);
  const params: SqlValue[] = [semesterId, weekNo, org];
  let sql =
    'SELECT o.weekday, o.slot_id, o.user_id FROM schedule_occurrence o JOIN app_user u ON u.id = o.user_id' +
    ' WHERE o.semester_id = ? AND o.week_no = ? AND u.org_id = ?';
  if (userIds && userIds.length > 0) {
    sql += ' AND o.user_id IN (' + placeholders(userIds.length) + ')';
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
 * 每格的 freeUserIds 与 freeCount 同源。users 一律限定为当前组织的启用用户。
 */
export function getAggregateBoard(query: AggregateBoardQuery = {}, orgId?: number): AggregateBoard {
  const org = resolveOrgId(orgId);
  const semester = getActiveSemester(org);
  const week = resolveWeek(semester, query.week);
  const allSlots = getSemesterSlots(semester);
  const dayParts = query.dayParts && query.dayParts.length > 0 ? new Set(query.dayParts) : null;
  const slots = dayParts ? allSlots.filter((slot) => dayParts.has(slot.dayPart)) : allSlots;

  const activeUsers = listActiveUsers(org);
  const idFilter = query.userIds && query.userIds.length > 0 ? new Set(query.userIds) : null;
  const users = idFilter ? activeUsers.filter((user) => idFilter.has(user.id)) : activeUsers;
  const scopedUserIds = users.map((user) => user.id);

  const occupancy = loadWeekOccupancy(semester.id, week.weekNo, scopedUserIds, org);

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

/** 单元格详情：只投影当前组织的启用用户，跨组织用户不可见 */
export function getCellDetail(
  params: { week?: number; weekday: number; slotId: number },
  orgId?: number,
): CellDetail {
  if (!Number.isInteger(params.weekday) || params.weekday < 1 || params.weekday > 7) {
    throw badRequest('weekday 必须为 1-7 的整数');
  }
  const org = resolveOrgId(orgId);
  const semester = getActiveSemester(org);
  const week = resolveWeek(semester, params.week);
  const slots = getSemesterSlots(semester);
  const slot = slots.find((item) => item.id === params.slotId);
  if (!slot) {
    throw badRequest('时间段不属于当前启用模板', [
      { path: 'slot_id', message: '时间段不属于当前启用模板' },
    ]);
  }
  const users = listActiveUsers(org);
  const occupancy = loadWeekOccupancy(semester.id, week.weekNo, users.map((user) => user.id), org);
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
 * scheduleId 指向可编辑的原始 schedule。目标用户必须属于当前组织，否则 404。
 */
export function getPersonalBoard(userId: number, weekNo?: number, orgId?: number): PersonalBoard {
  const org = resolveOrgId(orgId);
  const user = getUserById(userId, org);
  const semester = getActiveSemester(org);
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

/** 个人区间安排列表（编辑用），默认整个学期；按周区间重叠过滤。目标用户必须属于当前组织 */
export function listUserSchedules(
  userId: number,
  fromWeek?: number,
  toWeek?: number,
  orgId?: number,
): Schedule[] {
  const org = resolveOrgId(orgId);
  const semester = getActiveSemester(org);
  if (!Number.isInteger(userId) || userId <= 0) throw notFound('用户');
  const from = fromWeek ?? 1;
  const to = toWeek ?? semester.totalWeeks;
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1 || from > to || to > semester.totalWeeks) {
    throw badRequest('周次范围不合法：' + from + ' ~ ' + to);
  }
  getUserById(userId, org);
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
