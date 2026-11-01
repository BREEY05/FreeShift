import type { OrgInfo, OrgMember, OrgMineItem, OrgPreset, OrgSearchItem, OrgSnapshot, OrgJoinResult } from '@freeshift/shared';
import type { OrgCreateInput } from '@freeshift/shared';
export type { OrgCreateInput } from '@freeshift/shared';
import { api } from './client';

export type OrgRole = 'owner' | 'member';
export type OrgMemberStatus = 'pending' | 'approved';
export type { OrgInfo, OrgMember, OrgSnapshot, OrgJoinResult, OrgPreset, OrgSearchItem, OrgMineItem };

export async function fetchOrg(): Promise<OrgSnapshot> { return api.get<OrgSnapshot>('/org'); }
export async function fetchMyOrgs(): Promise<{orgs: OrgMineItem[]; activeOrgId: number | null; canCreate: boolean}> { return api.get('/org/mine'); }
export async function searchOrgs(q = ''): Promise<OrgSearchItem[]> { const d=await api.get<{orgs:OrgSearchItem[]}>('/org/list', {q}); return d.orgs; }
export async function fetchOrgPresets(): Promise<OrgPreset[]> { const d=await api.get<{presets:OrgPreset[]}>('/org/presets'); return d.presets; }
export async function switchOrg(orgId:number): Promise<OrgSnapshot> { return api.post('/org/switch',{orgId}); }
export async function createOrg(input: OrgCreateInput): Promise<OrgSnapshot> { return api.post('/org',input); }
export async function joinOrg(input: {orgId?:number;code?:string}): Promise<OrgJoinResult> { return api.post('/org/join',input); }
export async function fetchJoinRequests(): Promise<OrgMember[]> { const data=await api.get<{requests:OrgMember[]}>('/org/requests'); return data.requests; }
export async function approveJoinRequest(email:string):Promise<{requests:OrgMember[];members:OrgMember[]}>{return api.post('/org/requests/'+encodeURIComponent(email)+'/approve',{});}
export async function rejectJoinRequest(email:string):Promise<OrgMember[]>{return (await api.post<{requests:OrgMember[]}>('/org/requests/'+encodeURIComponent(email)+'/reject',{})).requests;}
export async function fetchOrgMembers():Promise<OrgMember[]>{return (await api.get<{members:OrgMember[]}>('/org/members')).members;}
export async function addOrgMember(input:{email:string;name?:string}):Promise<OrgSnapshot>{return api.post('/org/members',input);}
export async function removeOrgMember(email:string):Promise<void>{await api.delete('/org/members/'+encodeURIComponent(email));}
export async function leaveOrg():Promise<void>{await api.post('/org/leave',{});}
export interface ResetDataResult {deletedSchedules:number;deletedUsers:number;}
export async function resetData():Promise<ResetDataResult>{return api.delete('/data/reset');}
