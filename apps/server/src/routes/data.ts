import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import { badRequest } from '../lib/errors.ts';
import { toBool, toInt } from '../lib/params.ts';
import type { CsvExport } from '../services/csvService.ts';
import { buildBoardCsv, buildSchedulesCsv } from '../services/csvService.ts';
import { importSchedules } from '../services/importExportService.ts';

function sendCsv(reply: FastifyReply, exportFile: CsvExport) {
  return reply
    .header('Content-Type', exportFile.contentType)
    .header('Content-Disposition', 'attachment; filename="' + exportFile.filename + '"')
    .send(exportFile.content);
}

export const dataRoutes: FastifyPluginAsync = async (app) => {
  app.get('/export/schedules', async (request, reply) => {
    const query = request.query as Record<string, unknown>;
    return sendCsv(reply, buildSchedulesCsv(toInt(query.from_week, undefined), toInt(query.to_week, undefined)));
  });

  app.get('/export/board', async (request, reply) => {
    const query = request.query as Record<string, unknown>;
    return sendCsv(reply, buildBoardCsv(toInt(query.week, undefined)));
  });

  app.post('/import/schedules', async (request) => {
    const body = request.body;
    if (typeof body !== 'string') {
      throw badRequest('请求体必须为 text/csv 文本');
    }
    const query = request.query as Record<string, unknown>;
    const dryRun = toBool(query.dry_run) ?? false;
    return { data: importSchedules(body, dryRun) };
  });
};
