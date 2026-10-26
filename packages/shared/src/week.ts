import type { Semester, WeekInfo, WeekParity, Weekday } from './types.js';
import { WEEKDAY_LABELS } from './constants.js';

const DAY_MS = 86_400_000;

/** 解析 YYYY-MM-DD 为 UTC 零点的 Date，避免本地时区造成的偏移 */
export function parseDate(iso: string): Date {
  const date = new Date(iso + 'T00:00:00Z');
  if (Number.isNaN(date.getTime())) throw new Error('无效日期：' + iso);
  return date;
}

export function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDays(iso: string, days: number): string {
  const date = parseDate(iso);
  date.setUTCDate(date.getUTCDate() + days);
  return formatDate(date);
}

/** 指定时区的今天，YYYY-MM-DD */
export function todayIso(timeZone = 'Asia/Shanghai'): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

/** 某一周的奇偶性（单周/双周），考虑学期第 1 周的奇偶设定 */
export function weekParityOf(week1Parity: WeekParity, weekNo: number): WeekParity {
  const isOddWeek = weekNo % 2 === 1;
  return (week1Parity === 'odd') === isOddWeek ? 'odd' : 'even';
}

/** 第 weekNo 周的周一与周日 */
export function weekRange(startDate: string, weekNo: number): { startDate: string; endDate: string } {
  const start = addDays(startDate, (weekNo - 1) * 7);
  return { startDate: start, endDate: addDays(start, 6) };
}

export function buildWeeks(
  semester: Pick<Semester, 'startDate' | 'totalWeeks' | 'week1Parity'>,
  today: string = todayIso(),
): WeekInfo[] {
  const weeks: WeekInfo[] = [];
  for (let weekNo = 1; weekNo <= semester.totalWeeks; weekNo += 1) {
    const { startDate, endDate } = weekRange(semester.startDate, weekNo);
    weeks.push({
      weekNo,
      parity: weekParityOf(semester.week1Parity, weekNo),
      startDate,
      endDate,
      isCurrent: today >= startDate && today <= endDate,
    });
  }
  return weeks;
}

export function currentWeekNo(
  semester: Pick<Semester, 'startDate' | 'totalWeeks' | 'week1Parity'>,
  today: string = todayIso(),
): number | null {
  const current = buildWeeks(semester, today).find((week) => week.isCurrent);
  return current ? current.weekNo : null;
}

export function isWeekIncluded(parity: 'all' | WeekParity, weekParity: WeekParity): boolean {
  return parity === 'all' || parity === weekParity;
}

/** 第 weekNo 周的日期区间字符串，如 2026-03-02 ~ 2026-03-08 */
export function weekDateLabel(week: WeekInfo): string {
  return week.startDate + ' ~ ' + week.endDate;
}

export function weekLabel(week: WeekInfo): string {
  return '第 ' + week.weekNo + ' 周 · ' + (week.parity === 'odd' ? '单周' : '双周');
}

export function weekdayLabel(weekday: Weekday): string {
  return WEEKDAY_LABELS[weekday];
}

/** 两个 YYYY-MM-DD 是否同一周（以周一为界） */
export function isSameWeek(a: string, b: string): boolean {
  const dateA = parseDate(a);
  const dateB = parseDate(b);
  const diff = Math.abs(dateA.getTime() - dateB.getTime());
  return diff < 7 * DAY_MS;
}
