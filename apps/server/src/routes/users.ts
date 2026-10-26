import type { FastifyPluginAsync } from 'fastify';
import { toBool, toId } from '../lib/params.ts';
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
} from '../services/userService.ts';
import { getUserById } from '../services/context.ts';

export const userRoutes: FastifyPluginAsync = async (app) => {
  app.get('/', async (request) => {
    const query = request.query as Record<string, unknown>;
    const includeInactive = toBool(query.include_inactive) ?? false;
    return { data: { users: listUsers(includeInactive) } };
  });

  app.put('/order', async (request) => {
    const input = parseBody(userOrderSchema, request.body ?? {});
    return { data: { users: reorderUsers(input.ids) } };
  });

  app.get('/:id', async (request) => {
    const params = request.params as { id: string };
    return { data: { user: getUserById(toId(params.id)) } };
  });

  app.post('/', async (request, reply) => {
    const input = parseBody(userInputSchema, request.body ?? {});
    reply.status(201);
    return { data: { user: createUser(input) } };
  });

  app.patch('/:id', async (request) => {
    const params = request.params as { id: string };
    const patch = parseBody(userPatchSchema, request.body ?? {});
    return { data: { user: updateUser(toId(params.id), patch) } };
  });

  app.delete('/:id', async (request, reply) => {
    const params = request.params as { id: string };
    const query = request.query as Record<string, unknown>;
    const hard = toBool(query.hard) ?? false;
    deleteUser(toId(params.id), hard);
    return reply.status(204).send();
  });
};
