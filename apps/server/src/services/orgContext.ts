import type { FastifyRequest } from 'fastify';
import { get } from '../db/index.ts';
import { AppError } from '../lib/errors.ts';
import { sessionAccount } from './authService.ts';
import { defaultOrgId } from './context.ts';

export function requestEmail(request: FastifyRequest): string {
  if (process.env.AUTH_ENABLED === 'false') return get<{owner_email:string}>('SELECT owner_email FROM organization WHERE id=?', [defaultOrgId()])!.owner_email;
  const cookies = (request as FastifyRequest & {cookies?: Record<string,string>}).cookies;
  const raw = request.headers.cookie?.split(';').map(x=>x.trim()).find(x=>x.startsWith('freeshift_session='))?.slice('freeshift_session='.length);
  const account = sessionAccount(cookies?.freeshift_session ?? raw ?? '', Date.now());
  if (!account) throw new AppError(401, 'UNAUTHENTICATED', '请先登录');
  return account.email;
}
export function requireOrg(request: FastifyRequest): number {
  if (process.env.AUTH_ENABLED === 'false') return defaultOrgId();
  const email = requestEmail(request);
  const org = get<{id:number}>("SELECT o.id FROM organization o LEFT JOIN org_member m ON m.org_id=o.id AND m.email=? WHERE o.owner_email=? OR (m.email=? AND m.status='approved') ORDER BY CASE WHEN o.owner_email=? THEN 0 ELSE 1 END,o.id DESC LIMIT 1", [email,email,email,email]);
  if (org) return Number(org.id);
  if (get("SELECT org_id FROM org_member WHERE email=? AND status='pending'", [email])) throw new AppError(403,'PENDING_APPROVAL','加入申请待审批');
  throw new AppError(404,'NO_ORG','你还没有加入任何组织');
}
