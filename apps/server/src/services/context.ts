import type { AppUser, Semester, TimeSlot, WeekInfo } from '@freeshift/shared';
import { buildWeeks } from '@freeshift/shared';
import { all, get } from '../db/index.ts';
import { AppError, notFound } from '../lib/errors.ts';
import type { SemesterRow, SlotRow, UserRow } from '../lib/mappers.ts';
import { mapSemester, mapSlot, mapUser } from '../lib/mappers.ts';

export function getActiveSemester(): Semester {
  const row = get<SemesterRow>('SELECT * FROM semester WHERE is_active = 1 LIMIT 1');
  if (!row) throw notFound('当前学期');
  return mapSemester(row);
}

export function getSemesterById(id: number): Semester {
  const row = get<SemesterRow>('SELECT * FROM semester WHERE id = ?', [id]);
  if (!row) throw notFound('学期');
  return mapSemester(row);
}

/** 未指定学期时取当前启用学期 */
export function resolveSemester(semesterId?: number | null): Semester {
  return semesterId ? getSemesterById(semesterId) : getActiveSemester();
}

export function getTemplateSlots(templateId: number | null): TimeSlot[] {
  if (!templateId) return [];
  const rows = all<SlotRow>('SELECT * FROM time_slot WHERE template_id = ? ORDER BY sort_order ASC', [templateId]);
  return rows.map(mapSlot);
}

export function getSemesterSlots(semester: Semester): TimeSlot[] {
  return getTemplateSlots(semester.activeTemplateId);
}

export function listActiveUsers(): AppUser[] {
  const rows = all<UserRow>('SELECT * FROM app_user WHERE is_active = 1 ORDER BY sort_order ASC, id ASC');
  return rows.map(mapUser);
}

export function getUserById(id: number): AppUser {
  const row = get<UserRow>('SELECT * FROM app_user WHERE id = ?', [id]);
  if (!row) throw notFound('用户');
  return mapUser(row);
}

export function resolveWeek(semester: Semester, weekNo?: number | null): WeekInfo {
  const weeks = buildWeeks(semester);
  const target = weekNo ?? weeks.find((week) => week.isCurrent)?.weekNo ?? 1;
  const found = weeks[target - 1];
  if (!found) {
    throw new AppError(422, 'INVALID_WEEK', '周次超出范围：' + target);
  }
  return found;
}

export function getActiveTemplateId(): number {
  const semester = getActiveSemester();
  if (!semester.activeTemplateId) {
    throw new AppError(422, 'NO_ACTIVE_TEMPLATE', '当前学期尚未设置时间段模板');
  }
  return semester.activeTemplateId;
}
