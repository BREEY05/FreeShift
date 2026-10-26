import type { Parity, WeekParity } from '@freeshift/shared';
import { weekParityOf } from '@freeshift/shared';
import { run } from '../db/index.ts';

export interface ScheduleKey {
  id: number;
  semesterId: number;
  userId: number;
  weekday: number;
  slotId: number;
  startWeek: number;
  endWeek: number;
  parity: Parity;
}

/** 展开周次区间与单双周规则，返回命中周次列表 */
export function expandWeeks(
  week1Parity: WeekParity,
  startWeek: number,
  endWeek: number,
  parity: Parity,
): number[] {
  const weeks: number[] = [];
  for (let weekNo = startWeek; weekNo <= endWeek; weekNo += 1) {
    if (parity === 'all' || parity === weekParityOf(week1Parity, weekNo)) {
      weeks.push(weekNo);
    }
  }
  return weeks;
}

export function removeOccurrences(scheduleId: number): void {
  run('DELETE FROM schedule_occurrence WHERE schedule_id = ?', [scheduleId]);
}

export function insertOccurrences(schedule: ScheduleKey, weeks: number[]): void {
  const statement =
    'INSERT OR IGNORE INTO schedule_occurrence (semester_id, week_no, weekday, slot_id, user_id, schedule_id) VALUES (?, ?, ?, ?, ?, ?)';
  for (const weekNo of weeks) {
    run(statement, [
      schedule.semesterId,
      weekNo,
      schedule.weekday,
      schedule.slotId,
      schedule.userId,
      schedule.id,
    ]);
  }
}

/** 重建某条安排的展开点（调用方负责事务） */
export function refreshOccurrences(schedule: ScheduleKey, week1Parity: WeekParity): void {
  removeOccurrences(schedule.id);
  insertOccurrences(schedule, expandWeeks(week1Parity, schedule.startWeek, schedule.endWeek, schedule.parity));
}
