import { requireOrg } from '../services/orgContext.ts';
import type { FastifyPluginAsync } from 'fastify';
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

export const scheduleRoutes: FastifyPluginAsync = async (app) => {
  app.get('/', async (request) => {
    const query = request.query as Record<string, unknown>;
    const filters = {
      userId: toInt(query.user_id),
      fromWeek: toInt(query.from_week),
      toWeek: toInt(query.to_week),
      weekday: toInt(query.weekday),
    };
    return { data: { schedules: listSchedules(filters, requireOrg(request)) } };
  });

  app.post('/batch', async (request, reply) => {
    const input = parseBody(batchScheduleInputSchema, request.body ?? {});
    reply.status(201);
    return { data: batchCreateSchedules(input, requireOrg(request)) };
  });

  app.post('/check', async (request) => {
    const input = parseBody(conflictCheckSchema, request.body ?? {});
    return { data: { conflicts: checkConflicts(input, requireOrg(request)) } };
  });

  app.get('/:id', async (request) => {
    const params = request.params as { id: string };
    return { data: { schedule: getSchedule(toId(params.id), requireOrg(request)) } };
  });

  app.post('/', async (request, reply) => {
    const input = parseBody(scheduleInputSchema, request.body ?? {});
    reply.status(201);
    return { data: { schedule: createSchedule(input, requireOrg(request)) } };
  });

  app.patch('/:id', async (request) => {
    const params = request.params as { id: string };
    const patch = parseBody(schedulePatchSchema, request.body ?? {});
    return { data: { schedule: updateSchedule(toId(params.id), patch, requireOrg(request)) } };
  });

  app.delete('/:id', async (request, reply) => {
    const params = request.params as { id: string };
    deleteSchedule(toId(params.id), requireOrg(request));
    return reply.status(204).send();
  });
};
