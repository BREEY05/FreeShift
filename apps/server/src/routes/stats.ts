import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { AppError } from '../lib/errors.ts';
import { toInt } from '../lib/params.ts';
import { getFairnessReport } from '../services/fairnessService.ts';
import { isAdminRequest, requireOrg } from '../services/orgContext.ts';

function requireAdmin(request: FastifyRequest): void {
  if (!isAdminRequest(request)) throw new AppError(403, 'FORBIDDEN', '需要管理员权限');
}

export const statsRoutes: FastifyPluginAsync = async (app) => {
  app.get('/fairness', async (request) => {
    requireAdmin(request);
    const query = request.query as Record<string, unknown>;
    return {
      data: getFairnessReport(
        {
          fromWeek: toInt(query.from_week, undefined),
          toWeek: toInt(query.to_week, undefined),
        },
        requireOrg(request),
      ),
    };
  });
};
