import { api } from './client';

/** 组织内成员角色：负责人可审批申请、移除成员 */
export type OrgRole = 'owner' | 'member';

/** 成员状态：pending 为待审批的加入申请 */
export type OrgMemberStatus = 'pending' | 'approved';

export interface OrgInfo {
  id: number;
  name: string;
  /** 组织 ID（邀请码），用于他人按 ID 申请加入 */
  code: string;
  ownerEmail: string;
  /** ISO 时间字符串（服务端 UTC） */
  createdAt: string;
}

export interface OrgMember {
  orgId: number;
  email: string;
  role: OrgRole;
  status: OrgMemberStatus;
  createdAt: string;
}

/** GET /org 的完整快照；requests 仅负责人可见（其他成员为空数组） */
export interface OrgSnapshot {
  org: OrgInfo | null;
  members: OrgMember[];
  requests: OrgMember[];
}

export interface JoinOrgResult {
  org: OrgInfo;
  /** pending：已提交申请等待负责人审批；approved：已在组织中 */
  status: OrgMemberStatus;
}

export interface OrgJoinStatusError {
  code: 'PENDING_APPROVAL' | 'NO_ORG' | 'FORBIDDEN' | 'OWNER_CANNOT_LEAVE' | string;
  message: string;
}

/** 读取当前组织；未加入组织时 org 为 null（接口用 404 NO_ORG 表示未加入） */
export async function fetchOrg(): Promise<OrgSnapshot> {
  return api.get<OrgSnapshot>('/org');
}

export async function createOrg(name: string): Promise<OrgSnapshot> {
  return api.post<OrgSnapshot>('/org', { name });
}

export async function joinOrg(code: string): Promise<JoinOrgResult> {
  return api.post<JoinOrgResult>('/org/join', { code });
}

export async function fetchJoinRequests(): Promise<OrgMember[]> {
  const data = await api.get<{ requests: OrgMember[] }>('/org/requests');
  return data.requests;
}

export async function approveJoinRequest(email: string): Promise<{ requests: OrgMember[]; members: OrgMember[] }> {
  return api.post<{ requests: OrgMember[]; members: OrgMember[] }>(
    '/org/requests/' + encodeURIComponent(email) + '/approve',
    // 后端 onRequest 要求认证写请求带 JSON 请求体
    {},
  );
}

export async function rejectJoinRequest(email: string): Promise<OrgMember[]> {
  const data = await api.post<{ requests: OrgMember[] }>('/org/requests/' + encodeURIComponent(email) + '/reject', {});
  return data.requests;
}

export async function fetchOrgMembers(): Promise<OrgMember[]> {
  const data = await api.get<{ members: OrgMember[] }>('/org/members');
  return data.members;
}

export async function removeOrgMember(email: string): Promise<void> {
  await api.delete('/org/members/' + encodeURIComponent(email));
}

export async function leaveOrg(): Promise<void> {
  await api.post<{ left: true }>('/org/leave', {});
}

export interface ResetDataResult {
  deletedSchedules: number;
  deletedUsers: number;
}

/** 危险操作：清空当前组织的全部安排与成员（保留组织本身） */
export async function resetData(): Promise<ResetDataResult> {
  return api.delete<ResetDataResult>('/data/reset');
}
