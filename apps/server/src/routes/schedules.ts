import { isAdminRequest, requestEmail, requireOrg } from '../services/orgContext.ts';
import { ensureUserForEmail } from '../services/tableService.ts';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { AppError } from '../lib/errors.ts';
import { toId, toInt } from '../lib/params.ts';
import { parseBody } from '../lib/validate.ts';
import {
  batchCreateSchedules,
  batchScheduleInputSchema,
  checkConflicts,
  conflictCheckSchema,
  createSchedule,
  deleteSchedule,
  getSchedule,
  listSchedules,
  scheduleInputSchema,
  schedulePatchSchema,
  updateSchedule,
} from '../services/scheduleService.ts';

function ownUserId(request: FastifyRequest, orgId: number): number {
  return Number(ensureUserForEmail(orgId, requestEmail(request)).id);
}

function assertUserAccess(request: FastifyRequest, userId: number, orgId: number): void {
  if (!isAdminRequest(request) && ownUserId(request, orgId) !== userId) {
    throw new AppError(403, 'FORBIDDEN', '只能管理自己的安排');
  }
}

export const scheduleRoutes: FastifyPluginAsync = async (app) => {
  app.get('/', async (request) => {
    const query = request.query as Record<string, unknown>;
    const orgId = requireOrg(request);
    const filters = {
      userId: isAdminRequest(request) ? toInt(query.user_id) : ownUserId(request, orgId),
      fromWeek: toInt(query.from_week),
      toWeek: toInt(query.to_week),
      weekday: toInt(query.weekday),
    };
    return { data: { schedules: listSchedules(filters, orgId) } };
  });

  app.post('/batch', async (request, reply) => {
    const input = parseBody(batchScheduleInputSchema, request.body ?? {});
    const orgId = requireOrg(request);
    assertUserAccess(request, input.userId, orgId);
    reply.status(201);
    return { data: batchCreateSchedules(input, orgId) };
  });

  app.post('/check', async (request) => {
    const input = parseBody(conflictCheckSchema, request.body ?? {});
    const orgId = requireOrg(request);
    assertUserAccess(request, input.userId, orgId);
    return { data: { conflicts: checkConflicts(input, orgId) } };
  });

  app.get('/:id', async (request) => {
    const params = request.params as { id: string };
    const orgId = requireOrg(request);
    const schedule = getSchedule(toId(params.id), orgId);
    assertUserAccess(request, schedule.userId, orgId);
    return { data: { schedule } };
  });

  app.post('/', async (request, reply) => {
    const input = parseBody(scheduleInputSchema, request.body ?? {});
    const orgId = requireOrg(request);
    assertUserAccess(request, input.userId, orgId);
    reply.status(201);
    return { data: { schedule: createSchedule(input, orgId) } };
  });

  app.patch('/:id', async (request) => {
    const params = request.params as { id: string };
    const patch = parseBody(schedulePatchSchema, request.body ?? {});
    const orgId = requireOrg(request);
    const existing = getSchedule(toId(params.id), orgId);
    assertUserAccess(request, existing.userId, orgId);
    if (patch.userId !== undefined) assertUserAccess(request, patch.userId, orgId);
    return { data: { schedule: updateSchedule(toId(params.id), patch, orgId) } };
  });

  app.delete('/:id', async (request, reply) => {
    const params = request.params as { id: string };
    const orgId = requireOrg(request);
    const schedule = getSchedule(toId(params.id), orgId);
    assertUserAccess(request, schedule.userId, orgId);
    deleteSchedule(toId(params.id), orgId);
    return reply.status(204).send();
  });
};
