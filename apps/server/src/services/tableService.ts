import { DEFAULT_USER_COLORS } from '@freeshift/shared';
import type { TimeSlot } from '@freeshift/shared';
import { all, get, run } from '../db/index.ts';
import { AppError, notFound } from '../lib/errors.ts';
import type { SlotRow, TemplateRow, UserRow } from '../lib/mappers.ts';
import { mapSlot, mapUser } from '../lib/mappers.ts';
import { getTemplateSlots, USER_SELECT } from './context.ts';

/**
 * 个人表 / 组织时间类型 / 规范时间段（canonical slot）服务。
 * 契约：docs/REDESIGN-CONTRACT.md 2.1 与 5.1。
 *
 * 调度数据（schedule / schedule_occurrence）里的 slot_id 一律指向「组织参考模板」的
 * time_slot.id；参考模板 = 当前学期 active_template_id ?? organization.template_id。
 * 用户个人表可以和参考模板不是同一批行，写路径负责映射，读路径负责反向映射。
 */

/** 离线模式（AUTH_ENABLED=false）没有真实登录邮箱，权限判断一律放宽。 */
export function isOfflineAuth(): boolean {
  return process.env.AUTH_ENABLED === 'false';
}

export function orgTemplateId(orgId: number): number | null {
  const row = get<{ template_id?: number | null }>('SELECT template_id FROM organization WHERE id = ?', [orgId]);
  if (!row || row.template_id === null || row.template_id === undefined) return null;
  return Number(row.template_id);
}

/** 组织参考模板：当前学期启用模板优先，退回组织模板。 */
export function referenceTemplateId(orgId: number): number | null {
  const row = get<{ active_template_id?: number | null }>(
    'SELECT active_template_id FROM semester WHERE org_id = ? AND is_active = 1 LIMIT 1',
    [orgId],
  );
  const active = row?.active_template_id === null || row?.active_template_id === undefined ? null : Number(row.active_template_id);
  return active ?? orgTemplateId(orgId);
}

function slotsOf(templateId: number): SlotRow[] {
  return all<SlotRow>('SELECT * FROM time_slot WHERE template_id = ? ORDER BY sort_order ASC', [templateId]);
}

function normalizeTime(value: string | null | undefined): string | null {
  return value === null || value === undefined || value === '' ? null : value;
}

function sameTime(a: Pick<SlotRow, 'start_time' | 'end_time'>, b: Pick<SlotRow, 'start_time' | 'end_time'>): boolean {
  return normalizeTime(a.start_time) === normalizeTime(b.start_time) && normalizeTime(a.end_time) === normalizeTime(b.end_time);
}

/** 同一时间类型：按 sort_order 对齐后 start_time / end_time 完全一致。 */
export function sameSlotType(a: number, b: number): boolean {
  if (a === b) return true;
  const slotsA = slotsOf(a);
  const slotsB = slotsOf(b);
  if (slotsA.length !== slotsB.length) return false;
  return slotsA.every((slot, index) => sameTime(slot, slotsB[index]!));
}

function nameFromEmail(email: string): string {
  const local = email.split('@')[0]?.trim() ?? '';
  return local === '' ? '成员' : local.slice(0, 40);
}

export function userRowByEmail(orgId: number, email: string): UserRow | undefined {
  return get<UserRow>(USER_SELECT + ' WHERE u.org_id = ? AND lower(u.email) = lower(?)', [orgId, email]);
}

/** 会话邮箱在该组织还没有 app_user 时自动建立（个人表 = 组织模板）。 */
export function ensureUserForEmail(orgId: number, email: string): UserRow {
  const existing = userRowByEmail(orgId, email);
  if (existing) return existing;
  const org = get<{ owner_email: string }>('SELECT owner_email FROM organization WHERE id = ?', [orgId]);
  if (!org) throw notFound('组织');
  const base = nameFromEmail(email);
  const count = get<{ n: number | bigint }>('SELECT COUNT(*) AS n FROM app_user WHERE org_id = ?', [orgId]);
  const color = DEFAULT_USER_COLORS[Number(count?.n ?? 0) % DEFAULT_USER_COLORS.length]!;
  const maxOrder = get<{ m: number | bigint | null }>('SELECT MAX(sort_order) AS m FROM app_user WHERE org_id = ?', [orgId]);
  const sortOrder = maxOrder?.m === null || maxOrder?.m === undefined ? 0 : Number(maxOrder.m) + 1;
  let name = base;
  let suffix = 1;
  while (get('SELECT 1 AS x FROM app_user WHERE org_id = ? AND name = ?', [orgId, name])) {
    suffix += 1;
    name = base + '_' + suffix;
  }
  run(
    'INSERT INTO app_user(org_id, name, color, note, is_active, sort_order, email, template_id) VALUES (?, ?, ?, ?, 1, ?, ?, ?)',
    [orgId, name, color, '', sortOrder, email.toLowerCase(), orgTemplateId(orgId)],
  );
  const created = userRowByEmail(orgId, email);
  if (!created) throw new AppError(500, 'USER_CREATE_FAILED', '成员档案创建失败');
  return created;
}

export function getUserRow(orgId: number, userId: number): UserRow | undefined {
  return get<UserRow>(USER_SELECT + ' WHERE u.id = ? AND u.org_id = ?', [userId, orgId]);
}

/** 个人表模板：app_user.template_id ?? 组织模板 ?? 参考模板。 */
export function personalTemplateId(orgId: number, userId: number): number | null {
  const row = get<{ template_id?: number | null }>('SELECT template_id FROM app_user WHERE id = ? AND org_id = ?', [userId, orgId]);
  if (!row) throw notFound('用户');
  if (row.template_id !== null && row.template_id !== undefined) {
    const template = get('SELECT 1 AS x FROM slot_template WHERE id = ? AND org_id = ?', [Number(row.template_id), orgId]);
    if (template) return Number(row.template_id);
  }
  return orgTemplateId(orgId) ?? referenceTemplateId(orgId);
}

export function personalSlots(orgId: number, userId: number): TimeSlot[] {
  const templateId = personalTemplateId(orgId, userId);
  if (!templateId) return [];
  return getTemplateSlots(templateId);
}

/**
 * 模板写权限：
 * - 预设（is_preset=1）永远只读（管理员也不例外）；
 * - 个人表：仅 owner 或平台管理员；
 * - 组织共享模板：仅平台管理员。
 * 离线模式一律放行。
 */
export function assertTemplateWritable(orgId: number, templateId: number, email: string | null, isAdmin: boolean): void {
  const row = get<TemplateRow>('SELECT * FROM slot_template WHERE id = ? AND org_id = ?', [templateId, orgId]);
  if (!row) throw notFound('模板');
  if (Number(row.is_preset) === 1) throw new AppError(409, 'TEMPLATE_READONLY', '预设模板只读，请先克隆后编辑');
  if (isAdmin || isOfflineAuth()) return;
  const owner = row.owner_email ?? null;
  if (owner === null) throw new AppError(403, 'TEMPLATE_FORBIDDEN', '只有管理员可以修改组织共享模板');
  if (!email || owner.toLowerCase() !== email.toLowerCase()) {
    throw new AppError(403, 'TEMPLATE_FORBIDDEN', '只能修改自己创建的表');
  }
}

/** 任意模板 slot → 参考模板 slot（同起止时间优先，其次同 sort_order），映射不到 422。 */
export function canonicalSlotId(orgId: number, slotId: number): number {
  const slot = get<SlotRow & { template_org_id: number }>(
    'SELECT s.*, t.org_id AS template_org_id FROM time_slot s JOIN slot_template t ON t.id = s.template_id WHERE s.id = ?',
    [slotId],
  );
  if (!slot) throw notFound('时间段');
  const ref = referenceTemplateId(orgId);
  if (Number(slot.template_org_id) !== orgId) throw new AppError(422, 'SLOT_NOT_COMPATIBLE', '该时间段不属于当前组织');
  if (ref === null) throw new AppError(422, 'NO_ACTIVE_TEMPLATE', '当前组织尚未确定时间类型模板');
  if (Number(slot.template_id) === ref) return slotId;
  const refSlots = slotsOf(ref);
  const byTime = refSlots.find((candidate) => sameTime(candidate, slot));
  if (byTime) return Number(byTime.id);
  const byOrder = refSlots.find((candidate) => Number(candidate.sort_order) === Number(slot.sort_order));
  if (byOrder) return Number(byOrder.id);
  throw new AppError(
    422,
    'SLOT_NOT_COMPATIBLE',
    '时间段「' + slot.label + '」不在组织时间类型内，请先在「时间段」页选用与组织模板同类型的表',
  );
}

/** 参考模板 slot → 指定模板 slot（反向映射）；映射不到返回 null。 */
export function slotIdInTemplate(orgId: number, canonicalId: number, templateId: number): number | null {
  const slot = get<SlotRow & { template_org_id: number }>(
    'SELECT s.*, t.org_id AS template_org_id FROM time_slot s JOIN slot_template t ON t.id = s.template_id WHERE s.id = ?',
    [canonicalId],
  );
  if (!slot || Number(slot.template_org_id) !== orgId) return null;
  const candidates = all<SlotRow>('SELECT * FROM time_slot WHERE template_id = ? ORDER BY sort_order ASC', [templateId]);
  const byTime = candidates.find((candidate) => sameTime(candidate, slot));
  if (byTime) return Number(byTime.id);
  const byOrder = candidates.find((candidate) => Number(candidate.sort_order) === Number(slot.sort_order));
  return byOrder ? Number(byOrder.id) : null;
}

/**
 * 把一条调度的（参考模板）时间段映射回某个人的个人表时间段。
 * 用于个人看板：个人表可以和参考模板行 id 不同。
 */
export function matchPersonalSlot(
  slots: TimeSlot[],
  slot: Pick<TimeSlot, 'startTime' | 'endTime' | 'sortOrder'>,
): TimeSlot | null {
  const byTime = slots.find(
    (candidate) =>
      normalizeTime(candidate.startTime) === normalizeTime(slot.startTime) &&
      normalizeTime(candidate.endTime) === normalizeTime(slot.endTime),
  );
  if (byTime) return byTime;
  const byOrder = slots.find((candidate) => candidate.sortOrder === slot.sortOrder);
  return byOrder ?? null;
}

/** 把 app_user 行规范成共享 AppUser（联表模板名）。 */
export function mapUserRow(row: UserRow) {
  return mapUser(row);
}

/** 模板行 → 共享 SlotTemplate 基础结构（上下文字段由调用方覆盖）。 */
export function mapTemplateRow(row: TemplateRow) {
  return mapSlotTemplate(row);
}

function mapSlotTemplate(row: TemplateRow) {
  return {
    id: Number(row.id),
    name: row.name,
    description: row.description,
    isPreset: Number(row.is_preset) === 1,
    slotCount: Number(row.slot_count ?? 0),
    isActive: Number(row.is_active ?? 0) === 1,
    createdAt: row.created_at,
    ownerEmail: row.owner_email ?? null,
    isMine: false,
    isOrgTemplate: false,
    sameTypeAsOrg: false,
  };
}
