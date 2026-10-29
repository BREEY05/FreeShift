import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../api/client';
import {
  approveJoinRequest,
  createOrg,
  fetchOrg,
  joinOrg,
  leaveOrg,
  rejectJoinRequest,
  removeOrgMember,
  type OrgSnapshot,
} from '../api/org';

/** 组织查询键：所有组织相关查询都以 ['org'] 为前缀，便于一次失效 */
export const orgKeys = {
  all: ['org'] as const,
  detail: ['org', 'detail'] as const,
};

/** 未加入组织时后端返回 404 NO_ORG，属于正常状态而非错误 */
export function isNoOrg(error: unknown): boolean {
  return error instanceof ApiError && (error.code === 'NO_ORG' || error.status === 404);
}

/** 加入申请待审批：403 PENDING_APPROVAL */
export function isPendingApproval(error: unknown): boolean {
  return error instanceof ApiError && (error.code === 'PENDING_APPROVAL' || error.status === 403);
}

export interface UseOrgResult {
  snapshot: OrgSnapshot | undefined;
  org: OrgSnapshot['org'];
  members: NonNullable<OrgSnapshot['members']>;
  requests: NonNullable<OrgSnapshot['requests']>;
  /** 未加入任何组织（含申请待审批） */
  noOrg: boolean;
  pendingApproval: boolean;
  isQuerying: boolean;
  error: unknown;
  refetch: () => void;
}

/** 当前组织快照（org / members / requests） */
export function useOrg() {
  return useQuery({
    queryKey: orgKeys.detail,
    queryFn: fetchOrg,
    staleTime: 30_000,
    // 404 NO_ORG 是正常业务状态，重试没有意义
    retry: (failureCount, error) => !isNoOrg(error) && failureCount < 1,
  });
}

/** 组织变更操作：创建 / 加入 / 审批 / 移除 / 退出 */
export function useOrgMutations() {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: orgKeys.all });

  const createMutation = useMutation({
    mutationFn: (name: string) => createOrg(name),
    onSuccess: (snapshot) => {
      queryClient.setQueryData(orgKeys.detail, snapshot);
      void refresh();
      void queryClient.invalidateQueries({ queryKey: ['users'] });
      void queryClient.invalidateQueries({ queryKey: ['templates'] });
      void queryClient.invalidateQueries({ queryKey: ['semester'] });
    },
  });

  const joinMutation = useMutation({
    mutationFn: (code: string) => joinOrg(code),
    onSuccess: () => void refresh(),
  });

  const approveMutation = useMutation({
    mutationFn: (email: string) => approveJoinRequest(email),
    onSuccess: () => {
      void refresh();
      void queryClient.invalidateQueries({ queryKey: ['users'] });
    },
  });

  const rejectMutation = useMutation({
    mutationFn: (email: string) => rejectJoinRequest(email),
    onSuccess: () => void refresh(),
  });

  const removeMutation = useMutation({
    mutationFn: (email: string) => removeOrgMember(email),
    onSuccess: () => {
      void refresh();
      void queryClient.invalidateQueries({ queryKey: ['users'] });
    },
  });

  const leaveMutation = useMutation({
    mutationFn: () => leaveOrg(),
    onSuccess: () => {
      queryClient.setQueryData(orgKeys.detail, undefined);
      void refresh();
    },
  });

  return {
    createMutation,
    joinMutation,
    approveMutation,
    rejectMutation,
    removeMutation,
    leaveMutation,
    invalidate: refresh,
  };
}
