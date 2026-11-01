import type { AppUser, MyProfile, UserInput } from '@freeshift/shared';
import { api } from './client';

/** 用户相关查询键：['users'] 为前缀，便于统一失效 */
export const userKeys = {
  all: ['users'] as const,
  list: (includeInactive: boolean) => ['users', includeInactive ? 'all' : 'active'] as const,
  me: ['users', 'me'] as const,
};

export async function fetchUsers(includeInactive = false): Promise<AppUser[]> {
  const data = await api.get<{ users: AppUser[] }>('/users', { include_inactive: includeInactive ? 1 : 0 });
  return data.users;
}

export async function createUser(input: UserInput): Promise<AppUser> {
  const data = await api.post<{ user: AppUser }>('/users', input);
  return data.user;
}

export async function updateUser(id: number, patch: Partial<UserInput>): Promise<AppUser> {
  const data = await api.patch<{ user: AppUser }>('/users/' + id, patch);
  return data.user;
}

/** 软删除（is_active=0），历史安排保留 */
export async function deleteUser(id: number): Promise<void> {
  await api.delete('/users/' + id);
}

/** 彻底删除：级联删除该用户的全部安排 */
export async function deleteUserPermanently(id: number): Promise<void> {
  await api.delete('/users/' + id + '?hard=1');
}

export async function reorderUsers(ids: number[]): Promise<AppUser[]> {
  const data = await api.put<{ users: AppUser[] }>('/users/order', { ids });
  return data.users;
}

/** GET /users/me：本人资料 + 个人表时间段（契约 3.3，会在首次访问时自动建档） */
export function fetchMyProfile(): Promise<MyProfile> {
  return api.get<MyProfile>('/users/me');
}

export interface MyProfilePatch {
  name?: string;
  color?: string;
  note?: string;
}

/** PATCH /users/me：修改自己的姓名 / 颜色 / 备注 */
export async function updateMyProfile(patch: MyProfilePatch): Promise<AppUser> {
  const data = await api.patch<{ user: AppUser }>('/users/me', patch);
  return data.user;
}

/** PUT /users/me/template：把自己的个人表切换为某个同类型模板 */
export async function setMyTemplate(templateId: number): Promise<AppUser> {
  const data = await api.put<{ user: AppUser }>('/users/me/template', { templateId });
  return data.user;
}
