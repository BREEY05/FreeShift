import { isAdminRequest, requestEmail, requireOrg } from '../services/orgContext.ts';
import { personalSlots, ensureUserForEmail, personalTemplateId, getUserRow } from '../services/tableService.ts';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { toBool, toId } from '../lib/params.ts';
import { AppError } from '../lib/errors.ts';
import { parseBody } from '../lib/validate.ts';
import {
  createUser,
  deleteUser,
  listUsers,
  reorderUsers,
  updateUser,
  userInputSchema,
  userOrderSchema,
  userPatchSchema,
  patchOwnUser,
  setOwnTemplate,
} from '../services/userService.ts';
import { getUserById } from '../services/context.ts';

function requireAdminUsers(request: FastifyRequest): void {
  if (!isAdminRequest(request)) throw new AppError(403, 'FORBIDDEN', '只有管理员可以管理用户');
}

export const userRoutes: FastifyPluginAsync = async (app) => {
  app.get('/me', async (request) => {
    const orgId = requireOrg(request);
    const row = ensureUserForEmail(orgId, requestEmail(request));
    const user = getUserById(Number(row.id), orgId);
    return {data:{user, slots: personalSlots(orgId, Number(row.id))}};
  });
  app.patch('/me', async (request) => {
    const patch = parseBody(userPatchSchema.pick({name:true,color:true,note:true}).partial(), request.body ?? {});
    return {data:{user:patchOwnUser(requireOrg(request), requestEmail(request), patch)}};
  });
  app.put('/me/template', async (request) => {
    const parsed = parseBody((await import('zod')).z.object({templateId:(await import('zod')).z.number().int().positive()}), request.body ?? {});
    return {data:{user:setOwnTemplate(requireOrg(request), requestEmail(request), parsed.templateId)}};
  });
  app.get('/', async (request) => {
    const query = request.query as Record<string, unknown>;
    const includeInactive = toBool(query.include_inactive) ?? false;
    const orgId = requireOrg(request);
    if (!isAdminRequest(request)) return {data:{users:[getUserById(Number(ensureUserForEmail(orgId, requestEmail(request)).id), orgId)]}};
    return { data: { users: listUsers(includeInactive, orgId) } };
  });

  app.put('/order', async (request) => {
    requireAdminUsers(request);
    const input = parseBody(userOrderSchema, request.body ?? {});
    return { data: { users: reorderUsers(input.ids, requireOrg(request)) } };
  });

  app.get('/:id', async (request) => {
    const params = request.params as { id: string };
    const orgId = requireOrg(request);
    const userId = toId(params.id);
    if (!isAdminRequest(request) && Number(ensureUserForEmail(orgId, requestEmail(request)).id) !== userId) {
      throw new AppError(403, 'FORBIDDEN', '只能查看自己的资料');
    }
    return { data: { user: getUserById(userId, orgId) } };
  });

  app.post('/', async (request, reply) => {
    requireAdminUsers(request);
    const input = parseBody(userInputSchema, request.body ?? {});
    reply.status(201);
    const orgId = requireOrg(request);
    const created = createUser(input, orgId);
    return { data: { user: created } };
  });

  app.patch('/:id', async (request) => {
    requireAdminUsers(request);
    const params = request.params as { id: string };
    const patch = parseBody(userPatchSchema, request.body ?? {});
    return { data: { user: updateUser(toId(params.id), patch, requireOrg(request)) } };
  });

  app.delete('/:id', async (request, reply) => {
    requireAdminUsers(request);
    const params = request.params as { id: string };
    const query = request.query as Record<string, unknown>;
    const hard = toBool(query.hard) ?? false;
    deleteUser(toId(params.id), hard, requireOrg(request));
    return reply.status(204).send();
  });
};
