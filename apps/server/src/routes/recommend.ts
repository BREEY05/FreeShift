import type { FastifyPluginAsync } from 'fastify';
import type { AlternativesInput, ScoredInput } from '@freeshift/shared';
import { z } from 'zod';
import { parseBody } from '../lib/validate.ts';
import {
  getAlternatives,
  getCommonFreeBlocks,
  getRecommendConfig,
  getScoredCells,
  updateRecommendConfig,
} from '../services/recommendService.ts';

const dayPartSchema = z.enum(['morning', 'afternoon', 'evening']);
const weekdaySchema = z.number().int().min(1).max(7);
const paritySchema = z.enum(['all', 'odd', 'even']);
const idSchema = z.number().int().positive();

const weightsSchema = z.object({
  freeRatio: z.number().finite().min(0).optional(),
  continuity: z.number().finite().min(0).optional(),
  history: z.number().finite().min(0).optional(),
  friendliness: z.number().finite().min(0).optional(),
  recentLoad: z.number().finite().min(0).optional(),
});

const commonFreeSchema = z.object({
  week: z.number().int().positive().optional(),
  userIds: z.array(idSchema).optional(),
  topK: z.number().int().positive().optional(),
  requireTimeAdjacent: z.boolean().optional(),
});

const scoredSchema = z.object({
  week: z.number().int().positive().optional(),
  userIds: z.array(idSchema).optional(),
  filters: z
    .object({
      dayParts: z.array(dayPartSchema).optional(),
      weekdays: z.array(weekdaySchema).optional(),
      allFreeOnly: z.boolean().optional(),
      minFreeRatio: z.number().finite().min(0).max(1).optional(),
    })
    .optional(),
  weights: weightsSchema.optional(),
  topK: z.number().int().positive().optional(),
  perspectiveUserId: idSchema.optional(),
});

const alternativesSchema = z.object({
  userId: idSchema,
  weekday: weekdaySchema,
  slotId: idSchema,
  startWeek: z.number().int().min(1),
  endWeek: z.number().int().min(1),
  parity: paritySchema,
  topK: z.number().int().positive().optional(),
});

const configSchema = z.object({
  weights: weightsSchema.optional(),
  dayPart: z
    .object({
      morning: z.number().finite().min(0).max(1).optional(),
      afternoon: z.number().finite().min(0).max(1).optional(),
      evening: z.number().finite().min(0).max(1).optional(),
    })
    .optional(),
  historyWeeks: z.number().int().min(0).max(60).optional(),
  recentWindow: z.number().int().min(0).max(10).optional(),
});

export const recommendRoutes: FastifyPluginAsync = async (app) => {
  app.get('/config', async () => ({ data: getRecommendConfig() }));

  app.put('/config', async (request) => ({
    data: updateRecommendConfig(parseBody(configSchema, request.body)),
  }));

  app.post('/common-free', async (request) => {
    const input = parseBody(commonFreeSchema, request.body);
    return {
      data: { blocks: getCommonFreeBlocks({ ...input, userIds: input.userIds ?? [] }) },
    };
  });

  app.post('/scored', async (request) => {
    const input = parseBody(scoredSchema, request.body);
    return { data: { cells: getScoredCells(input as unknown as ScoredInput) } };
  });

  app.post('/alternatives', async (request) => ({
    data: getAlternatives(parseBody(alternativesSchema, request.body) as unknown as AlternativesInput),
  }));
};
