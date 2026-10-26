import type { SemesterOverview, SlotInput, SlotTemplate, TimeSlot, TemplateInput } from '@freeshift/shared';
import { ApiError, api } from './client';

export const templateKeys = {
  all: ['templates'] as const,
  list: () => ['templates', 'list'] as const,
  detail: (id: number) => ['templates', 'detail', id] as const,
};

export interface TemplateDetail {
  template: SlotTemplate;
  slots: TimeSlot[];
}

export interface TemplatePatch {
  name?: string;
  description?: string;
}

export async function fetchTemplates(): Promise<SlotTemplate[]> {
  const data = await api.get<{ templates: SlotTemplate[] }>('/templates');
  return data.templates;
}

export function fetchTemplateDetail(id: number): Promise<TemplateDetail> {
  return api.get<TemplateDetail>('/templates/' + id);
}

export function createTemplate(input: TemplateInput): Promise<TemplateDetail> {
  return api.post<TemplateDetail>('/templates', input);
}

export function updateTemplate(id: number, patch: TemplatePatch): Promise<TemplateDetail> {
  return api.patch<TemplateDetail>('/templates/' + id, patch);
}

export async function deleteTemplate(id: number): Promise<void> {
  await api.delete('/templates/' + id);
}

/** 设为当前模板；旧模板有安排且未 force 时 409 TEMPLATE_IN_USE */
export function activateTemplate(id: number, force = false): Promise<SemesterOverview> {
  return api.post<SemesterOverview>('/templates/' + id + '/activate', { force });
}

/** 全量替换时间段（模板已有安排时 409 SLOT_IN_USE） */
export async function replaceSlots(templateId: number, slots: SlotInput[]): Promise<TimeSlot[]> {
  const data = await api.put<{ slots: TimeSlot[] }>('/templates/' + templateId + '/slots', { slots });
  return data.slots;
}

export async function addSlot(templateId: number, input: SlotInput): Promise<TimeSlot> {
  const data = await api.post<{ slot: TimeSlot }>('/templates/' + templateId + '/slots', input);
  return data.slot;
}

export async function updateSlot(slotId: number, patch: Partial<SlotInput>): Promise<TimeSlot> {
  const data = await api.patch<{ slot: TimeSlot }>('/slots/' + slotId, patch);
  return data.slot;
}

export async function deleteSlot(slotId: number): Promise<void> {
  await api.delete('/slots/' + slotId);
}
/** 409 冲突里携带的安排条数（TEMPLATE_IN_USE / SLOT_IN_USE 的 details.scheduleCount） */
export function conflictScheduleCount(error: unknown): number | null {
  if (!(error instanceof ApiError) || error.status !== 409) return null;
  const details = error.details;
  if (typeof details !== 'object' || details === null) return null;
  const count = (details as { scheduleCount?: unknown }).scheduleCount;
  return typeof count === 'number' ? count : null;
}
