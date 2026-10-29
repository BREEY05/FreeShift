import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { badRequest } from '../lib/errors.ts';
import { toBool, toInt } from '../lib/params.ts';
import type { CsvExport } from '../services/csvService.ts';
import { buildBoardCsv, buildSchedulesCsv } from '../services/csvService.ts';
import { resetOrgData } from '../services/dataResetService.ts';
import { importSchedules } from '../services/importExportService.ts';
import { requireOrg } from '../services/orgContext.ts';

function sendCsv(reply: FastifyReply, exportFile: CsvExport) {
  return reply
    .header('Content-Type', exportFile.contentType)
    .header('Content-Disposition', 'attachment; filename="' + exportFile.filename + '"')
    .send(exportFile.content);
}

export const dataRoutes: FastifyPluginAsync = async (app) => {
  app.get('/export/schedules', async (request, reply) => {
    const query = request.query as Record<string, unknown>;
    const orgId = requireOrg(request);
    return sendCsv(
      reply,
      buildSchedulesCsv(toInt(query.from_week, undefined), toInt(query.to_week, undefined), orgId),
    );
  });

  app.get('/export/board', async (request, reply) => {
    const query = request.query as Record<string, unknown>;
    // requireOrg 必须在 preHandler 之前执行：CSV 响应直接 send，不能再向外抛错
    const orgId = requireOrg(request);
    return sendCsv(reply, buildBoardCsv(toInt(query.week, undefined), orgId));
  });

  app.post('/import/schedules', async (request) => {
    const body = request.body;
    if (typeof body !== 'string') {
      throw badRequest('请求体必须为 text/csv 文本');
    }
    const query = request.query as Record<string, unknown>;
    const dryRun = toBool(query.dry_run) ?? false;
    return { data: importSchedules(body, dryRun, requireOrg(request)) };
  });

  /** 重置当前组织数据：清空 schedule / schedule_occurrence / app_user，保留 organization 与 org_member */
  const resetHandler = async (request: FastifyRequest) => ({
    data: resetOrgData(requireOrg(request)),
  });
  app.delete('/data/reset', resetHandler);
};
