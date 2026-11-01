import { randomBytes } from 'node:crypto';
import type { SqlValue } from '../db/index.ts';
import { all, get, getDb, run, transaction } from '../db/index.ts';
import { presetTemplates, seedDefaults } from '../db/seed-defaults.ts';
import { AppError, notFound } from '../lib/errors.ts';
import { ensureUserForEmail } from './tableService.ts';

interface OrgRow { id: number; name: string; code: string; owner_email: string; created_at: string; template_id: number | null }
interface MemberRow { org_id: number; email: string; role: 'owner' | 'member'; status: 'pending' | 'approved'; created_at: string; table_name?: string | null }

export interface OrgView {
  id: number;
  name: string;
  code: string;
  ownerEmail: string;
  createdAt: string;
  templateId: number | null;
  templateName: string | null;
}

export interface OrgMemberView {
  orgId: number;
  email: string;
  role: 'owner' | 'member';
  status: 'pending' | 'approved';
  createdAt: string;
  tableName: string | null;
}

export interface OrgSearchView extends OrgView {
  memberCount: number;
  myStatus: 'owner' | 'member' | 'pending' | null;
}

function templateNameOf(templateId: number | null): string | null {
  if (templateId === null || templateId === undefined) return null;
  const row = get<{ name: string }>('SELECT name FROM slot_template WHERE id = ?', [Number(templateId)]);
  return row?.name ?? null;
}

function toOrgView(row: OrgRow): OrgView {
  const templateId = row.template_id === null || row.template_id === undefined ? null : Number(row.template_id);
  return {
    id: Number(row.id),
    name: row.name,
    code: row.code,
    ownerEmail: row.owner_email,
    createdAt: row.created_at,
    templateId,
    templateName: templateNameOf(templateId),
  };
}

export const orgById = (id: number): OrgView => {
  const row = get<OrgRow>('SELECT * FROM organization WHERE id = ?', [id]);
  if (!row) throw notFound('组织');
  return toOrgView(row);
};

/** 组织成员（pending / approved），并带上每人当前个人表名称。 */
export function members(orgId: number, status: 'pending' | 'approved' = 'approved'): OrgMemberView[] {
  return all<MemberRow>(
    'SELECT m.*, t.name AS table_name FROM org_member m ' +
      'LEFT JOIN app_user u ON u.org_id = m.org_id AND lower(u.email) = lower(m.email) ' +
      'LEFT JOIN slot_template t ON t.id = u.template_id ' +
      'WHERE m.org_id = ? AND m.status = ? ORDER BY m.created_at, m.email',
    [orgId, status],
  ).map((row) => ({
    orgId: Number(row.org_id),
    email: row.email,
    role: row.role,
    status: row.status,
    createdAt: row.created_at,
    tableName: row.table_name ?? null,
  }));
}

export function ownerOnly(orgId: number, email: string): void {
  if (orgById(orgId).ownerEmail !== email) throw new AppError(403, 'FORBIDDEN', '仅组织创建者可操作');
}

/** 该邮箱可访问的组织列表（负责的组织在前，其次为已审批加入的组织）。 */
export function listOrgs(email: string) {
  const rows = all<OrgRow & { member_role: string }>(
    "SELECT o.*, CASE WHEN o.owner_email = ? THEN 'owner' ELSE COALESCE(m.role,'member') END AS member_role " +
      'FROM organization o LEFT JOIN org_member m ON m.org_id = o.id AND m.email = ? ' +
      "WHERE o.owner_email = ? OR (m.email = ? AND m.status = 'approved') " +
      'ORDER BY CASE WHEN o.owner_email = ? THEN 0 ELSE 1 END, o.id',
    [email, email, email, email, email] as SqlValue[],
  );
  return rows.map((row) => ({
    org: toOrgView(row),
    role: row.owner_email === email ? ('owner' as const) : ('member' as const),
  }));
}

/** 组织广场：全部组织（可按名称/ID 模糊搜索）+ 我的身份状态。任何人可调用。 */
export function searchOrgs(email: string, query?: string): OrgSearchView[] {
  const q = (query ?? '').trim();
  const rows = all<OrgRow & { member_count: number | bigint; my_role: string | null; my_status: string | null }>(
    'SELECT o.*, ' +
      "(SELECT COUNT(*) FROM org_member m WHERE m.org_id = o.id AND m.status = 'approved') AS member_count, " +
      '(SELECT m.role FROM org_member m WHERE m.org_id = o.id AND m.email = ?) AS my_role, ' +
      '(SELECT m.status FROM org_member m WHERE m.org_id = o.id AND m.email = ?) AS my_status ' +
      'FROM organization o ' +
      "WHERE (? = '' OR lower(o.name) LIKE ? OR upper(o.code) LIKE ?) " +
      'ORDER BY o.id',
    [email, email, q, '%' + q.toLowerCase() + '%', '%' + q.toUpperCase() + '%'] as SqlValue[],
  );
  return rows.map((row) => {
    const view = toOrgView(row);
    const role = row.my_role === 'owner' || row.my_role === 'member' ? (row.my_role as 'owner' | 'member') : null;
    const status = row.my_status === 'pending' ? ('pending' as const) : role;
    return {
      ...view,
      memberCount: Number(row.member_count ?? 0),
      myStatus: view.ownerEmail === email ? ('owner' as const) : status,
    };
  });
}

export function orgPresets(): { name: string; description: string; slotCount: number }[] {
  return presetTemplates();
}

/** 组织详情；除组织的 owner_email 外，被授予 owner 角色的成员同样可管理。 */
export function orgDetails(orgId: number, email: string) {
  const org = orgById(orgId);
  const staff = canManage(orgId, email);
  return { org, members: members(orgId), requests: staff ? members(orgId, 'pending') : [] };
}

/** 组织管理者：创建者或组织内被授予 owner 角色的成员。 */
export function canManage(orgId: number, email: string): boolean {
  if (orgById(orgId).ownerEmail === email) return true;
  return Boolean(get("SELECT 1 AS x FROM org_member WHERE org_id=? AND email=? AND role='owner' AND status='approved'", [orgId, email]));
}

/** 仅创建者：授予/收回组织内 owner 角色、重命名、删除组织。 */
export function creatorOnly(orgId: number, email: string): void {
  if (orgById(orgId).ownerEmail !== email) throw new AppError(403, 'FORBIDDEN', '仅组织创建者可操作');
}

function templateIdByName(orgId: number, name: string): number | null {
  const row = get<{ id: number | bigint }>('SELECT id FROM slot_template WHERE org_id = ? AND name = ?', [orgId, name]);
  return row ? Number(row.id) : null;
}

/**
 * 创建组织：必须给出名字与组织时间类型（内置预设名）。
 * 播种 5 个预设模板后，把选中的预设设为组织模板与当前学期启用模板。
 */
export function createOrg(name: string, email: string, presetName: string) {
  const preset = presetTemplates().find((item) => item.name === presetName);
  if (!preset) throw new AppError(422, 'UNKNOWN_PRESET', '请选择内置的时间类型');
  const orgId = transaction(() => {
    const id = Number(
      run('INSERT INTO organization(name, code, owner_email) VALUES(?, ?, ?)', [
        name,
        randomBytes(4).toString('hex').toUpperCase(),
        email,
      ]).lastInsertRowid,
    );
    run("INSERT INTO org_member(org_id, email, role, status) VALUES(?, ?, 'owner', 'approved')", [id, email]);
    seedDefaults(getDb());
    const templateId = templateIdByName(id, preset.name);
    if (templateId !== null) {
      run('UPDATE organization SET template_id = ? WHERE id = ?', [templateId, id]);
      run("UPDATE semester SET active_template_id = ? WHERE org_id = ? AND is_active = 1", [templateId, id]);
    }
    return id;
  });
  return orgDetails(orgId, email);
}

/** 加入组织：已加入返回现状，否则写 pending 申请（创建人审批）。 */
export function joinOrg(input: { orgId?: number | null; code?: string | null }, email: string) {
  let row: OrgRow | undefined;
  if (input.orgId !== undefined && input.orgId !== null) {
    row = get<OrgRow>('SELECT * FROM organization WHERE id = ?', [input.orgId]);
  } else if (input.code) {
    row = get<OrgRow>('SELECT * FROM organization WHERE code = ?', [String(input.code).trim().toUpperCase()]);
  }
  if (!row) throw notFound('组织');
  const orgId = Number(row.id);
  if (row.owner_email === email) return { org: toOrgView(row), status: 'approved' as const };
  const existing = get<MemberRow>('SELECT * FROM org_member WHERE org_id = ? AND email = ?', [orgId, email]);
  if (existing) {
    return { org: toOrgView(row), status: existing.status === 'approved' ? ('approved' as const) : ('pending' as const) };
  }
  run("INSERT INTO org_member(org_id, email, role, status) VALUES(?, ?, 'member', 'pending')", [orgId, email]);
  return { org: toOrgView(row), status: 'pending' as const };
}

/**
 * 审批加入申请：通过时落库 org_member 并自动建立成员档案（app_user，个人表=组织模板）。
 * 幂等：已经 approved 时只补建 app_user。
 */
export function reviewMember(orgId: number, actor: string, email: string, approve: boolean): void {
  if (!canManage(orgId, actor)) throw new AppError(403, 'FORBIDDEN', '仅组织负责人可操作');
  const member = get<MemberRow>('SELECT * FROM org_member WHERE org_id=? AND email=?', [orgId, email]);
  if (!member) throw notFound('加入申请');
  if (approve) {
    if (member.status !== 'approved') run("UPDATE org_member SET status='approved' WHERE org_id=? AND email=?", [orgId, email]);
    ensureUserForEmail(orgId, email);
    return;
  }
  if (member.status !== 'pending') throw notFound('加入申请');
  run('DELETE FROM org_member WHERE org_id=? AND email=?', [orgId, email]);
}

/**
 * 组织负责人直接添加成员（免申请）：写入 approved 成员关系并立即建档。
 * 建档时个人表默认取组织模板，所以新成员在「组织表」里马上就是可用状态。
 */
export function addMember(orgId: number, actor: string, email: string, name?: string | null): void {
  if (!canManage(orgId, actor)) throw new AppError(403, 'FORBIDDEN', '仅组织负责人可操作');
  const normalized = email.trim().toLowerCase();
  if (normalized === '') throw new AppError(422, 'VALIDATION_ERROR', '请输入成员邮箱');
  if (normalized === orgById(orgId).ownerEmail) throw new AppError(409, 'ALREADY_MEMBER', '该邮箱是组织创建者');
  const existing = get<MemberRow>('SELECT * FROM org_member WHERE org_id = ? AND email = ?', [orgId, normalized]);
  if (existing?.status === 'approved') throw new AppError(409, 'ALREADY_MEMBER', '该邮箱已是组织成员');
  if (existing) {
    run("UPDATE org_member SET status = 'approved' WHERE org_id = ? AND email = ?", [orgId, normalized]);
  } else {
    run("INSERT INTO org_member(org_id, email, role, status) VALUES(?, ?, 'member', 'approved')", [orgId, normalized]);
  }
  const member = ensureUserForEmail(orgId, normalized);
  const displayName = (name ?? '').trim();
  if (displayName === '' || displayName === member.name) return;
  const taken = get('SELECT 1 AS x FROM app_user WHERE org_id = ? AND name = ? AND id <> ?', [orgId, displayName, member.id]);
  if (taken) throw new AppError(409, 'USER_EXISTS', '该显示名已被占用，请换一个');
  run('UPDATE app_user SET name = ? WHERE id = ? AND org_id = ?', [displayName.slice(0, 40), member.id, orgId]);
}

/** 管理员（组织负责人）移除成员；创建者不能被移除。 */
export function removeMember(orgId: number, actor: string, email: string): void {
  if (!canManage(orgId, actor)) throw new AppError(403, 'FORBIDDEN', '仅组织负责人可操作');
  if (orgById(orgId).ownerEmail === email) throw new AppError(409, 'OWNER_CANNOT_LEAVE', '组织创建者不能被移除');
  run('DELETE FROM org_member WHERE org_id=? AND email=?', [orgId, email]);
}

/** 退出组织：创建者不能退出，组织至少保留一位管理员。 */
export function leaveOrg(orgId: number, email: string): void {
  if (orgById(orgId).ownerEmail === email) throw new AppError(409, 'OWNER_CANNOT_LEAVE', '组织创建者不能退出组织');
  const admins = all<{ email: string }>("SELECT email FROM org_member WHERE org_id=? AND role='owner' AND status='approved'", [orgId]);
  const me = get<MemberRow>('SELECT * FROM org_member WHERE org_id=? AND email=?', [orgId, email]);
  if (me?.role === 'owner' && admins.length <= 1) throw new AppError(403, 'LAST_ADMIN', '组织至少需要保留一位管理员');
  run('DELETE FROM org_member WHERE org_id=? AND email=?', [orgId, email]);
}

/** 设置组织内成员的管理员权限（仅创建者，不能修改自己）。 */
export function setMemberRole(orgId: number, actor: string, email: string, role: 'owner' | 'member'): void {
  creatorOnly(orgId, actor);
  if (email === actor) throw new AppError(403, 'LAST_ADMIN', '不能修改自己的组织权限');
  const org = orgById(orgId);
  const member = get<MemberRow>('SELECT * FROM org_member WHERE org_id=? AND email=?', [orgId, email]);
  if (!member || member.status !== 'approved') throw notFound('组织成员');
  if (member.role === role) return;
  if (role === 'member') {
    const admins = all<{ email: string }>("SELECT email FROM org_member WHERE org_id=? AND role='owner' AND status='approved'", [orgId]);
    if (admins.length <= 1) throw new AppError(403, 'LAST_ADMIN', '组织至少需要保留一位管理员');
  } else if (org.ownerEmail === email) return;
  run('UPDATE org_member SET role=? WHERE org_id=? AND email=?', [role, orgId, email]);
}

export function orgTemplateName(orgId: number): string | null {
  return templateNameOf(orgById(orgId).templateId);
}
