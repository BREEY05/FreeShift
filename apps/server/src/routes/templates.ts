import { requireOrg } from '../services/orgContext.ts';
import type { FastifyPluginAsync } from 'fastify';
import { toId } from '../lib/params.ts';
import { parseBody } from '../lib/validate.ts';
import {
  activateTemplate,
  activateTemplateSchema,
  addSlot,
  createTemplate,
  deleteTemplate,
  getTemplateDetail,
  listTemplates,
  replaceSlots,
  slotInputSchema,
  templateInputSchema,
  templatePatchSchema,
  templateSlotsSchema,
  updateTemplate,
} from '../services/templateService.ts';

export const templateRoutes: FastifyPluginAsync = async (app) => {
  app.get('/', async (request) => {
    const orgId = requireOrg(request);
    const list = listTemplates(orgId);
    return { data: { templates: list } };
  });

  app.get('/:id', async (request) => {
    const params = request.params as { id: string };
    const detail = getTemplateDetail(toId(params.id), requireOrg(request));
    return { data: { template: detail.template, slots: detail.slots } };
  });

  app.post('/', async (request, reply) => {
    const input = parseBody(templateInputSchema, request.body ?? {});
    const detail = createTemplate(input, requireOrg(request));
    reply.status(201);
    return { data: { template: detail.template, slots: detail.slots } };
  });

  app.patch('/:id', async (request) => {
    const params = request.params as { id: string };
    const patch = parseBody(templatePatchSchema, request.body ?? {});
    const detail = updateTemplate(toId(params.id), patch, requireOrg(request));
    return { data: { template: detail.template, slots: detail.slots } };
  });

  app.delete('/:id', async (request, reply) => {
    const params = request.params as { id: string };
    deleteTemplate(toId(params.id), requireOrg(request));
    return reply.status(204).send();
  });

  app.post('/:id/activate', async (request) => {
    const params = request.params as { id: string };
    const input = parseBody(activateTemplateSchema, request.body ?? {});
    const overview = activateTemplate(toId(params.id), input.force ?? false, requireOrg(request));
    return { data: overview };
  });

  app.put('/:id/slots', async (request) => {
    const params = request.params as { id: string };
    const input = parseBody(templateSlotsSchema, request.body ?? {});
    return { data: { slots: replaceSlots(toId(params.id), input.slots, requireOrg(request)) } };
  });

  app.post('/:id/slots', async (request, reply) => {
    const params = request.params as { id: string };
    const input = parseBody(slotInputSchema, request.body ?? {});
    const slot = addSlot(toId(params.id), input, requireOrg(request));
    reply.status(201);
    return { data: { slot } };
  });
};
