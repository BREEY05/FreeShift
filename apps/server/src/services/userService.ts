import { z } from 'zod';
import { DEFAULT_USER_COLORS } from '@freeshift/shared';
import type { AppUser } from '@freeshift/shared';
import { all, get, run, transaction, type SqlValue } from '../db/index.ts';
import { AppError, notFound } from '../lib/errors.ts';
import { mapUser, type UserRow } from '../lib/mappers.ts';
import { defaultOrgId, getUserById } from './context.ts';

export const userInputSchema = z.object({
  name: z
    .string({ required_error: '请输入用户名', invalid_type_error: '用户名必须为字符串' })
    .trim()
    .min(1, '用户名不能为空')
    .max(50, '用户名不能超过 50 个字符'),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, '颜色必须为 #RRGGBB 格式')
    .optional(),
  note: z.string().max(200, '备注不能超过 200 个字符').optional(),
  isActive: z.boolean({ invalid_type_error: 'isActive 必须为布尔值' }).optional(),
});

export const userPatchSchema = userInputSchema.partial();

export const userOrderSchema = z.object({
  ids: z
    .array(z.number({ invalid_type_error: '用户 ID 必须为数字' }).int('用户 ID 必须为正整数').positive('用户 ID 必须为正整数'))
    .min(1, '请提供用户顺序'),
});

export type UserInputParsed = z.infer<typeof userInputSchema>;
export type UserPatchParsed = z.infer<typeof userPatchSchema>;

function countUsers(orgId: number): number {
  const row = get<{ n: number }>('SELECT COUNT(*) AS n FROM app_user WHERE org_id = ?', [orgId]);
  return Number(row?.n ?? 0);
}

function nextSortOrder(orgId: number): number {
  const row = get<{ m: number | null }>('SELECT MAX(sort_order) AS m FROM app_user');
  return Number(row?.m ?? 0) + 1;
}

function findUserRowByName(name: string, excludeId: number | undefined, orgId: number): UserRow | undefined {
  if (excludeId) {
    return get<UserRow>('SELECT * FROM app_user WHERE name = ? AND id <> ? AND org_id = ?', [name, excludeId, orgId]);
  }
  return get<UserRow>('SELECT * FROM app_user WHERE name = ? AND org_id = ?', [name, orgId]);
}

function assertNameAvailable(name: string, excludeId: number | undefined, orgId: number): void {
  if (findUserRowByName(name, excludeId, orgId)) {
    throw new AppError(409, 'USER_EXISTS', '用户名已存在：' + name);
  }
}

export function listUsers(includeInactive = false, orgId = defaultOrgId()): AppUser[] {
  const rows = includeInactive
    ? all<UserRow>('SELECT * FROM app_user WHERE org_id = ? ORDER BY sort_order ASC, id ASC', [orgId])
    : all<UserRow>('SELECT * FROM app_user WHERE is_active = 1 AND org_id = ? ORDER BY sort_order ASC, id ASC', [orgId]);
  return rows.map(mapUser);
}

export function createUser(input: UserInputParsed, orgId = defaultOrgId()): AppUser {
  const name = input.name.trim();
  assertNameAvailable(name, undefined, orgId);
  const color = input.color ?? DEFAULT_USER_COLORS[countUsers(orgId) % DEFAULT_USER_COLORS.length];
  const sortOrder = nextSortOrder(orgId);
  try {
    const result = run(
      `INSERT INTO app_user (org_id, name, color, note, is_active, sort_order)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [orgId, name, color, input.note ?? '', input.isActive === false ? 0 : 1, sortOrder],
    );
    return getUserById(result.lastInsertRowid, orgId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/UNIQUE|constraint/i.test(message)) {
      throw new AppError(409, 'USER_EXISTS', '用户名已存在：' + name);
    }
    throw error;
  }
}

export function updateUser(id: number, patch: UserPatchParsed, orgId = defaultOrgId()): AppUser {
  const existing = getUserById(id, orgId);
  const name = patch.name !== undefined ? patch.name.trim() : existing.name;
  if (patch.name !== undefined) assertNameAvailable(name, id, orgId);

  const sets: string[] = [];
  const params: SqlValue[] = [];
  if (patch.name !== undefined) {
    sets.push('name = ?');
    params.push(name);
  }
  if (patch.color !== undefined) {
    sets.push('color = ?');
    params.push(patch.color);
  }
  if (patch.note !== undefined) {
    sets.push('note = ?');
    params.push(patch.note);
  }
  if (patch.isActive !== undefined) {
    sets.push('is_active = ?');
    params.push(patch.isActive ? 1 : 0);
  }
  if (sets.length > 0) {
    sets.push("updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')");
    try {
      run('UPDATE app_user SET ' + sets.join(', ') + ' WHERE id = ?', [...params, id]);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/UNIQUE|constraint/i.test(message)) {
        throw new AppError(409, 'USER_EXISTS', '用户名已存在：' + name);
      }
      throw error;
    }
  }
  return getUserById(id, orgId);
}

/** 默认软删除（is_active=0）；hard=true 时彻底删除并级联安排 */
export function deleteUser(id: number, hard: boolean, orgId = defaultOrgId()): void {
  getUserById(id, orgId);
  if (!hard) {
    run("UPDATE app_user SET is_active = 0, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?", [id]);
    return;
  }
  transaction(() => {
    run('DELETE FROM schedule WHERE user_id = ?', [id]);
    run('DELETE FROM app_user WHERE id = ?', [id]);
  });
}

export function reorderUsers(ids: number[], orgId = defaultOrgId()): AppUser[] {
  const unique = Array.from(new Set(ids));
  if (unique.length !== ids.length) {
    throw new AppError(422, 'VALIDATION_ERROR', '用户顺序中存在重复 ID', [
      { path: 'ids', message: '用户顺序中存在重复 ID' },
    ]);
  }
  for (const id of unique) {
    const row = get<UserRow>('SELECT id FROM app_user WHERE id = ? AND org_id = ?', [id, orgId]);
    if (!row) throw notFound('用户');
  }
  transaction(() => {
    unique.forEach((id, index) => {
      run("UPDATE app_user SET sort_order = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?", [
        index + 1,
        id,
      ]);
    });
  });
  return listUsers(true, orgId);
}
