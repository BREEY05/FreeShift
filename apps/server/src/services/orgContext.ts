import type { FastifyRequest } from 'fastify';
import { all, get } from '../db/index.ts';
import { AppError } from '../lib/errors.ts';
import { sessionAccount, sessionRole } from './authService.ts';
import { defaultOrgId } from './context.ts';

function cookieValue(request: FastifyRequest, name: string): string | undefined {
  const prefixed = name + '=';
  return (request as FastifyRequest & {cookies?: Record<string,string>}).cookies?.[name]
    ?? request.headers.cookie?.split(';').map(x => x.trim()).find(x => x.startsWith(prefixed))?.slice(prefixed.length);
}

function offlineOwner(): string {
  return get<{owner_email:string}>('SELECT owner_email FROM organization WHERE id=?', [defaultOrgId()])!.owner_email;
}

/** 当前请求的登录邮箱（离线模式下退化为默认组织的负责人）。 */
export function requestEmail(request: FastifyRequest): string {
  if (process.env.AUTH_ENABLED === 'false') return offlineOwner();
  const account = sessionAccount(cookieValue(request, 'freeshift_session') ?? '', Date.now());
  if (!account) throw new AppError(401, 'UNAUTHENTICATED', '请先登录');
  return account.email;
}

/** 当前请求是否为平台管理员（离线模式恒为 false）。 */
export function isAdminRequest(request: FastifyRequest): boolean {
  if (process.env.AUTH_ENABLED === 'false') return false;
  return sessionRole(cookieValue(request, 'freeshift_session') ?? '', Date.now()) === 'admin';
}

/** 会话中显式选中的组织（Cookie freeshift_org），非法值按未选中处理。 */
export function selectedOrgId(request: FastifyRequest): number | null {
  const id = Number(cookieValue(request, 'freeshift_org'));
  return Number.isInteger(id) && id > 0 ? id : null;
}

/**
 * 该邮箱可访问的组织 id 列表：负责的组织在前，其次为已审批加入的组织。
 * 管理员身份不放宽组织归属，只决定能否创建/删除组织。
 */
export function accessibleOrgIds(email: string): number[] {
  const owned = all<{id:number}>('SELECT id FROM organization WHERE owner_email = ? ORDER BY id', [email]);
  const joined = all<{id:number}>("SELECT org_id AS id FROM org_member WHERE email = ? AND status = 'approved' ORDER BY org_id", [email]);
  return [...new Set([...owned, ...joined].map(row => Number(row.id)))];
}

/**
 * 当前生效组织：会话选中的组织（可访问时）优先，否则退回第一个可访问组织。
 * 没有任何可访问组织时，按 pending / 无组织分别报错。
 */
export function requireOrg(request: FastifyRequest): number {
  if (process.env.AUTH_ENABLED === 'false') return defaultOrgId();
  const email = requestEmail(request);
  const ids = accessibleOrgIds(email);
  if (ids.length > 0) {
    const selected = selectedOrgId(request);
    return selected !== null && ids.includes(selected) ? selected : ids[0]!;
  }
  if (get("SELECT org_id FROM org_member WHERE email=? AND status='pending'", [email])) throw new AppError(403,'PENDING_APPROVAL','加入申请待审批');
  throw new AppError(404,'NO_ORG','你还没有加入任何组织');
}
