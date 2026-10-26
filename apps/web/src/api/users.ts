import type { AppUser, UserInput } from '@freeshift/shared';
import { api } from './client';

/** 用户相关查询键：['users'] 为前缀，便于统一失效 */
export const userKeys = {
  all: ['users'] as const,
  list: (includeInactive: boolean) => ['users', includeInactive ? 'all' : 'active'] as const,
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
