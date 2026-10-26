import type { AppUser } from '@freeshift/shared';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';

export const usersQueryKey = ['users', 'active'] as const;

async function fetchUsers(): Promise<AppUser[]> {
  const data = await api.get<{ users: AppUser[] }>('/users', { include_inactive: 0 });
  return data.users;
}

/** 启用中的成员列表（契约：GET /users?include_inactive=0） */
export function useUsers() {
  return useQuery({
    queryKey: usersQueryKey,
    queryFn: fetchUsers,
    staleTime: 60_000,
  });
}
