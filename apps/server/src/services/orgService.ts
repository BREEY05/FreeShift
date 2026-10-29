import { randomBytes } from 'node:crypto';
import type { SqlValue } from '../db/index.ts';
import { all, get, getDb, run, transaction } from '../db/index.ts';
import { seedDefaults } from '../db/seed-defaults.ts';
import { AppError, notFound } from '../lib/errors.ts';
interface OrgRow { id:number; name:string; code:string; owner_email:string; created_at:string }
interface MemberRow { org_id:number; email:string; role:'owner'|'member'; status:'pending'|'approved'; created_at:string }
export interface OrgView { id:number; name:string; code:string; ownerEmail:string; createdAt:string }
export const orgById = (id:number):OrgView => { const r=get<OrgRow>('SELECT * FROM organization WHERE id=?',[id]); if(!r) throw notFound('组织'); return {id:Number(r.id),name:r.name,code:r.code,ownerEmail:r.owner_email,createdAt:r.created_at}; };
export function members(orgId:number, status:'pending'|'approved'='approved') { return all<MemberRow>('SELECT * FROM org_member WHERE org_id=? AND status=? ORDER BY created_at,email',[orgId,status]).map(r=>({orgId:Number(r.org_id),email:r.email,role:r.role,status:r.status,createdAt:r.created_at})); }
export function ownerOnly(orgId:number,email:string):void {if(orgById(orgId).ownerEmail!==email)throw new AppError(403,'FORBIDDEN','仅组织负责人可操作');}

/** 该邮箱可访问的组织列表（负责的组织在前，其次为已审批加入的组织）。 */
export function listOrgs(email:string) {
  const rows = all<OrgRow & {member_role:string}>(
    "SELECT o.*, CASE WHEN o.owner_email = ? THEN 'owner' ELSE COALESCE(m.role,'member') END AS member_role " +
      'FROM organization o LEFT JOIN org_member m ON m.org_id = o.id AND m.email = ? ' +
      'WHERE o.owner_email = ? OR (m.email = ? AND m.status = \'approved\') ' +
      'ORDER BY CASE WHEN o.owner_email = ? THEN 0 ELSE 1 END, o.id',
    [email,email,email,email,email] as SqlValue[],
  );
  return rows.map(row => ({ org: orgById(Number(row.id)), role: row.owner_email === email ? 'owner' as const : 'member' as const }));
}

/** 组织详情；除组织的 owner_email 外，被授予 owner 角色的成员同样可管理。 */
export function orgDetails(orgId:number,email:string) {
  const org=orgById(orgId);
  const staff=canManage(orgId,email);
  return {org,members:members(orgId),requests:staff?members(orgId,'pending'):[]};
}

/** 组织管理者：创建者或组织内被授予 owner 角色的成员。 */
export function canManage(orgId:number,email:string):boolean {
  if(orgById(orgId).ownerEmail===email) return true;
  return Boolean(get("SELECT 1 AS x FROM org_member WHERE org_id=? AND email=? AND role='owner' AND status='approved'",[orgId,email]));
}

/** 仅创建者：授予/收回组织内 owner 角色、重命名、删除组织。 */
export function creatorOnly(orgId:number,email:string):void {if(orgById(orgId).ownerEmail!==email)throw new AppError(403,'FORBIDDEN','仅组织创建者可操作');}

export function createOrg(name:string,email:string) {const id=transaction(()=>{const id=run('INSERT INTO organization(name,code,owner_email) VALUES(?,?,?)',[name,randomBytes(4).toString('hex').toUpperCase(),email]).lastInsertRowid;run("INSERT INTO org_member(org_id,email,role,status) VALUES(?,?,'owner','approved')",[id,email]);seedDefaults(getDb());return id;});return orgDetails(Number(id),email);}

export function joinOrg(code:string,email:string) {
  const r=get<OrgRow>('SELECT * FROM organization WHERE code=?',[code.toUpperCase()]);
  if(!r)throw notFound('组织');
  const existing=get<MemberRow>('SELECT * FROM org_member WHERE org_id=? AND email=?',[r.id,email]);
  if(existing) return {org:orgById(Number(r.id)),status:existing.status==='approved'?'approved' as const:'pending' as const};
  run("INSERT INTO org_member(org_id,email,role,status) VALUES(?,?,'member','pending')",[r.id,email]);
  return {org:orgById(Number(r.id)),status:'pending' as const};
}

export function reviewMember(orgId:number,actor:string,email:string,approve:boolean):void {if(!canManage(orgId,actor))throw new AppError(403,'FORBIDDEN','仅组织负责人可操作');const member=get<MemberRow>('SELECT * FROM org_member WHERE org_id=? AND email=?',[orgId,email]);if(!member||member.status!=='pending')throw notFound('加入申请');if(approve)run("UPDATE org_member SET status='approved' WHERE org_id=? AND email=?",[orgId,email]);else run('DELETE FROM org_member WHERE org_id=? AND email=?',[orgId,email]);}

/** 管理员（组织负责人）移除成员；创建者不能被移除。 */
export function removeMember(orgId:number,actor:string,email:string):void {if(!canManage(orgId,actor))throw new AppError(403,'FORBIDDEN','仅组织负责人可操作');if(orgById(orgId).ownerEmail===email)throw new AppError(409,'OWNER_CANNOT_LEAVE','组织创建者不能被移除');run('DELETE FROM org_member WHERE org_id=? AND email=?',[orgId,email]);}

/** 退出组织：创建者不能退出，组织至少保留一位管理员。 */
export function leaveOrg(orgId:number,email:string):void {
  if(orgById(orgId).ownerEmail===email)throw new AppError(409,'OWNER_CANNOT_LEAVE','组织创建者不能退出组织');
  const admins=all<{email:string}>("SELECT email FROM org_member WHERE org_id=? AND role='owner' AND status='approved'",[orgId]);
  const me=get<MemberRow>('SELECT * FROM org_member WHERE org_id=? AND email=?',[orgId,email]);
  if(me?.role==='owner'&&admins.length<=1)throw new AppError(403,'LAST_ADMIN','组织至少需要保留一位管理员');
  run('DELETE FROM org_member WHERE org_id=? AND email=?',[orgId,email]);
}

/** 设置组织内成员的管理员权限（仅创建者，不能修改自己）。 */
export function setMemberRole(orgId:number,actor:string,email:string,role:'owner'|'member'):void {
  creatorOnly(orgId,actor);
  if(email===actor)throw new AppError(403,'LAST_ADMIN','不能修改自己的组织权限');
  const org=orgById(orgId);
  const member=get<MemberRow>('SELECT * FROM org_member WHERE org_id=? AND email=?',[orgId,email]);
  if(!member||member.status!=='approved')throw notFound('组织成员');
  if(member.role===role)return;
  if(role==='member'){
    const admins=all<{email:string}>("SELECT email FROM org_member WHERE org_id=? AND role='owner' AND status='approved'",[orgId]);
    if(admins.length<=1)throw new AppError(403,'LAST_ADMIN','组织至少需要保留一位管理员');
  } else if(org.ownerEmail===email) return;
  run('UPDATE org_member SET role=? WHERE org_id=? AND email=?',[role,orgId,email]);
}
