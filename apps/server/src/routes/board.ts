import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import type { DayPart, Weekday } from '@freeshift/shared';
import { AppError, badRequest } from '../lib/errors.ts';
import { toId, toInt } from '../lib/params.ts';
import { isAdminRequest, requestEmail, requireOrg } from '../services/orgContext.ts';
import { ensureUserForEmail } from '../services/tableService.ts';
import {
  getAggregateBoard,
  getCellDetail,
  getPersonalBoard,
  listUserSchedules,
  type BoardFilter,
} from '../services/aggregateService.ts';

const DAY_PARTS: DayPart[] = ['morning', 'afternoon', 'evening'];
const FILTERS: BoardFilter[] = ['all', 'full_free', 'partial'];

function toValues(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap((item) => toValues(item));
  if (value === undefined || value === null) return [];
  return String(value)
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function parseIdList(value: unknown, name: string): number[] | undefined {
  const raw = toValues(value);
  if (raw.length === 0) return undefined;
  const ids: number[] = [];
  for (const item of raw) {
    const parsed = Number(item);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      throw badRequest(name + ' 必须为逗号分隔的正整数');
    }
    if (!ids.includes(parsed)) ids.push(parsed);
  }
  return ids;
}

function parseDayParts(value: unknown): DayPart[] | undefined {
  const raw = toValues(value);
  if (raw.length === 0) return undefined;
  const dayParts: DayPart[] = [];
  for (const item of raw) {
    if (!DAY_PARTS.includes(item as DayPart)) {
      throw badRequest('day_parts 仅支持 morning,afternoon,evening');
    }
    if (!dayParts.includes(item as DayPart)) dayParts.push(item as DayPart);
  }
  return dayParts;
}

function parseFilter(value: unknown): BoardFilter | undefined {
  const raw = toValues(value);
  if (raw.length === 0) return undefined;
  const filter = raw[0] as BoardFilter;
  if (!FILTERS.includes(filter)) throw badRequest('filter 仅支持 all,full_free,partial');
  return filter;
}

function parseWeek(value: unknown): number | undefined {
  return toInt(value, undefined);
}

function requireAdmin(request: FastifyRequest): void {
  if (!isAdminRequest(request)) throw new AppError(403, 'FORBIDDEN', '需要管理员权限');
}

function requireSelfOrAdmin(request: FastifyRequest, userId: number, orgId: number): void {
  if (isAdminRequest(request)) return;
  const own = ensureUserForEmail(orgId, requestEmail(request));
  if (Number(own.id) !== userId) throw new AppError(403, 'FORBIDDEN', '只能查看自己的个人表');
}

export const boardRoutes: FastifyPluginAsync = async (app) => {
  app.get('/aggregate', async (request) => {
    requireAdmin(request);
    const query = request.query as Record<string, unknown>;
    const orgId = requireOrg(request);
    return {
      data: getAggregateBoard(
        {
          week: parseWeek(query.week),
          userIds: parseIdList(query.user_ids, 'user_ids'),
          dayParts: parseDayParts(query.day_parts),
          filter: parseFilter(query.filter),
        },
        orgId,
      ),
    };
  });

  app.get('/cell', async (request) => {
    requireAdmin(request);
    const query = request.query as Record<string, unknown>;
    const weekday = toInt(query.weekday, undefined);
    if (weekday === undefined) throw badRequest('缺少参数：weekday');
    if (weekday < 1 || weekday > 7) throw badRequest('weekday 必须为 1-7 的整数');
    const slotId = toId(query.slot_id, 'slot_id');
    const orgId = requireOrg(request);
    return {
      data: getCellDetail(
        {
          week: parseWeek(query.week),
          weekday: weekday as Weekday,
          slotId,
        },
        orgId,
      ),
    };
  });

  app.get('/user/:id', async (request) => {
    const params = request.params as { id: string };
    const query = request.query as Record<string, unknown>;
    const orgId = requireOrg(request);
    const userId = toId(params.id, 'id');
    requireSelfOrAdmin(request, userId, orgId);
    return { data: getPersonalBoard(userId, parseWeek(query.week), orgId) };
  });

  app.get('/user/:id/schedules', async (request) => {
    const params = request.params as { id: string };
    const query = request.query as Record<string, unknown>;
    const orgId = requireOrg(request);
    const userId = toId(params.id, 'id');
    requireSelfOrAdmin(request, userId, orgId);
    return {
      data: {
        schedules: listUserSchedules(userId, parseWeek(query.from_week), parseWeek(query.to_week), orgId),
      },
    };
  });
};
