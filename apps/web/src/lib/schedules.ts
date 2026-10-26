import type { BatchCellInput, Schedule, WeekInfo, Weekday } from '@freeshift/shared';
import { isWeekIncluded } from '@freeshift/shared';

/** 格子唯一键：weekday:slotId */
export function cellKey(weekday: Weekday, slotId: number): string {
  return weekday + ':' + slotId;
}

export function parseCellKey(key: string): { weekday: Weekday; slotId: number } | null {
  const [weekdayText, slotText] = key.split(':');
  const weekday = Number(weekdayText);
  const slotId = Number(slotText);
  if (!Number.isInteger(weekday) || weekday < 1 || weekday > 7) return null;
  if (!Number.isInteger(slotId) || slotId <= 0) return null;
  return { weekday: weekday as Weekday, slotId };
}

/** 该安排是否覆盖指定周（区间 + 单双周） */
export function scheduleCoversWeek(schedule: Schedule, week: WeekInfo): boolean {
  if (schedule.startWeek > week.weekNo || schedule.endWeek < week.weekNo) return false;
  return isWeekIncluded(schedule.parity, week.parity);
}

/** 在安排列表中定位某用户某周某格子的安排（用于展示备注） */
export function findCellSchedule(
  schedules: Schedule[] | undefined,
  week: WeekInfo | undefined,
  weekday: Weekday,
  slotId: number,
  userId: number,
): Schedule | undefined {
  if (!schedules || !week) return undefined;
  return schedules.find(
    (schedule) =>
      schedule.userId === userId &&
      schedule.weekday === weekday &&
      schedule.slotId === slotId &&
      scheduleCoversWeek(schedule, week),
  );
}

/** 选中格子 -> 批量接口需要的 cells（按星期分组、slotIds 升序） */
export function groupBatchCells(keys: Iterable<string>): BatchCellInput[] {
  const grouped = new Map<Weekday, number[]>();
  for (const key of keys) {
    const parsed = parseCellKey(key);
    if (!parsed) continue;
    const list = grouped.get(parsed.weekday) ?? [];
    if (!list.includes(parsed.slotId)) list.push(parsed.slotId);
    grouped.set(parsed.weekday, list);
  }
  return Array.from(grouped.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([weekday, slotIds]) => ({ weekday, slotIds: [...slotIds].sort((a, b) => a - b) }));
}

export function countKeys(keys: Iterable<string>): number {
  let count = 0;
  for (const _ of keys) count += 1;
  return count;
}
