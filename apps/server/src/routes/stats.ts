import type { FastifyPluginAsync } from 'fastify';
import { toInt } from '../lib/params.ts';
import { getFairnessReport } from '../services/fairnessService.ts';

export const statsRoutes: FastifyPluginAsync = async (app) => {
  app.get('/fairness', async (request) => {
    const query = request.query as Record<string, unknown>;
    return {
      data: getFairnessReport({
        fromWeek: toInt(query.from_week, undefined),
        toWeek: toInt(query.to_week, undefined),
      }),
    };
  });
};
