import { z } from 'zod';
import { buildWeeks } from '@freeshift/shared';
import type { DayPart, SemesterOverview, SlotInput, SlotTemplate, TimeSlot } from '@freeshift/shared';
import { all, get, run, transaction } from '../db/index.ts';
import { AppError, notFound } from '../lib/errors.ts';
import { mapSlot, mapTemplate, type SemesterRow, type SlotRow, type TemplateRow } from '../lib/mappers.ts';
import { getActiveSemester, getTemplateSlots } from './context.ts';

const timeSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, '时间格式应为 HH:MM')
  .nullable()
  .optional();

const dayPartSchema = z.enum(['morning', 'afternoon', 'evening'], {
  errorMap: () => ({ message: '时段必须为 morning、afternoon 或 evening' }),
});

export const slotInputSchema = z.object({
  label: z
    .string({ required_error: '请输入时间段名称', invalid_type_error: '时间段名称必须为字符串' })
    .trim()
    .min(1, '时间段名称不能为空')
    .max(50, '时间段名称不能超过 50 个字符'),
  startTime: timeSchema,
  endTime: timeSchema,
  dayPart: dayPartSchema.optional(),
  durationMin: z
    .number({ invalid_type_error: '时长必须为数字' })
    .int('时长必须为整数')
    .min(5, '时长必须在 5-720 分钟之间')
    .max(720, '时长必须在 5-720 分钟之间')
    .optional(),
  sortOrder: z
    .number({ invalid_type_error: '排序号必须为数字' })
    .int('排序号必须为整数')
    .positive('排序号必须为正整数')
    .optional(),
});

export const slotPatchSchema = slotInputSchema.partial();

export const templateInputSchema = z.object({
  name: z
    .string({ required_error: '请输入模板名称', invalid_type_error: '模板名称必须为字符串' })
    .trim()
    .min(1, '模板名称不能为空')
    .max(50, '模板名称不能超过 50 个字符'),
  description: z.string().max(200, '描述不能超过 200 个字符').optional(),
  cloneFrom: z
    .number({ invalid_type_error: '克隆来源模板 ID 必须为数字' })
    .int('克隆来源模板 ID 必须为整数')
    .positive('克隆来源模板 ID 必须为正整数')
    .optional(),
});

export const templatePatchSchema = z.object({
  name: z.string().trim().min(1, '模板名称不能为空').max(50, '模板名称不能超过 50 个字符').optional(),
  description: z.string().max(200, '描述不能超过 200 个字符').optional(),
});

export const templateSlotsSchema = z.object({
  slots: z.array(slotInputSchema).max(200, '时间段数量不能超过 200 个'),
});

export const activateTemplateSchema = z.object({
  force: z.boolean({ invalid_type_error: 'force 必须为布尔值' }).optional(),
});

export type SlotInputParsed = z.infer<typeof slotInputSchema>;
export type SlotPatchParsed = z.infer<typeof slotPatchSchema>;
export type TemplateInputParsed = z.infer<typeof templateInputSchema>;
export type TemplatePatchParsed = z.infer<typeof templatePatchSchema>;

export interface TemplateDetail {
  template: SlotTemplate;
  slots: TimeSlot[];
}

interface SlotValues {
  label: string;
  startTime: string | null;
  endTime: string | null;
  dayPart: DayPart;
  durationMin: number;
  sortOrder: number;
}

function readonlyError(): AppError {
  return new AppError(409, 'TEMPLATE_READONLY', '预设模板只读，无法修改');
}

function parseTimeToMinutes(value: string): number {
  const [hours, minutes] = value.split(':');
  return Number(hours) * 60 + Number(minutes);
}

/** 缺省根据开始时间推断时段：<12 上午，<18 下午，其余晚上 */
export function deriveDayPart(startTime: string | null | undefined): DayPart {
  if (!startTime) return 'morning';
  const hour = Number(startTime.slice(0, 2));
  if (hour < 12) return 'morning';
  if (hour < 18) return 'afternoon';
  return 'evening';
}

/** 缺省根据起止时间计算时长；无法计算时回退 90 分钟 */
export function deriveDurationMin(startTime: string | null | undefined, endTime: string | null | undefined): number {
  if (startTime && endTime) {
    const diff = parseTimeToMinutes(endTime) - parseTimeToMinutes(startTime);
    if (diff >= 5 && diff <= 720) return diff;
  }
  return 90;
}

function normalizeSlot(input: SlotInput, sortOrder: number): SlotValues {
  const startTime = input.startTime ?? null;
  const endTime = input.endTime ?? null;
  return {
    label: input.label.trim(),
    startTime,
    endTime,
    dayPart: input.dayPart ?? deriveDayPart(startTime),
    durationMin: input.durationMin ?? deriveDurationMin(startTime, endTime),
    sortOrder,
  };
}

function insertSlotRecord(templateId: number, values: SlotValues): number {
  const result = run(
    `INSERT INTO time_slot (template_id, label, start_time, end_time, day_part, duration_min, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [templateId, values.label, values.startTime, values.endTime, values.dayPart, values.durationMin, values.sortOrder],
  );
  return result.lastInsertRowid;
}

function templateRow(id: number): TemplateRow | undefined {
  return get<TemplateRow>('SELECT * FROM slot_template WHERE id = ?', [id]);
}

function requireTemplateRow(id: number): TemplateRow {
  const row = templateRow(id);
  if (!row) throw notFound('模板');
  return row;
}

function activeSemesterRow(): SemesterRow | undefined {
  return get<SemesterRow>('SELECT * FROM semester WHERE is_active = 1 LIMIT 1');
}

function buildOverview(): SemesterOverview {
  const semester = getActiveSemester();
  return { semester, weeks: buildWeeks(semester) };
}

function assertTemplateNameAvailable(name: string, excludeId?: number): void {
  const row = excludeId
    ? get<TemplateRow>('SELECT * FROM slot_template WHERE name = ? AND id <> ?', [name, excludeId])
    : get<TemplateRow>('SELECT * FROM slot_template WHERE name = ?', [name]);
  if (row) throw new AppError(409, 'TEMPLATE_EXISTS', '模板名称已存在：' + name);
}

function countSchedulesUsingTemplate(templateId: number, semesterId?: number): number {
  const sql = semesterId
    ? `SELECT COUNT(*) AS n FROM schedule s JOIN time_slot ts ON ts.id = s.slot_id
        WHERE s.semester_id = ? AND ts.template_id = ?`
    : `SELECT COUNT(*) AS n FROM schedule s JOIN time_slot ts ON ts.id = s.slot_id
        WHERE ts.template_id = ?`;
  const row = get<{ n: number }>(sql, semesterId ? [semesterId, templateId] : [templateId]);
  return Number(row?.n ?? 0);
}

function countSemestersUsingTemplate(templateId: number): number {
  const row = get<{ n: number }>('SELECT COUNT(*) AS n FROM semester WHERE active_template_id = ?', [templateId]);
  return Number(row?.n ?? 0);
}

function slotLabelExists(templateId: number, label: string, excludeId?: number): boolean {
  const row = excludeId
    ? get<SlotRow>('SELECT * FROM time_slot WHERE template_id = ? AND label = ? AND id <> ?', [templateId, label, excludeId])
    : get<SlotRow>('SELECT * FROM time_slot WHERE template_id = ? AND label = ?', [templateId, label]);
  return row !== undefined;
}

function slotSortOrderExists(templateId: number, sortOrder: number, excludeId?: number): boolean {
  const row = excludeId
    ? get<SlotRow>('SELECT * FROM time_slot WHERE template_id = ? AND sort_order = ? AND id <> ?', [
        templateId,
        sortOrder,
        excludeId,
      ])
    : get<SlotRow>('SELECT * FROM time_slot WHERE template_id = ? AND sort_order = ?', [templateId, sortOrder]);
  return row !== undefined;
}

function nextSlotSortOrder(templateId: number): number {
  const row = get<{ m: number | null }>('SELECT MAX(sort_order) AS m FROM time_slot WHERE template_id = ?', [templateId]);
  return Number(row?.m ?? 0) + 1;
}

function validationError(message: string, path: string): AppError {
  return new AppError(422, 'VALIDATION_ERROR', message, [{ path, message }]);
}

export function listTemplates(): SlotTemplate[] {
  const rows = all<TemplateRow>(
    `SELECT t.*,
            (SELECT COUNT(*) FROM time_slot ts WHERE ts.template_id = t.id) AS slot_count,
            (SELECT COUNT(*) FROM semester s WHERE s.is_active = 1 AND s.active_template_id = t.id) AS is_active
       FROM slot_template t
      ORDER BY t.id ASC`,
  );
  return rows.map(mapTemplate);
}

export function getTemplateDetail(id: number): TemplateDetail {
  const row = requireTemplateRow(id);
  const slots = getTemplateSlots(id);
  const active = activeSemesterRow();
  return {
    template: mapTemplate({
      ...row,
      slot_count: slots.length,
      is_active: active && Number(active.active_template_id) === id ? 1 : 0,
    }),
    slots,
  };
}

export function createTemplate(input: TemplateInputParsed): TemplateDetail {
  const name = input.name.trim();
  assertTemplateNameAvailable(name);

  let sourceSlots: TimeSlot[] = [];
  if (input.cloneFrom !== undefined) {
    const source = requireTemplateRow(input.cloneFrom);
    sourceSlots = getTemplateSlots(source.id);
  }

  let templateId: number;
  try {
    templateId = transaction(() => {
      const result = run('INSERT INTO slot_template (name, description, is_preset) VALUES (?, ?, 0)', [
        name,
        input.description ?? '',
      ]);
      const id = result.lastInsertRowid;
      sourceSlots.forEach((slot, index) => {
        insertSlotRecord(id, {
          label: slot.label,
          startTime: slot.startTime,
          endTime: slot.endTime,
          dayPart: slot.dayPart,
          durationMin: slot.durationMin,
          sortOrder: index + 1,
        });
      });
      return id;
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/UNIQUE|constraint/i.test(message)) {
      throw new AppError(409, 'TEMPLATE_EXISTS', '模板名称已存在：' + name);
    }
    throw error;
  }
  return getTemplateDetail(templateId);
}

export function updateTemplate(id: number, patch: TemplatePatchParsed): TemplateDetail {
  const row = requireTemplateRow(id);
  if (Number(row.is_preset) === 1) throw readonlyError();
  const sets: string[] = [];
  const params: (string | number)[] = [];
  if (patch.name !== undefined) {
    const name = patch.name.trim();
    if (name !== row.name) {
      assertTemplateNameAvailable(name, id);
      sets.push('name = ?');
      params.push(name);
    }
  }
  if (patch.description !== undefined) {
    sets.push('description = ?');
    params.push(patch.description);
  }
  if (sets.length > 0) {
    try {
      run('UPDATE slot_template SET ' + sets.join(', ') + ' WHERE id = ?', [...params, id]);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/UNIQUE|constraint/i.test(message)) {
        throw new AppError(409, 'TEMPLATE_EXISTS', '模板名称已存在');
      }
      throw error;
    }
  }
  return getTemplateDetail(id);
}

export function deleteTemplate(id: number): void {
  const row = requireTemplateRow(id);
  if (Number(row.is_preset) === 1) throw readonlyError();
  if (countSemestersUsingTemplate(id) > 0) {
    throw new AppError(409, 'TEMPLATE_ACTIVE', '模板正在被学期使用，无法删除');
  }
  const scheduleCount = countSchedulesUsingTemplate(id);
  if (scheduleCount > 0) {
    throw new AppError(409, 'TEMPLATE_IN_USE', '模板已被安排引用，无法删除', { scheduleCount });
  }
  run('DELETE FROM slot_template WHERE id = ?', [id]);
}

export function activateTemplate(id: number, force: boolean): SemesterOverview {
  requireTemplateRow(id);
  const semester = getActiveSemester();
  if (semester.activeTemplateId === id) return buildOverview();

  const oldTemplateId = semester.activeTemplateId;
  let scheduleCount = 0;
  if (oldTemplateId !== null) {
    scheduleCount = countSchedulesUsingTemplate(oldTemplateId, semester.id);
  }
  if (scheduleCount > 0 && !force) {
    throw new AppError(409, 'TEMPLATE_IN_USE', '旧模板仍有 ' + scheduleCount + ' 条安排，若确认切换请强制激活', {
      scheduleCount,
    });
  }
  run("UPDATE semester SET active_template_id = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?", [
    id,
    semester.id,
  ]);
  return buildOverview();
}

export function replaceSlots(templateId: number, inputs: SlotInput[]): TimeSlot[] {
  const row = requireTemplateRow(templateId);
  if (Number(row.is_preset) === 1) throw readonlyError();

  const scheduleCount = countSchedulesUsingTemplate(templateId);
  if (scheduleCount > 0) {
    throw new AppError(409, 'SLOT_IN_USE', '模板已被安排引用，无法替换时间段', { scheduleCount });
  }

  const labels = new Set<string>();
  inputs.forEach((input, index) => {
    const label = input.label.trim();
    if (labels.has(label)) {
      throw validationError('时间段名称重复：' + label, 'slots.' + index + '.label');
    }
    labels.add(label);
  });

  const prepared = inputs.map((input, index) => normalizeSlot(input, index + 1));
  transaction(() => {
    run('DELETE FROM time_slot WHERE template_id = ?', [templateId]);
    for (const slot of prepared) {
      insertSlotRecord(templateId, slot);
    }
  });
  return getTemplateSlots(templateId);
}

export function addSlot(templateId: number, input: SlotInputParsed): TimeSlot {
  const row = requireTemplateRow(templateId);
  if (Number(row.is_preset) === 1) throw readonlyError();

  const label = input.label.trim();
  if (slotLabelExists(templateId, label)) {
    throw validationError('时间段名称已存在：' + label, 'label');
  }
  const sortOrder = input.sortOrder ?? nextSlotSortOrder(templateId);
  if (slotSortOrderExists(templateId, sortOrder)) {
    throw validationError('排序号已被占用：' + sortOrder, 'sortOrder');
  }
  const values = normalizeSlot({ ...input, label }, sortOrder);
  const id = insertSlotRecord(templateId, values);
  return mapSlot(get<SlotRow>('SELECT * FROM time_slot WHERE id = ?', [id]) as SlotRow);
}

type SlotRowWithPreset = SlotRow & { is_preset: number };

function requireSlotRow(id: number): SlotRowWithPreset {
  const row = get<SlotRowWithPreset>(
    `SELECT ts.*, t.is_preset
       FROM time_slot ts
       JOIN slot_template t ON t.id = ts.template_id
      WHERE ts.id = ?`,
    [id],
  );
  if (!row) throw notFound('时间段');
  if (Number(row.is_preset) === 1) throw readonlyError();
  return row;
}

export function updateSlot(slotId: number, patch: SlotPatchParsed): TimeSlot {
  const row = requireSlotRow(slotId);
  const templateId = Number(row.template_id);

  const label = patch.label !== undefined ? patch.label.trim() : row.label;
  const startTime = patch.startTime !== undefined ? patch.startTime : row.start_time;
  const endTime = patch.endTime !== undefined ? patch.endTime : row.end_time;
  let dayPart: DayPart = row.day_part;
  if (patch.dayPart !== undefined) {
    dayPart = patch.dayPart;
  } else if (patch.startTime !== undefined) {
    dayPart = deriveDayPart(startTime);
  }
  let durationMin = Number(row.duration_min);
  if (patch.durationMin !== undefined) {
    durationMin = patch.durationMin;
  } else if (patch.startTime !== undefined || patch.endTime !== undefined) {
    durationMin = deriveDurationMin(startTime, endTime);
  }
  const sortOrder = patch.sortOrder ?? Number(row.sort_order);

  if (label !== row.label && slotLabelExists(templateId, label, slotId)) {
    throw validationError('时间段名称已存在：' + label, 'label');
  }
  if (sortOrder !== Number(row.sort_order) && slotSortOrderExists(templateId, sortOrder, slotId)) {
    throw validationError('排序号已被占用：' + sortOrder, 'sortOrder');
  }

  run(
    `UPDATE time_slot
        SET label = ?, start_time = ?, end_time = ?, day_part = ?, duration_min = ?, sort_order = ?
      WHERE id = ?`,
    [label, startTime, endTime, dayPart, durationMin, sortOrder, slotId],
  );
  return mapSlot(get<SlotRow>('SELECT * FROM time_slot WHERE id = ?', [slotId]) as SlotRow);
}

export function deleteSlot(slotId: number): void {
  requireSlotRow(slotId);
  const row = get<{ n: number }>('SELECT COUNT(*) AS n FROM schedule WHERE slot_id = ?', [slotId]);
  const scheduleCount = Number(row?.n ?? 0);
  if (scheduleCount > 0) {
    throw new AppError(409, 'SLOT_IN_USE', '时间段已被安排引用，无法删除', { scheduleCount });
  }
  run('DELETE FROM time_slot WHERE id = ?', [slotId]);
}
