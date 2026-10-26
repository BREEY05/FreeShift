import type {
  AlternativesInput,
  AlternativesResult,
  AlternativeCell,
  AppUser,
  CommonFreeInput,
  DayPart,
  FactorKey,
  FactorScores,
  FreeBlock,
  RecommendConfig,
  ScoredCell,
  ScoredInput,
  TimeSlot,
  Weekday,
} from '@freeshift/shared';
import {
  DAY_PART_LABELS,
  DEFAULT_FACTOR_WEIGHTS,
  DEFAULT_RECOMMEND_CONFIG,
  WEEKDAY_ORDER,
} from '@freeshift/shared';
import type { SqlValue } from '../db/index.ts';
import { all, get, run } from '../db/index.ts';
import { badRequest } from '../lib/errors.ts';
import { getActiveSemester, getSemesterSlots, getUserById, listActiveUsers, resolveWeek } from './context.ts';
import { expandWeeks } from './occurrence.ts';
import { loadWeekOccupancy } from './aggregateService.ts';

export const FACTOR_KEYS: FactorKey[] = ['freeRatio', 'continuity', 'history', 'friendliness', 'recentLoad'];

export interface RecommendConfigInput {
  weights?: Partial<FactorScores>;
  dayPart?: Partial<Record<DayPart, number>>;
  historyWeeks?: number;
  recentWindow?: number;
}

function cellKey(weekday: number, slotId: number): string {
  return weekday + ':' + slotId;
}

function round(value: number, digits = 6): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/** 连续空闲块允许的课间间隔（分钟）：如 09:40-10:00 的 20 分钟课间仍算同一块 */
const MAX_BREAK_MINUTES = 20;

function minutesOf(time: string | null): number | null {
  if (!time) return null;
  const [hours, minutes] = time.split(':').map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  return hours * 60 + minutes;
}

function slotsAreAdjacent(prev: TimeSlot, next: TimeSlot, requireTimeAdjacent: boolean): boolean {
  if (prev.sortOrder + 1 !== next.sortOrder) return false;
  if (!requireTimeAdjacent) return true;
  const prevEnd = minutesOf(prev.endTime);
  const nextStart = minutesOf(next.startTime);
  if (prevEnd === null || nextStart === null) return true;
  const breakMinutes = nextStart - prevEnd;
  return breakMinutes >= 0 && breakMinutes <= MAX_BREAK_MINUTES;
}

/** 把已按 sortOrder 排序的空闲时间段切成连续块 */
function groupAdjacentSlots(slots: TimeSlot[], requireTimeAdjacent = true): TimeSlot[][] {
  const groups: TimeSlot[][] = [];
  for (const slot of slots) {
    const current = groups[groups.length - 1];
    if (current && slotsAreAdjacent(current[current.length - 1], slot, requireTimeAdjacent)) {
      current.push(slot);
    } else {
      groups.push([slot]);
    }
  }
  return groups;
}

function toFreeBlock(weekday: Weekday, slots: TimeSlot[]): FreeBlock {
  return {
    weekday,
    slotIds: slots.map((slot) => slot.id),
    labels: slots.map((slot) => slot.label),
    startTime: slots[0]?.startTime ?? null,
    endTime: slots[slots.length - 1]?.endTime ?? null,
    length: slots.length,
    durationMin: slots.reduce((sum, slot) => sum + slot.durationMin, 0),
  };
}

function rangeWeeks(from: number, to: number, totalWeeks: number): number[] {
  const start = Math.max(1, from);
  const end = Math.min(totalWeeks, to);
  const weeks: number[] = [];
  for (let week = start; week <= end; week += 1) weeks.push(week);
  return weeks;
}

function placeholders(count: number): string {
  return Array.from({ length: count }, () => '?').join(', ');
}

/** 所选用户：缺省为全部启用用户；非法 id 抛 422 */
export function resolveSelectedUsers(activeUsers: AppUser[], userIds?: number[]): AppUser[] {
  if (!userIds || userIds.length === 0) return activeUsers;
  const byId = new Map(activeUsers.map((user) => [user.id, user]));
  const wanted = new Set<number>();
  for (const id of userIds) {
    if (!byId.has(id)) throw badRequest('用户不存在或已停用：' + id, [{ path: 'userIds', message: '用户不存在或已停用' }]);
    wanted.add(id);
  }
  return activeUsers.filter((user) => wanted.has(user.id));
}

/** 指定周集合内，每个格子被多少个（指定）用户占用 */
function loadWeekCounts(semesterId: number, weeks: number[], userIds: number[]): Map<string, number> {
  const map = new Map<string, number>();
  if (weeks.length === 0 || userIds.length === 0) return map;
  const rows = all<{ weekday: number; slot_id: number; n: number }>(
    `SELECT weekday, slot_id, COUNT(*) AS n
       FROM schedule_occurrence
      WHERE semester_id = ?
        AND week_no IN (${placeholders(weeks.length)})
        AND user_id IN (${placeholders(userIds.length)})
      GROUP BY weekday, slot_id`,
    [semesterId, ...weeks, ...userIds] as SqlValue[],
  );
  for (const row of rows) map.set(cellKey(Number(row.weekday), Number(row.slot_id)), Number(row.n));
  return map;
}

/** 指定周集合内，每格被多少个启用用户占用（DISTINCT user） */
function loadDistinctUserCounts(semesterId: number, weeks: number[], userIds: number[]): Map<string, number> {
  const map = new Map<string, number>();
  if (weeks.length === 0 || userIds.length === 0) return map;
  const rows = all<{ weekday: number; slot_id: number; n: number }>(
    `SELECT weekday, slot_id, COUNT(DISTINCT user_id) AS n
       FROM schedule_occurrence
      WHERE semester_id = ?
        AND week_no IN (${placeholders(weeks.length)})
        AND user_id IN (${placeholders(userIds.length)})
      GROUP BY weekday, slot_id`,
    [semesterId, ...weeks, ...userIds] as SqlValue[],
  );
  for (const row of rows) map.set(cellKey(Number(row.weekday), Number(row.slot_id)), Number(row.n));
  return map;
}

function loadUserCells(semesterId: number, weeks: number[], userId: number): Set<string> {
  const cells = new Set<string>();
  if (weeks.length === 0) return cells;
  const rows = all<{ weekday: number; slot_id: number }>(
    `SELECT DISTINCT weekday, slot_id
       FROM schedule_occurrence
      WHERE semester_id = ? AND user_id = ? AND week_no IN (${placeholders(weeks.length)})`,
    [semesterId, userId, ...weeks] as SqlValue[],
  );
  for (const row of rows) cells.add(cellKey(Number(row.weekday), Number(row.slot_id)));
  return cells;
}

/** 算法 1：多人共同空闲块 */
export function getCommonFreeBlocks(input: CommonFreeInput): FreeBlock[] {
  const semester = getActiveSemester();
  const week = resolveWeek(semester, input.week);
  const slots = getSemesterSlots(semester);
  if (slots.length === 0) return [];
  const selected = resolveSelectedUsers(listActiveUsers(), input.userIds);
  if (selected.length === 0) return [];

  const requireTimeAdjacent = input.requireTimeAdjacent !== false;
  const selectedIds = new Set(selected.map((user) => user.id));
  const occupancy = loadWeekOccupancy(semester.id, week.weekNo, selected.map((user) => user.id));
  const sortOrderOfSlot = new Map(slots.map((slot) => [slot.id, slot.sortOrder]));
  const blocks: FreeBlock[] = [];

  for (const weekday of WEEKDAY_ORDER) {
    const freeSlots = slots.filter((slot) => {
      const occupied = occupancy.get(cellKey(weekday, slot.id));
      if (!occupied) return true;
      for (const userId of occupied) if (selectedIds.has(userId)) return false;
      return true;
    });
    for (const group of groupAdjacentSlots(freeSlots, requireTimeAdjacent)) {
      blocks.push(toFreeBlock(weekday, group));
    }
  }

  blocks.sort(
    (left, right) =>
      right.length - left.length ||
      left.weekday - right.weekday ||
      (sortOrderOfSlot.get(left.slotIds[0]) ?? 0) - (sortOrderOfSlot.get(right.slotIds[0]) ?? 0),
  );

  if (input.topK && input.topK > 0) return blocks.slice(0, Math.floor(input.topK));
  return blocks;
}

interface CandidateCell {
  weekday: Weekday;
  slot: TimeSlot;
  freeCount: number;
  blockLength: number;
  freeRatio: number;
  history: number;
  friendliness: number;
  recentLoad: number;
}

function historyWindow(weekNo: number, config: RecommendConfig, totalWeeks: number): number[] {
  return rangeWeeks(weekNo - config.historyWeeks, weekNo - 1, totalWeeks);
}

function recentWindow(weekNo: number, config: RecommendConfig, totalWeeks: number): number[] {
  return rangeWeeks(weekNo - config.recentWindow, weekNo + config.recentWindow, totalWeeks);
}

function occupancyRateFactor(count: number, userCount: number, weekCount: number): number {
  const denominator = userCount * weekCount;
  if (weekCount === 0 || denominator <= 0) return 0.5;
  return clamp01(1 - count / denominator);
}

/** 算法 2：多因子加权推荐 */
export function getScoredCells(input: ScoredInput = {}): ScoredCell[] {
  const semester = getActiveSemester();
  const week = resolveWeek(semester, input.week);
  const slots = getSemesterSlots(semester);
  const activeUsers = listActiveUsers();
  if (slots.length === 0 || activeUsers.length === 0) return [];

  const selected = resolveSelectedUsers(activeUsers, input.userIds);
  if (selected.length === 0) return [];
  const selectedIds = new Set(selected.map((user) => user.id));
  const totalUsers = activeUsers.length;
  const config = readRecommendConfig();
  const weights: FactorScores = { ...config.weights, ...(input.weights ?? {}) };

  const perspective = input.perspectiveUserId ? [getUserById(input.perspectiveUserId)] : selected;
  const perspectiveIds = perspective.map((user) => user.id);
  const prevWeeks = historyWindow(week.weekNo, config, semester.totalWeeks);
  const recentWeeks = recentWindow(week.weekNo, config, semester.totalWeeks);
  const historyCounts = loadWeekCounts(semester.id, prevWeeks, perspectiveIds);
  const recentCounts = loadWeekCounts(semester.id, recentWeeks, perspectiveIds);

  const activeIds = new Set(activeUsers.map((user) => user.id));
  const occupancy = loadWeekOccupancy(semester.id, week.weekNo);
  const candidates: CandidateCell[] = [];
  for (const weekday of WEEKDAY_ORDER) {
    for (const slot of slots) {
      const occupied = occupancy.get(cellKey(weekday, slot.id));
      let selectedOccupied = false;
      let occupiedActiveCount = 0;
      if (occupied) {
        for (const userId of occupied) {
          if (selectedIds.has(userId)) selectedOccupied = true;
          if (activeIds.has(userId)) occupiedActiveCount += 1;
        }
      }
      if (selectedOccupied) continue;
      const freeCount = totalUsers - occupiedActiveCount;
      const freeRatio = totalUsers > 0 ? freeCount / totalUsers : 0;
      candidates.push({
        weekday,
        slot,
        freeCount,
        blockLength: 1,
        freeRatio,
        history: occupancyRateFactor(historyCounts.get(cellKey(weekday, slot.id)) ?? 0, perspectiveIds.length, prevWeeks.length),
        friendliness: clamp01(config.dayPart[slot.dayPart] ?? 0.5),
        recentLoad: occupancyRateFactor(recentCounts.get(cellKey(weekday, slot.id)) ?? 0, perspectiveIds.length, recentWeeks.length),
      });
    }
  }
  if (candidates.length === 0) return [];

  // 所选用户视角的空闲块长度（连续 sort_order + 时间相邻）
  const candidateKeys = new Set(candidates.map((candidate) => cellKey(candidate.weekday, candidate.slot.id)));
  const blockLengthByCell = new Map<string, number>();
  let maxBlockLength = 0;
  for (const weekday of WEEKDAY_ORDER) {
    const freeSlots = slots.filter((slot) => candidateKeys.has(cellKey(weekday, slot.id)));
    for (const group of groupAdjacentSlots(freeSlots, true)) {
      if (group.length > maxBlockLength) maxBlockLength = group.length;
      for (const slot of group) blockLengthByCell.set(cellKey(weekday, slot.id), group.length);
    }
  }
  for (const candidate of candidates) {
    candidate.blockLength = blockLengthByCell.get(cellKey(candidate.weekday, candidate.slot.id)) ?? 1;
  }

  // 过滤仅在候选集上裁剪
  const filters = input.filters;
  let filtered = candidates;
  if (filters?.dayParts && filters.dayParts.length > 0) {
    const dayParts = new Set(filters.dayParts);
    filtered = filtered.filter((candidate) => dayParts.has(candidate.slot.dayPart));
  }
  if (filters?.weekdays && filters.weekdays.length > 0) {
    const weekdays = new Set<number>(filters.weekdays);
    filtered = filtered.filter((candidate) => weekdays.has(candidate.weekday));
  }
  if (filters?.allFreeOnly) filtered = filtered.filter((candidate) => candidate.freeCount === totalUsers);
  if (typeof filters?.minFreeRatio === 'number') {
    filtered = filtered.filter((candidate) => candidate.freeRatio >= (filters.minFreeRatio as number));
  }
  if (filtered.length === 0) return [];

  const rawFactors: Record<FactorKey, number[]> = {
    freeRatio: [],
    continuity: [],
    history: [],
    friendliness: [],
    recentLoad: [],
  };
  for (const candidate of filtered) {
    rawFactors.freeRatio.push(candidate.freeRatio);
    rawFactors.continuity.push(maxBlockLength > 0 ? candidate.blockLength / maxBlockLength : 0.5);
    rawFactors.history.push(candidate.history);
    rawFactors.friendliness.push(candidate.friendliness);
    rawFactors.recentLoad.push(candidate.recentLoad);
  }
  const ranges = {} as Record<FactorKey, { min: number; max: number }>;
  for (const key of FACTOR_KEYS) {
    const values = rawFactors[key];
    ranges[key] = { min: Math.min(...values), max: Math.max(...values) };
  }

  const normalizedByIndex: FactorScores[] = filtered.map((_candidate, index) => {
    const factors = {} as FactorScores;
    for (const key of FACTOR_KEYS) {
      const { min, max } = ranges[key];
      const raw = rawFactors[key][index];
      factors[key] = round(max === min ? 0.5 : clamp01((raw - min) / (max - min)));
    }
    return factors;
  });

  const weightSum = FACTOR_KEYS.reduce((sum, key) => sum + Math.max(0, weights[key] ?? 0), 0);
  const scored: ScoredCell[] = filtered.map((candidate, index) => {
    const factors = normalizedByIndex[index];
    let weighted = 0;
    for (const key of FACTOR_KEYS) weighted += Math.max(0, weights[key] ?? 0) * factors[key];
    const score = weightSum > 0 ? round(weighted / weightSum) : 0;
    return {
      weekday: candidate.weekday,
      slotId: candidate.slot.id,
      slotLabel: candidate.slot.label,
      startTime: candidate.slot.startTime,
      endTime: candidate.slot.endTime,
      score,
      freeCount: candidate.freeCount,
      totalUsers,
      blockLength: candidate.blockLength,
      factors,
      reasons: buildReasons(candidate, factors, totalUsers),
    };
  });

  scored.sort(
    (left, right) =>
      right.score - left.score ||
      left.weekday - right.weekday ||
      (sortOrderOfSlot(slots, left.slotId) - sortOrderOfSlot(slots, right.slotId)),
  );

  if (input.topK && input.topK > 0) return scored.slice(0, Math.floor(input.topK));
  return scored;
}

function sortOrderOfSlot(slots: TimeSlot[], slotId: number): number {
  return slots.find((slot) => slot.id === slotId)?.sortOrder ?? 0;
}

function buildReasons(candidate: CandidateCell, factors: FactorScores, totalUsers: number): string[] {
  const reasons: string[] = [];
  if (totalUsers > 0 && candidate.freeCount === totalUsers) reasons.push('全员空闲');
  else reasons.push('空闲 ' + candidate.freeCount + '/' + totalUsers + ' 人');
  if (candidate.blockLength >= 2) reasons.push('连续 ' + candidate.blockLength + ' 个时间段');
  reasons.push(DAY_PART_LABELS[candidate.slot.dayPart] + '时段友好度 ' + candidate.friendliness.toFixed(2));
  if (factors.history >= 0.8) reasons.push('历史上较少占用');
  if (factors.recentLoad >= 0.8) reasons.push('近期负担较轻');
  return reasons.slice(0, 3);
}

/** 算法 3：冲突最小化替代时段 */
export function getAlternatives(input: AlternativesInput): AlternativesResult {
  const semester = getActiveSemester();
  const slots = getSemesterSlots(semester);
  const sourceSlot = slots.find((slot) => slot.id === input.slotId);
  if (!sourceSlot) {
    throw badRequest('时间段不属于当前启用模板', [{ path: 'slotId', message: '时间段不属于当前启用模板' }]);
  }
  if (!Number.isInteger(input.weekday) || input.weekday < 1 || input.weekday > 7) {
    throw badRequest('weekday 必须为 1-7 的整数');
  }
  getUserById(input.userId);
  if (
    !Number.isInteger(input.startWeek) ||
    !Number.isInteger(input.endWeek) ||
    input.startWeek < 1 ||
    input.startWeek > input.endWeek ||
    input.endWeek > semester.totalWeeks
  ) {
    throw badRequest('周次范围不合法：' + input.startWeek + ' ~ ' + input.endWeek);
  }

  const weeks = expandWeeks(semester.week1Parity, input.startWeek, input.endWeek, input.parity);
  const activeUsers = listActiveUsers();
  const activeIds = activeUsers.map((user) => user.id);
  const totalUsers = activeUsers.length;
  const occupiedCounts = loadDistinctUserCounts(semester.id, weeks, activeIds);
  const userCells = loadUserCells(semester.id, weeks, input.userId);
  const sourceKey = cellKey(input.weekday, sourceSlot.id);
  const sortOrderOf = new Map(slots.map((slot) => [slot.id, slot.sortOrder]));

  const cells: AlternativeCell[] = [];
  for (const weekday of WEEKDAY_ORDER) {
    for (const slot of slots) {
      const key = cellKey(weekday, slot.id);
      if (key === sourceKey || userCells.has(key)) continue;
      const occupiedUsers = Math.min(occupiedCounts.get(key) ?? 0, totalUsers);
      const freeUsers = Math.max(0, totalUsers - occupiedUsers);
      cells.push({
        weekday,
        slotId: slot.id,
        slotLabel: slot.label,
        occupiedUsers,
        freeUsers,
        score: totalUsers > 0 ? round(freeUsers / totalUsers) : 0,
      });
    }
  }

  cells.sort(
    (left, right) =>
      left.occupiedUsers - right.occupiedUsers ||
      right.freeUsers - left.freeUsers ||
      right.score - left.score ||
      left.weekday - right.weekday ||
      (sortOrderOf.get(left.slotId) ?? 0) - (sortOrderOf.get(right.slotId) ?? 0),
  );

  const sourceOccupied = Math.min(occupiedCounts.get(sourceKey) ?? 0, totalUsers);
  const result: AlternativesResult = {
    cells: input.topK && input.topK > 0 ? cells.slice(0, Math.floor(input.topK)) : cells,
    source: {
      weekday: input.weekday,
      slotId: input.slotId,
      occupiedUsers: sourceOccupied,
      freeUsers: Math.max(0, totalUsers - sourceOccupied),
    },
  };
  return result;
}

/** 读取 algo_config.weights_json，缺失字段用默认值补齐 */
export function readRecommendConfig(): RecommendConfig {
  const row = get<{ weights_json: string }>('SELECT weights_json FROM algo_config WHERE id = 1');
  return parseRecommendConfig(row?.weights_json);
}

function parseRecommendConfig(text?: string): RecommendConfig {
  let parsed: Record<string, unknown> = {};
  if (text) {
    try {
      const raw = JSON.parse(text) as unknown;
      if (typeof raw === 'object' && raw !== null) parsed = raw as Record<string, unknown>;
    } catch {
      parsed = {};
    }
  }
  const weights: FactorScores = { ...DEFAULT_FACTOR_WEIGHTS };
  const weightRecord = parsed.weights;
  if (typeof weightRecord === 'object' && weightRecord !== null) {
    for (const key of FACTOR_KEYS) {
      const value = Number((weightRecord as Record<string, unknown>)[key]);
      if (Number.isFinite(value) && value >= 0) weights[key] = value;
    }
  }
  const dayPart: Record<DayPart, number> = { ...DEFAULT_RECOMMEND_CONFIG.dayPart };
  const dayPartRecord = parsed.dayPart;
  if (typeof dayPartRecord === 'object' && dayPartRecord !== null) {
    for (const key of ['morning', 'afternoon', 'evening'] as DayPart[]) {
      const value = Number((dayPartRecord as Record<string, unknown>)[key]);
      if (Number.isFinite(value) && value >= 0) dayPart[key] = value;
    }
  }
  const historyWeeksRaw = Number(parsed.historyWeeks);
  const recentWindowRaw = Number(parsed.recentWindow);
  return {
    weights,
    dayPart,
    historyWeeks: Number.isInteger(historyWeeksRaw) && historyWeeksRaw >= 0
      ? historyWeeksRaw
      : DEFAULT_RECOMMEND_CONFIG.historyWeeks,
    recentWindow: Number.isInteger(recentWindowRaw) && recentWindowRaw >= 0
      ? recentWindowRaw
      : DEFAULT_RECOMMEND_CONFIG.recentWindow,
  };
}

export function getRecommendConfig(): RecommendConfig {
  return readRecommendConfig();
}

/** 合并请求权重后归一化存储，修改即时生效 */
export function updateRecommendConfig(input: RecommendConfigInput): RecommendConfig {
  const current = readRecommendConfig();
  const mergedWeights: FactorScores = { ...current.weights, ...(input.weights ?? {}) };
  const weightSum = FACTOR_KEYS.reduce((sum, key) => sum + Math.max(0, mergedWeights[key] ?? 0), 0);
  if (!(weightSum > 0) || !Number.isFinite(weightSum)) {
    throw badRequest('权重之和必须大于 0', [{ path: 'weights', message: '权重之和必须大于 0' }]);
  }
  const weights = {} as FactorScores;
  for (const key of FACTOR_KEYS) {
    weights[key] = round(Math.max(0, mergedWeights[key] ?? 0) / weightSum);
  }
  const config: RecommendConfig = {
    weights,
    dayPart: { ...current.dayPart, ...(input.dayPart ?? {}) },
    historyWeeks: input.historyWeeks ?? current.historyWeeks,
    recentWindow: input.recentWindow ?? current.recentWindow,
  };
  run(
    `INSERT INTO algo_config (id, weights_json, updated_at)
     VALUES (1, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
     ON CONFLICT(id) DO UPDATE SET weights_json = excluded.weights_json, updated_at = excluded.updated_at`,
    [JSON.stringify(config)],
  );
  return readRecommendConfig();
}