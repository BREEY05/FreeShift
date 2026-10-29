import { requireOrg } from '../services/orgContext.ts';
import type { FastifyPluginAsync } from 'fastify';
import { toId } from '../lib/params.ts';
import { parseBody } from '../lib/validate.ts';
import { deleteSlot, slotPatchSchema, updateSlot } from '../services/templateService.ts';

export const slotRoutes: FastifyPluginAsync = async (app) => {
  app.patch('/:id', async (request) => {
    const params = request.params as { id: string };
    const patch = parseBody(slotPatchSchema, request.body ?? {});
    return { data: { slot: updateSlot(toId(params.id), patch, requireOrg(request)) } };
  });

  app.delete('/:id', async (request, reply) => {
    const params = request.params as { id: string };
    deleteSlot(toId(params.id), requireOrg(request));
    return reply.status(204).send();
  });
};
