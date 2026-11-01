import { isAdminRequest, requestEmail, requireOrg } from '../services/orgContext.ts';
import { assertTemplateWritable } from '../services/tableService.ts';
import type { FastifyPluginAsync } from 'fastify';
import { toId } from '../lib/params.ts';
import { parseBody } from '../lib/validate.ts';
import { deleteSlot, slotPatchSchema, templateIdForSlot, updateSlot } from '../services/templateService.ts';

export const slotRoutes: FastifyPluginAsync = async (app) => {
  app.patch('/:id', async (request) => {
    const params = request.params as { id: string };
    const orgId = requireOrg(request);
    const slotId = toId(params.id);
    assertTemplateWritable(orgId, templateIdForSlot(slotId, orgId), requestEmail(request), isAdminRequest(request));
    const patch = parseBody(slotPatchSchema, request.body ?? {});
    return { data: { slot: updateSlot(slotId, patch, orgId) } };
  });

  app.delete('/:id', async (request, reply) => {
    const params = request.params as { id: string };
    const orgId = requireOrg(request);
    const slotId = toId(params.id);
    assertTemplateWritable(orgId, templateIdForSlot(slotId, orgId), requestEmail(request), isAdminRequest(request));
    deleteSlot(slotId, orgId);
    return reply.status(204).send();
  });
};
