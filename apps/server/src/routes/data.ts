import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { AppError, badRequest } from '../lib/errors.ts';
import { toBool, toInt } from '../lib/params.ts';
import type { CsvExport } from '../services/csvService.ts';
import { buildBoardCsv, buildSchedulesCsv } from '../services/csvService.ts';
import { resetOrgData } from '../services/dataResetService.ts';
import { importSchedules } from '../services/importExportService.ts';
import { requestEmail, requireOrg } from '../services/orgContext.ts';
import { canManage, listOrgs } from '../services/orgService.ts';

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
  const resetHandler = async (request: FastifyRequest) => {
    const orgId = requireOrg(request);
    const email = requestEmail(request);
    if (!canManage(orgId, email)) throw new AppError(403, 'FORBIDDEN', '仅组织负责人可重置数据');
    const before = listOrgs(email).map((item) => item.org.id);
    const result = resetOrgData(orgId);
    // 兜底：重置不能影响组织的归属关系
    const after = listOrgs(email).map((item) => item.org.id);
    if (after.length !== before.length) throw new AppError(500, 'RESET_UNSAFE', '重置后组织归属异常，已中止');
    return { data: result };
  };
  app.delete('/data/reset', resetHandler);
};
