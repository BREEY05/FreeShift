import type { AppUser, Semester, TimeSlot, WeekInfo } from '@freeshift/shared';
import { buildWeeks, todayIso } from '@freeshift/shared';
import { all, get } from '../db/index.ts';
import { AppError, notFound } from '../lib/errors.ts';
import type { SemesterRow, SlotRow, UserRow } from '../lib/mappers.ts';
import { mapSemester, mapSlot, mapUser } from '../lib/mappers.ts';

export function defaultOrgId(): number {
  const row = get<{id: number}>('SELECT id FROM organization ORDER BY id LIMIT 1');
  if (!row) throw notFound('组织');
  return Number(row.id);
}

export function getActiveSemester(orgId = defaultOrgId()): Semester {
  const row = get<SemesterRow>('SELECT * FROM semester WHERE is_active = 1 AND org_id = ? LIMIT 1', [orgId]);
  if (!row) throw notFound('当前学期');
  return mapSemester(row);
}

export function getSemesterById(id: number, orgId = defaultOrgId()): Semester {
  const row = get<SemesterRow>('SELECT * FROM semester WHERE id = ? AND org_id = ?', [id, orgId]);
  if (!row) throw notFound('学期');
  return mapSemester(row);
}

/** 未指定学期时取当前启用学期 */
export function resolveSemester(semesterId?: number | null, orgId = defaultOrgId()): Semester {
  return semesterId ? getSemesterById(semesterId, orgId) : getActiveSemester(orgId);
}

export function getTemplateSlots(templateId: number | null): TimeSlot[] {
  if (!templateId) return [];
  const rows = all<SlotRow>('SELECT * FROM time_slot WHERE template_id = ? ORDER BY sort_order ASC', [templateId]);
  return rows.map(mapSlot);
}

export function getSemesterSlots(semester: Semester): TimeSlot[] {
  return getTemplateSlots(semester.activeTemplateId);
}

/** 成员查询统一带上个人表模板名，供前端展示「我的表 / 成员表」。 */
export const USER_SELECT =
  'SELECT u.*, t.name AS template_name FROM app_user u LEFT JOIN slot_template t ON t.id = u.template_id';

export function listActiveUsers(orgId = defaultOrgId()): AppUser[] {
  const rows = all<UserRow>(USER_SELECT + ' WHERE u.is_active = 1 AND u.org_id = ? ORDER BY u.sort_order ASC, u.id ASC', [orgId]);
  return rows.map(mapUser);
}

export function getUserById(id: number, orgId = defaultOrgId()): AppUser {
  const row = get<UserRow>(USER_SELECT + ' WHERE u.id = ? AND u.org_id = ?', [id, orgId]);
  if (!row) throw notFound('用户');
  return mapUser(row);
}

/**
 * 解析要展示的周次。
 * - 显式传入 weekNo 时严格校验，越界报 422；
 * - 未传入时优先取"真实世界的当前周"；当前日期落在学期之外（假期 / 学期已过）时，
 *   取最近的边界周（学期未开始取第 1 周，已结束取最后一周），而不是固定回落到第 1 周。
 */
export function resolveWeek(semester: Semester, weekNo?: number | null): WeekInfo {
  const weeks = buildWeeks(semester);
  if (weeks.length === 0) {
    throw new AppError(422, 'INVALID_WEEK', '学期还没有任何周次');
  }
  if (weekNo === null || weekNo === undefined) {
    const current = weeks.find((week) => week.isCurrent);
    if (current) return current;
    const today = todayIso();
    const first = weeks[0];
    const last = weeks[weeks.length - 1];
    if (today < first.startDate) return first;
    if (today > last.endDate) return last;
    return first;
  }
  const found = weeks[weekNo - 1];
  if (!found) {
    throw new AppError(422, 'INVALID_WEEK', '周次超出范围：' + weekNo);
  }
  return found;
}

export function getActiveTemplateId(orgId = defaultOrgId()): number {
  const semester = getActiveSemester(orgId);
  if (!semester.activeTemplateId) {
    throw new AppError(422, 'NO_ACTIVE_TEMPLATE', '当前学期尚未设置时间段模板');
  }
  return semester.activeTemplateId;
}
