import type { AppUser } from '@freeshift/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchPersonalBoard } from '../api/board';
import { api } from '../api/client';
import {
  fetchMyProfile,
  setMyTemplate,
  updateMyProfile,
  userKeys,
  type MyProfilePatch,
} from '../api/users';

export const usersQueryKey = userKeys.list(false);
export const myProfileQueryKey = userKeys.me;

async function fetchUsers(): Promise<AppUser[]> {
  const data = await api.get<{ users: AppUser[] }>('/users', { include_inactive: 0 });
  return data.users;
}

/** 启用中的成员列表（契约：GET /users?include_inactive=0；普通成员只会返回自己一条） */
export function useUsers() {
  return useQuery({
    queryKey: usersQueryKey,
    queryFn: fetchUsers,
    staleTime: 60_000,
  });
}

/** 本人资料 + 个人表 slots（GET /users/me） */
export function useMyProfile() {
  return useQuery({
    queryKey: myProfileQueryKey,
    queryFn: fetchMyProfile,
    staleTime: 30_000,
    retry: false,
  });
}

function invalidateUserScoped(queryClient: ReturnType<typeof useQueryClient>) {
  void queryClient.invalidateQueries({ queryKey: userKeys.all });
  void queryClient.invalidateQueries({ queryKey: ['board'] });
  void queryClient.invalidateQueries({ queryKey: ['schedules'] });
}

/** 修改本人资料（PATCH /users/me） */
export function useUpdateMyProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (patch: MyProfilePatch) => updateMyProfile(patch),
    onSuccess: () => invalidateUserScoped(queryClient),
  });
}

/** 切换个人表（PUT /users/me/template） */
export function useSetMyTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (templateId: number) => setMyTemplate(templateId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: userKeys.all }),
  });
}

/** 指定成员的周个人表（管理员在 /users 查看成员；week 为 null 时由服务端取当前周） */
export function useMemberBoard(userId: number | null, week: number | null) {
  return useQuery({
    queryKey: ['board', 'personal', userId ?? 'none', week ?? 'current'],
    queryFn: () => fetchPersonalBoard(userId as number, week ?? undefined),
    enabled: userId !== null,
    staleTime: 15_000,
    retry: false,
  });
}
