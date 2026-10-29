import type { FairnessReport, FairnessUser } from '@freeshift/shared';
import { all } from '../db/index.ts';
import { badRequest } from '../lib/errors.ts';
import { defaultOrgId, getActiveSemester, listActiveUsers } from './context.ts';

export interface FairnessQuery {
  fromWeek?: number;
  toWeek?: number;
}

interface OccurrenceLoadRow {
  user_id: number;
  week_no: number;
  weekday: number;
  slot_id: number;
  duration_min: number;
  sort_order: number;
}

function round(value: number, digits = 6): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/** 基尼系数 G = ΣΣ|xi-xj| / (2n²μ)，μ=0 时返回 0 */
export function giniCoefficient(values: number[]): number {
  const n = values.length;
  if (n === 0) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / n;
  if (mean === 0) return 0;
  let sum = 0;
  for (const left of values) {
    for (const right of values) sum += Math.abs(left - right);
  }
  return sum / (2 * n * n * mean);
}

export function varianceOf(values: number[]): number {
  const n = values.length;
  if (n === 0) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / n;
  return values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / n;
}

/** 算法 4：公平性统计（按周 + 星期合并连续 sort_order 块） */
/** 统计口径限定为当前组织的启用成员；跨组织用户既不参与指标也不影响基尼系数 */
export function getFairnessReport(query: FairnessQuery = {}, orgId?: number): FairnessReport {
  const org = orgId ?? defaultOrgId();
  const semester = getActiveSemester(org);
  const fromWeek = query.fromWeek ?? 1;
  const toWeek = query.toWeek ?? semester.totalWeeks;
  if (
    !Number.isInteger(fromWeek) ||
    !Number.isInteger(toWeek) ||
    fromWeek < 1 ||
    fromWeek > toWeek ||
    toWeek > semester.totalWeeks
  ) {
    throw badRequest('周次范围不合法：' + fromWeek + ' ~ ' + toWeek);
  }

  const users = listActiveUsers(org);
  const userById = new Map(users.map((user) => [user.id, user]));
  const rows = all<OccurrenceLoadRow>(
    `SELECT o.user_id, o.week_no, o.weekday, o.slot_id, ts.duration_min, ts.sort_order
       FROM schedule_occurrence o
       JOIN time_slot ts ON ts.id = o.slot_id
       JOIN app_user u ON u.id = o.user_id
      WHERE o.semester_id = ? AND o.week_no BETWEEN ? AND ? AND u.org_id = ?
      ORDER BY o.user_id ASC, o.week_no ASC, o.weekday ASC, ts.sort_order ASC`,
    [semester.id, fromWeek, toWeek, org],
  );

  interface Accumulator {
    occupiedCells: number;
    occupiedMinutes: number;
    maxContiguousMinutes: number;
  }
  const acc = new Map<number, Accumulator>();
  // (user, week, weekday) -> 连续块累计
  let currentUser = -1;
  let currentWeek = -1;
  let currentWeekday = -1;
  let currentRun = 0;
  let currentRunMinutes = 0;
  let lastSortOrder = 0;

  const flushRun = () => {
    if (currentUser < 0) return;
    const bucket = acc.get(currentUser);
    if (!bucket) return;
    if (currentRunMinutes > bucket.maxContiguousMinutes) bucket.maxContiguousMinutes = currentRunMinutes;
  };

  for (const row of rows) {
    const userId = Number(row.user_id);
    const user = userById.get(userId);
    if (!user) continue;
    const bucket = acc.get(userId) ?? { occupiedCells: 0, occupiedMinutes: 0, maxContiguousMinutes: 0 };
    acc.set(userId, bucket);
    const duration = Number(row.duration_min);
    const sortOrder = Number(row.sort_order);
    const weekNo = Number(row.week_no);
    const weekday = Number(row.weekday);
    bucket.occupiedCells += 1;
    bucket.occupiedMinutes += duration;

    const sameRun =
      userId === currentUser &&
      weekNo === currentWeek &&
      weekday === currentWeekday &&
      sortOrder === lastSortOrder + 1;
    if (!sameRun) {
      flushRun();
      currentUser = userId;
      currentWeek = weekNo;
      currentWeekday = weekday;
      currentRun = 1;
      currentRunMinutes = duration;
    } else {
      currentRun += 1;
      currentRunMinutes += duration;
    }
    lastSortOrder = sortOrder;
  }
  flushRun();

  const fairnessUsers: FairnessUser[] = users.map((user) => {
    const bucket = acc.get(user.id);
    return {
      userId: user.id,
      name: user.name,
      color: user.color,
      occupiedCells: bucket ? bucket.occupiedCells : 0,
      occupiedMinutes: bucket ? bucket.occupiedMinutes : 0,
      maxContiguousMinutes: bucket ? bucket.maxContiguousMinutes : 0,
    };
  });

  const minutes = fairnessUsers.map((user) => user.occupiedMinutes);
  const mean = minutes.length > 0 ? minutes.reduce((sum, value) => sum + value, 0) / minutes.length : 0;
  const gini = round(giniCoefficient(minutes));
  const variance = round(varianceOf(minutes));

  const hints: string[] = [];
  if (fairnessUsers.length >= 3 && gini > 0.25) {
    let most = fairnessUsers[0];
    let least = fairnessUsers[0];
    for (const user of fairnessUsers) {
      if (user.occupiedMinutes > most.occupiedMinutes) most = user;
      if (user.occupiedMinutes < least.occupiedMinutes) least = user;
    }
    hints.push(
      '占用分配不均衡（基尼系数 ' +
        gini.toFixed(3) +
        '）：' +
        most.name +
        ' 最多 ' +
        most.occupiedMinutes +
        ' 分钟，' +
        least.name +
        ' 最少 ' +
        least.occupiedMinutes +
        ' 分钟，相差 ' +
        (most.occupiedMinutes - least.occupiedMinutes) +
        ' 分钟',
    );
  }
  const longContiguous = fairnessUsers.filter((user) => user.maxContiguousMinutes > 300);
  if (longContiguous.length > 0) {
    hints.push(
      longContiguous
        .map((user) => user.name + ' 单日连续占用 ' + user.maxContiguousMinutes + ' 分钟')
        .join('、') + '，超过 300 分钟，建议拆分或错峰',
    );
  }

  return {
    fromWeek,
    toWeek,
    users: fairnessUsers,
    gini,
    variance,
    mean: round(mean),
    hints,
  };
}
