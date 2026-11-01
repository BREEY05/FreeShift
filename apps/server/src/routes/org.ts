import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { AppError } from '../lib/errors.ts';
import { parseBody } from '../lib/validate.ts';
import { selectedOrgId, isAdminRequest, requestEmail, requireOrg } from '../services/orgContext.ts';
import {
  addMember,
  canManage,
  createOrg,
  joinOrg,
  leaveOrg,
  listOrgs,
  members,
  orgDetails,
  orgPresets,
  removeMember,
  reviewMember,
  searchOrgs,
  setMemberRole,
} from '../services/orgService.ts';

const createSchema = z.object({
  name: z.string().trim().min(1).max(80),
  presetName: z.string().trim().min(1).max(120),
});
const joinSchema = z
  .object({
    orgId: z.number().int().positive().optional(),
    code: z.string().trim().min(1).max(32).optional(),
  })
  .refine((value) => value.orgId !== undefined || value.code !== undefined, { message: '请提供组织或邀请码' });
const roleSchema = z.object({ role: z.enum(['owner', 'member']) });
const addMemberSchema = z.object({
  email: z.string().trim().email('请输入正确的邮箱').max(160),
  name: z.string().trim().max(40).optional(),
});
const listQuerySchema = z.object({ q: z.string().max(120).optional() });

function cookieFor(orgId: number): string {
  return 'freeshift_org=' + orgId + '; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000';
}

export const orgRoutes: FastifyPluginAsync = async (app) => {
  /** 我的组织列表 + 当前生效组织 + 是否有创建权限（管理员可创建多个组织）。无组织时 200。 */
  app.get('/mine', async (request) => {
    const email = requestEmail(request);
    const orgs = listOrgs(email);
    const ids = orgs.map((item) => item.org.id);
    const selected = selectedOrgId(request);
    const activeOrgId = selected !== null && ids.includes(selected) ? selected : ids[0] ?? null;
    return { data: { orgs, activeOrgId, canCreate: isAdminRequest(request) } };
  });

  /** 组织广场：任意登录用户可搜索全部组织（不需要先加入）。 */
  app.get('/list', async (request) => {
    const input = listQuerySchema.parse(request.query ?? {});
    return { data: { orgs: searchOrgs(requestEmail(request), input.q) } };
  });

  /** 内置时间类型清单（创建组织时必选其一）。 */
  app.get('/presets', async () => ({ data: { presets: orgPresets() } }));

  /** 创建组织：名字 + 时间类型（预设名），仅平台管理员。 */
  app.post('/', async (request, reply) => {
    const email = requestEmail(request);
    if (!isAdminRequest(request)) throw new AppError(403, 'FORBIDDEN', '只有管理员可以创建组织');
    const input = parseBody(createSchema, request.body);
    const data = createOrg(input.name, email, input.presetName);
    reply.header('Set-Cookie', cookieFor(data.org.id));
    reply.status(201);
    return { data };
  });

  /** 切换当前组织：写入 Cookie，之后所有接口都作用于该组织。 */
  app.post('/switch', async (request, reply) => {
    const email = requestEmail(request);
    const input = parseBody(z.object({ orgId: z.number().int().positive() }), request.body);
    const allowed = listOrgs(email).some((item) => item.org.id === input.orgId);
    if (!allowed) throw new AppError(403, 'FORBIDDEN', '你不在该组织中');
    reply.header('Set-Cookie', cookieFor(input.orgId));
    return { data: orgDetails(input.orgId, email) };
  });

  /** 申请加入组织（按组织 id 或旧邀请码），创建人审批。 */
  app.post('/join', async (request) => {
    const input = parseBody(joinSchema, request.body);
    return { data: joinOrg({ orgId: input.orgId ?? null, code: input.code ?? null }, requestEmail(request)) };
  });

  app.get('/', async (request) => ({ data: orgDetails(requireOrg(request), requestEmail(request)) }));

  app.get('/requests', async (request) => {
    const id = requireOrg(request);
    if (!canManage(id, requestEmail(request))) throw new AppError(403, 'FORBIDDEN', '仅组织负责人可操作');
    return { data: { requests: members(id, 'pending') } };
  });
  app.post('/requests/:email/approve', async (request) => {
    const id = requireOrg(request);
    reviewMember(id, requestEmail(request), (request.params as { email: string }).email.toLowerCase(), true);
    return { data: { requests: members(id, 'pending'), members: members(id) } };
  });
  app.post('/requests/:email/reject', async (request) => {
    const id = requireOrg(request);
    reviewMember(id, requestEmail(request), (request.params as { email: string }).email.toLowerCase(), false);
    return { data: { requests: members(id, 'pending') } };
  });

  app.get('/members', async (request) => ({ data: { members: members(requireOrg(request)) } }));
  /** 组织负责人直接添加成员（免申请）：立即建档，个人表默认沿用组织模板。 */
  app.post('/members', async (request, reply) => {
    const id = requireOrg(request);
    const email = requestEmail(request);
    const input = parseBody(addMemberSchema, request.body);
    addMember(id, email, input.email, input.name ?? null);
    reply.status(201);
    return { data: orgDetails(id, email) };
  });
  app.delete('/members/:email', async (request, reply) => {
    removeMember(requireOrg(request), requestEmail(request), (request.params as { email: string }).email.toLowerCase());
    return reply.status(204).send();
  });
  /** 授予/收回成员的组织管理员权限（仅组织创建者）。 */
  app.patch('/members/:email', async (request) => {
    const id = requireOrg(request);
    const input = parseBody(roleSchema, request.body);
    setMemberRole(id, requestEmail(request), (request.params as { email: string }).email.toLowerCase(), input.role);
    return { data: { members: members(id) } };
  });

  app.post('/leave', async (request) => {
    leaveOrg(requireOrg(request), requestEmail(request));
    return { data: { left: true } };
  });
  app.get('/selected', async (request) => ({ data: { orgId: selectedOrgId(request) } }));
};
