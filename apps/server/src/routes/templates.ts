import { isAdminRequest, requestEmail, requireOrg } from '../services/orgContext.ts';
import { assertTemplateWritable } from '../services/tableService.ts';
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
    const query = request.query as { scope?: string };
    const email = requestEmail(request);
    const list = listTemplates(orgId, email, isAdminRequest(request)).filter(t => query.scope !== 'mine' || t.isMine);
    return { data: { templates: list } };
  });

  app.get('/:id', async (request) => {
    const params = request.params as { id: string };
    const orgId = requireOrg(request);
    const detail = getTemplateDetail(toId(params.id), orgId, requestEmail(request));
    return { data: { template: detail.template, slots: detail.slots } };
  });

  app.post('/', async (request, reply) => {
    const input = parseBody(templateInputSchema, request.body ?? {});
    const detail = createTemplate(input, requireOrg(request), requestEmail(request));
    reply.status(201);
    return { data: { template: detail.template, slots: detail.slots } };
  });

  app.patch('/:id', async (request) => {
    const params = request.params as { id: string };
    const orgId = requireOrg(request);
    assertTemplateWritable(orgId, toId(params.id), requestEmail(request), isAdminRequest(request));
    const patch = parseBody(templatePatchSchema, request.body ?? {});
    const detail = updateTemplate(toId(params.id), patch, orgId, requestEmail(request));
    return { data: { template: detail.template, slots: detail.slots } };
  });

  app.delete('/:id', async (request, reply) => {
    const params = request.params as { id: string };
    const orgId = requireOrg(request);
    assertTemplateWritable(orgId, toId(params.id), requestEmail(request), isAdminRequest(request));
    deleteTemplate(toId(params.id), orgId);
    return reply.status(204).send();
  });

  app.post('/:id/activate', async (request) => {
    const params = request.params as { id: string };
    const orgId = requireOrg(request);
    // Activating a preset is an organization-level admin operation; ordinary users may
    // activate only a writable personal template (ownership is checked below).
    if (!isAdminRequest(request)) {
      assertTemplateWritable(orgId, toId(params.id), requestEmail(request), false);
    }
    const input = parseBody(activateTemplateSchema, request.body ?? {});
    const overview = activateTemplate(toId(params.id), input.force ?? false, orgId);
    return { data: overview };
  });

  app.put('/:id/slots', async (request) => {
    const params = request.params as { id: string };
    const orgId = requireOrg(request);
    assertTemplateWritable(orgId, toId(params.id), requestEmail(request), isAdminRequest(request));
    const input = parseBody(templateSlotsSchema, request.body ?? {});
    return { data: { slots: replaceSlots(toId(params.id), input.slots, orgId) } };
  });

  app.post('/:id/slots', async (request, reply) => {
    const params = request.params as { id: string };
    const orgId = requireOrg(request);
    assertTemplateWritable(orgId, toId(params.id), requestEmail(request), isAdminRequest(request));
    const input = parseBody(slotInputSchema, request.body ?? {});
    const slot = addSlot(toId(params.id), input, orgId);
    reply.status(201);
    return { data: { slot } };
  });
};
