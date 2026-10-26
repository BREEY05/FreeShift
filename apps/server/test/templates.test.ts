import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.ts';
import { closeDb } from '../src/db/index.ts';

const API = '/api/v1';

let app: FastifyInstance;

beforeEach(async () => {
  closeDb();
  app = buildApp();
  await app.ready();
});

afterEach(async () => {
  await app.close();
  closeDb();
});

async function listTemplates(): Promise<any[]> {
  const res = await app.inject({ method: 'GET', url: API + '/templates' });
  expect(res.statusCode).toBe(200);
  return res.json().data.templates;
}

async function getActiveSemester(): Promise<any> {
  const res = await app.inject({ method: 'GET', url: API + '/semester' });
  return res.json().data.semester;
}

async function createUser(name: string): Promise<any> {
  const res = await app.inject({ method: 'POST', url: API + '/users', payload: { name } });
  expect(res.statusCode).toBe(201);
  return res.json().data.user;
}

async function createTemplate(payload: Record<string, unknown>): Promise<any> {
  const res = await app.inject({ method: 'POST', url: API + '/templates', payload });
  expect(res.statusCode).toBe(201);
  return res.json().data;
}

describe('template routes', () => {
  it('GET /templates 返回 slotCount 与 isActive', async () => {
    const templates = await listTemplates();
    expect(templates.length).toBeGreaterThanOrEqual(4);
    const twoPeriods = templates.find((item) => item.name === '大学两节连排');
    const empty = templates.find((item) => item.name === '空白模板');
    const semester = await getActiveSemester();
    expect(twoPeriods.slotCount).toBe(5);
    expect(twoPeriods.isPreset).toBe(true);
    expect(twoPeriods.isActive).toBe(true);
    expect(twoPeriods.id).toBe(semester.activeTemplateId);
    expect(empty.slotCount).toBe(0);
    expect(empty.isActive).toBe(false);
  });

  it('GET /templates/:id 返回模板与时间段', async () => {
    const templates = await listTemplates();
    const twoPeriods = templates.find((item) => item.name === '大学两节连排');
    const res = await app.inject({ method: 'GET', url: API + '/templates/' + twoPeriods.id });
    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(data.template.id).toBe(twoPeriods.id);
    expect(data.slots).toHaveLength(5);
    expect(data.slots[0].sortOrder).toBe(1);
    expect(data.slots[0].label).toBe('第1-2节');
    expect(data.slots[0].dayPart).toBe('morning');
    expect(data.slots[0].durationMin).toBe(100);
  });

  it('预设模板只读，改名/删除/替换时间段均返回 409', async () => {
    const templates = await listTemplates();
    const preset = templates.find((item) => item.name === '大学两节连排');
    const detail = await app.inject({ method: 'GET', url: API + '/templates/' + preset.id });
    const presetSlotId = detail.json().data.slots[0].id;

    const patch = await app.inject({
      method: 'PATCH',
      url: API + '/templates/' + preset.id,
      payload: { name: '改个名' },
    });
    expect(patch.statusCode).toBe(409);
    expect(patch.json().error.code).toBe('TEMPLATE_READONLY');

    const del = await app.inject({ method: 'DELETE', url: API + '/templates/' + preset.id });
    expect(del.statusCode).toBe(409);
    expect(del.json().error.code).toBe('TEMPLATE_READONLY');

    const replace = await app.inject({
      method: 'PUT',
      url: API + '/templates/' + preset.id + '/slots',
      payload: { slots: [] },
    });
    expect(replace.statusCode).toBe(409);

    const append = await app.inject({
      method: 'POST',
      url: API + '/templates/' + preset.id + '/slots',
      payload: { label: '新时段' },
    });
    expect(append.statusCode).toBe(409);

    const patchSlot = await app.inject({
      method: 'PATCH',
      url: API + '/slots/' + presetSlotId,
      payload: { label: '改名' },
    });
    expect(patchSlot.statusCode).toBe(409);

    const deleteSlot = await app.inject({ method: 'DELETE', url: API + '/slots/' + presetSlotId });
    expect(deleteSlot.statusCode).toBe(409);
  });

  it('POST /templates 克隆预设模板复制时间段', async () => {
    const templates = await listTemplates();
    const preset = templates.find((item) => item.name === '大学小节');
    const created = await createTemplate({ name: '我的小节模板', description: '克隆自大学小节', cloneFrom: preset.id });
    expect(created.template.isPreset).toBe(false);
    expect(created.template.slotCount).toBe(8);
    expect(created.slots).toHaveLength(8);
    expect(created.slots[0].label).toBe('第1节');
    expect(created.slots[7].sortOrder).toBe(8);
  });

  it('POST /templates 重名返回 409 TEMPLATE_EXISTS', async () => {
    const res = await app.inject({ method: 'POST', url: API + '/templates', payload: { name: '大学小节' } });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('TEMPLATE_EXISTS');
  });

  it('PUT /templates/:id/slots 全量替换并推导字段', async () => {
    const created = await createTemplate({ name: '自定义模板' });
    expect(created.slots).toHaveLength(0);
    const res = await app.inject({
      method: 'PUT',
      url: API + '/templates/' + created.template.id + '/slots',
      payload: {
        slots: [
          { label: '第1节' },
          { label: '第2节', startTime: '08:00', endTime: '10:00' },
          { label: '晚上', startTime: '19:30', endTime: '21:00', durationMin: 120 },
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    const slots = res.json().data.slots;
    expect(slots).toHaveLength(3);
    expect(slots.map((slot: any) => slot.sortOrder)).toEqual([1, 2, 3]);
    expect(slots[0].dayPart).toBe('morning');
    expect(slots[0].durationMin).toBe(90);
    expect(slots[1].dayPart).toBe('morning');
    expect(slots[1].durationMin).toBe(120);
    expect(slots[2].dayPart).toBe('evening');
    expect(slots[2].durationMin).toBe(120);
  });

  it('PUT /templates/:id/slots 重复标签返回 422', async () => {
    const created = await createTemplate({ name: '重复标签模板' });
    const res = await app.inject({
      method: 'PUT',
      url: API + '/templates/' + created.template.id + '/slots',
      payload: { slots: [{ label: '上午' }, { label: '上午' }] },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('POST /templates/:id/slots 追加单格并推导排序与字段', async () => {
    const created = await createTemplate({ name: '追加模板' });
    const first = await app.inject({
      method: 'POST',
      url: API + '/templates/' + created.template.id + '/slots',
      payload: { label: '上午' },
    });
    expect(first.statusCode).toBe(201);
    expect(first.json().data.slot.sortOrder).toBe(1);

    const second = await app.inject({
      method: 'POST',
      url: API + '/templates/' + created.template.id + '/slots',
      payload: { label: '下午', startTime: '14:00', endTime: '15:30' },
    });
    expect(second.statusCode).toBe(201);
    const slot = second.json().data.slot;
    expect(slot.sortOrder).toBe(2);
    expect(slot.dayPart).toBe('afternoon');
    expect(slot.durationMin).toBe(90);

    const invalid = await app.inject({
      method: 'POST',
      url: API + '/templates/' + created.template.id + '/slots',
      payload: { label: '' },
    });
    expect(invalid.statusCode).toBe(422);
  });

  it('PATCH /slots/:id 修改单格并重算推导字段', async () => {
    const created = await createTemplate({ name: '编辑模板' });
    const added = await app.inject({
      method: 'POST',
      url: API + '/templates/' + created.template.id + '/slots',
      payload: { label: '上午', startTime: '08:00', endTime: '09:00' },
    });
    const slotId = added.json().data.slot.id;

    const res = await app.inject({
      method: 'PATCH',
      url: API + '/slots/' + slotId,
      payload: { startTime: '14:00', endTime: '15:00' },
    });
    expect(res.statusCode).toBe(200);
    const slot = res.json().data.slot;
    expect(slot.startTime).toBe('14:00');
    expect(slot.dayPart).toBe('afternoon');
    expect(slot.durationMin).toBe(60);
  });

  it('DELETE /slots/:id 删除无引用时间段', async () => {
    const created = await createTemplate({ name: '删除模板' });
    const added = await app.inject({
      method: 'POST',
      url: API + '/templates/' + created.template.id + '/slots',
      payload: { label: '待删除' },
    });
    const slotId = added.json().data.slot.id;
    const res = await app.inject({ method: 'DELETE', url: API + '/slots/' + slotId });
    expect(res.statusCode).toBe(204);

    const detail = await app.inject({ method: 'GET', url: API + '/templates/' + created.template.id });
    expect(detail.json().data.slots).toHaveLength(0);
  });

  it('POST /templates/:id/activate 切换当前模板', async () => {
    const templates = await listTemplates();
    const single = templates.find((item) => item.name === '大学小节');
    const res = await app.inject({ method: 'POST', url: API + '/templates/' + single.id + '/activate', payload: {} });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.semester.activeTemplateId).toBe(single.id);

    const after = await listTemplates();
    expect(after.find((item) => item.id === single.id).isActive).toBe(true);
    expect(after.find((item) => item.name === '大学两节连排').isActive).toBe(false);
  });

  it('旧模板有安排时 activate 返回 409 TEMPLATE_IN_USE，force 可强制切换', async () => {
    const templates = await listTemplates();
    const twoPeriods = templates.find((item) => item.name === '大学两节连排');
    const single = templates.find((item) => item.name === '大学小节');
    const detail = await app.inject({ method: 'GET', url: API + '/templates/' + twoPeriods.id });
    const slotId = detail.json().data.slots[0].id;
    const user = await createUser('小林');
    const schedule = await app.inject({
      method: 'POST',
      url: API + '/schedules',
      payload: { userId: user.id, weekday: 1, slotId, startWeek: 1, endWeek: 4, parity: 'all' },
    });
    expect(schedule.statusCode).toBe(201);

    const blocked = await app.inject({ method: 'POST', url: API + '/templates/' + single.id + '/activate', payload: {} });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().error.code).toBe('TEMPLATE_IN_USE');
    expect(blocked.json().error.details.scheduleCount).toBe(1);

    const forced = await app.inject({
      method: 'POST',
      url: API + '/templates/' + single.id + '/activate',
      payload: { force: true },
    });
    expect(forced.statusCode).toBe(200);
    expect(forced.json().data.semester.activeTemplateId).toBe(single.id);
  });

  it('DELETE /templates/:id 启用中模板返回 409', async () => {
    const created = await createTemplate({ name: '待启用模板' });
    const activate = await app.inject({
      method: 'POST',
      url: API + '/templates/' + created.template.id + '/activate',
      payload: {},
    });
    expect(activate.statusCode).toBe(200);

    const res = await app.inject({ method: 'DELETE', url: API + '/templates/' + created.template.id });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('TEMPLATE_ACTIVE');
  });

  it('PUT /templates/:id/slots 已有安排时返回 409 SLOT_IN_USE', async () => {
    const created = await createTemplate({ name: '被引用模板' });
    const slotsRes = await app.inject({
      method: 'PUT',
      url: API + '/templates/' + created.template.id + '/slots',
      payload: { slots: [{ label: '上午' }, { label: '下午' }] },
    });
    const slots = slotsRes.json().data.slots;
    const activate = await app.inject({
      method: 'POST',
      url: API + '/templates/' + created.template.id + '/activate',
      payload: {},
    });
    expect(activate.statusCode).toBe(200);

    const user = await createUser('阿哲');
    const schedule = await app.inject({
      method: 'POST',
      url: API + '/schedules',
      payload: { userId: user.id, weekday: 2, slotId: slots[0].id, startWeek: 1, endWeek: 3, parity: 'all' },
    });
    expect(schedule.statusCode).toBe(201);

    const res = await app.inject({
      method: 'PUT',
      url: API + '/templates/' + created.template.id + '/slots',
      payload: { slots: [{ label: '新上午' }] },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('SLOT_IN_USE');
  });

  it('DELETE /templates/:id 删除自定义模板', async () => {
    const created = await createTemplate({ name: '可删除模板' });
    const res = await app.inject({ method: 'DELETE', url: API + '/templates/' + created.template.id });
    expect(res.statusCode).toBe(204);
    const templates = await listTemplates();
    expect(templates.some((item) => item.id === created.template.id)).toBe(false);
  });
});
