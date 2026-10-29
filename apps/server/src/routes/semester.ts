import { requireOrg } from '../services/orgContext.ts';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { buildWeeks } from '@freeshift/shared';
import type { Semester, SemesterOverview, WeekInfo, WeekParity } from '@freeshift/shared';
import { all, get, run, transaction } from '../db/index.ts';
import { AppError, notFound } from '../lib/errors.ts';
import { type ScheduleRow, type SemesterRow } from '../lib/mappers.ts';
import { parseBody } from '../lib/validate.ts';
import { getActiveSemester, getSemesterById } from '../services/context.ts';
import { refreshOccurrences } from '../services/occurrence.ts';

const dateSchema = z
  .string({ required_error: '请选择学期开始日期', invalid_type_error: '开始日期必须为字符串' })
  .regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式应为 YYYY-MM-DD')
  .refine((value) => !Number.isNaN(Date.parse(value + 'T00:00:00Z')), '开始日期无效');

const semesterInputSchema = z.object({
  name: z
    .string({ required_error: '请输入学期名称', invalid_type_error: '学期名称必须为字符串' })
    .trim()
    .min(1, '学期名称不能为空')
    .max(80, '学期名称不能超过 80 个字符'),
  startDate: dateSchema,
  totalWeeks: z
    .number({ invalid_type_error: '周数必须为数字' })
    .int('周数必须为整数')
    .min(1, '学期周数必须在 1-60 之间')
    .max(60, '学期周数必须在 1-60 之间'),
  week1Parity: z.enum(['odd', 'even'], { errorMap: () => ({ message: '第 1 周奇偶性必须为 odd 或 even' }) }).optional(),
});

const semesterPatchSchema = semesterInputSchema.partial();

const semesterCreateSchema = semesterInputSchema.extend({
  activeTemplateId: z.number().int().positive('模板 ID 必须为正整数').nullable().optional(),
});

function overviewOf(semester: Semester): SemesterOverview {
  return { semester, weeks: buildWeeks(semester) };
}

/** 事务内重建某学期的全部 occurrence，仅展开 1..totalWeeks（调用方负责事务） */
function rebuildSemesterOccurrences(semesterId: number, totalWeeks: number, week1Parity: WeekParity): void {
  run('DELETE FROM schedule_occurrence WHERE semester_id = ?', [semesterId]);
  const rows = all<ScheduleRow>('SELECT * FROM schedule WHERE semester_id = ?', [semesterId]);
  for (const row of rows) {
    refreshOccurrences(
      {
        id: Number(row.id),
        semesterId,
        userId: Number(row.user_id),
        weekday: Number(row.weekday),
        slotId: Number(row.slot_id),
        startWeek: Number(row.start_week),
        endWeek: Number(row.end_week),
        parity: row.parity,
      },
      week1Parity,
    );
  }
  run('DELETE FROM schedule_occurrence WHERE semester_id = ? AND week_no > ?', [semesterId, totalWeeks]);
}

export const semesterRoutes: FastifyPluginAsync = async (app) => {
  app.get('/', async (request) => {
    const semester = getActiveSemester(requireOrg(request));
    return { data: overviewOf(semester) };
  });

  app.get('/weeks', async (request) => {
    const semester = getActiveSemester(requireOrg(request));
    const weeks: WeekInfo[] = buildWeeks(semester);
    return { data: { weeks } };
  });

  app.put('/', async (request) => {
    const patch = parseBody(semesterPatchSchema, request.body ?? {});
    const current = getActiveSemester(requireOrg(request));

    const name = patch.name ?? current.name;
    const startDate = patch.startDate ?? current.startDate;
    const totalWeeks = patch.totalWeeks ?? current.totalWeeks;
    const week1Parity = patch.week1Parity ?? current.week1Parity;
    const rebuild =
      startDate !== current.startDate ||
      totalWeeks !== current.totalWeeks ||
      week1Parity !== current.week1Parity;

    transaction(() => {
      run(
        `UPDATE semester
            SET name = ?, start_date = ?, total_weeks = ?, week1_parity = ?,
                updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
          WHERE id = ?`,
        [name, startDate, totalWeeks, week1Parity, current.id],
      );
      if (rebuild) {
        rebuildSemesterOccurrences(current.id, totalWeeks, week1Parity);
      }
    });

    return { data: overviewOf(getSemesterById(current.id, requireOrg(request))) };
  });

  app.post('/', async (request, reply) => {
    const input = parseBody(semesterCreateSchema, request.body ?? {});
    const active = get<SemesterRow>('SELECT * FROM semester WHERE is_active = 1 AND org_id = ? LIMIT 1', [requireOrg(request)]);
    const templateId = input.activeTemplateId ?? (active ? (active.active_template_id === null ? null : Number(active.active_template_id)) : null);
    if (templateId !== null) {
      const template = get<{ id: number }>('SELECT id FROM slot_template WHERE id = ? AND org_id = ?', [templateId, requireOrg(request)]);
      if (!template) throw notFound('时间段模板');
    }

    const semesterId = transaction(() => {
      run("UPDATE semester SET is_active = 0, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE is_active = 1 AND org_id = ?", [requireOrg(request)]);
      const result = run(
        `INSERT INTO semester (name, start_date, total_weeks, week1_parity, active_template_id, is_active, org_id)
         VALUES (?, ?, ?, ?, ?, 1, ?)`,
        [input.name, input.startDate, input.totalWeeks, input.week1Parity ?? 'odd', templateId, requireOrg(request)],
      );
      return result.lastInsertRowid;
    });

    const created = getSemesterById(semesterId, requireOrg(request));
    if (!created.isActive) {
      throw new AppError(500, 'INTERNAL_ERROR', '学期启用状态写入失败');
    }
    reply.status(201);
    return { data: overviewOf(created) };
  });
};
