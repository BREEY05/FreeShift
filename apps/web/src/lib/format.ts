import type { Parity, Weekday } from '@freeshift/shared';
import { PARITY_LABELS, WEEKDAY_LABELS } from '@freeshift/shared';

function parseIso(iso: string): { year: number; month: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return null;
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

/** 2026-03-02 -> 3月2日 */
export function monthDayLabel(iso: string): string {
  const parsed = parseIso(iso);
  if (!parsed) return iso;
  return parsed.month + '月' + parsed.day + '日';
}

/** 2026-03-02 -> 3/2 */
export function monthDayShortLabel(iso: string): string {
  const parsed = parseIso(iso);
  if (!parsed) return iso;
  return parsed.month + '/' + parsed.day;
}

/** 3月2日 – 3月8日 */
export function formatWeekSpan(startDate: string, endDate: string): string {
  return monthDayLabel(startDate) + ' – ' + monthDayLabel(endDate);
}

/** 周一 3/2 */
export function weekdayDateLabel(weekday: Weekday, iso: string): string {
  return WEEKDAY_LABELS[weekday] + ' ' + monthDayShortLabel(iso);
}

/** 第 3 周 / 第 1–8 周 */
export function weekRangeLabel(startWeek: number, endWeek: number): string {
  if (startWeek === endWeek) return '第 ' + startWeek + ' 周';
  return '第 ' + startWeek + '–' + endWeek + ' 周';
}

/** 第 1–8 周 · 每周 */
export function scheduleRangeLabel(startWeek: number, endWeek: number, parity: Parity): string {
  return weekRangeLabel(startWeek, endWeek) + ' · ' + PARITY_LABELS[parity];
}

export function peopleLabel(count: number): string {
  return count + ' 人';
}

export function clampNumber(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.min(Math.max(value, min), max);
}

export function truncateEnd(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 1) + '…';
}
