import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.ts';
import { closeDb, getDb } from '../src/db/index.ts';

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

async function getSemester(): Promise<any> {
  const res = await app.inject({ method: 'GET', url: API + '/semester' });
  expect(res.statusCode).toBe(200);
  return res.json().data.semester;
}

async function getSlots(): Promise<any[]> {
  const semester = await getSemester();
  const res = await app.inject({ method: 'GET', url: API + '/templates/' + semester.activeTemplateId });
  expect(res.statusCode).toBe(200);
  return res.json().data.slots;
}

async function createUser(name: string): Promise<any> {
  const res = await app.inject({ method: 'POST', url: API + '/users', payload: { name } });
  expect(res.statusCode).toBe(201);
  return res.json().data.user;
}

function occurrenceWeeks(semesterId: number): number[] {
  const rows = getDb()
    .prepare('SELECT week_no FROM schedule_occurrence WHERE semester_id = ? ORDER BY week_no ASC')
    .all(semesterId) as { week_no: number }[];
  return rows.map((row) => Number(row.week_no));
}

describe('semester routes', () => {
  it('GET /semester 返回学期与周历', async () => {
    const semester = await getSemester();
    expect(semester.isActive).toBe(true);
    expect(semester.totalWeeks).toBe(20);
    expect(semester.week1Parity).toBe('odd');
    expect(typeof semester.startDate).toBe('string');

    const res = await app.inject({ method: 'GET', url: API + '/semester' });
    const weeks = res.json().data.weeks;
    expect(weeks).toHaveLength(20);
    expect(weeks[0].weekNo).toBe(1);
    expect(weeks[0].parity).toBe('odd');
    expect(weeks[0].startDate).toBe(semester.startDate);
    expect(weeks[1].parity).toBe('even');
    expect(typeof weeks[0].isCurrent).toBe('boolean');
  });

  it('GET /semester/weeks 只返回周历', async () => {
    const semester = await getSemester();
    const res = await app.inject({ method: 'GET', url: API + '/semester/weeks' });
    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(data.semester).toBeUndefined();
    expect(data.weeks).toHaveLength(semester.totalWeeks);
  });

  it('PUT /semester 支持部分字段', async () => {
    const res = await app.inject({ method: 'PUT', url: API + '/semester', payload: { name: '2026 春季学期' } });
    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(data.semester.name).toBe('2026 春季学期');
    expect(data.weeks).toHaveLength(20);
  });

  it('PUT /semester 周设置变化时事务内重建 occurrence', async () => {
    const semester = await getSemester();
    const slots = await getSlots();
    const user = await createUser('小林');
    const created = await app.inject({
      method: 'POST',
      url: API + '/schedules',
      payload: { userId: user.id, weekday: 1, slotId: slots[0].id, startWeek: 1, endWeek: 6, parity: 'odd' },
    });
    expect(created.statusCode).toBe(201);
    expect(occurrenceWeeks(semester.id)).toEqual([1, 3, 5]);

    // 第 1 周改为双周、总周数缩到 4：单周安排的命中周变为 2、4
    const updated = await app.inject({
      method: 'PUT',
      url: API + '/semester',
      payload: { totalWeeks: 4, week1Parity: 'even' },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().data.semester.totalWeeks).toBe(4);
    expect(updated.json().data.weeks).toHaveLength(4);
    expect(occurrenceWeeks(semester.id)).toEqual([2, 4]);
  });

  it('PUT /semester 开始日期变化时重建 occurrence 且周历更新', async () => {
    const semester = await getSemester();
    const slots = await getSlots();
    const user = await createUser('阿哲');
    await app.inject({
      method: 'POST',
      url: API + '/schedules',
      payload: { userId: user.id, weekday: 2, slotId: slots[1].id, startWeek: 1, endWeek: 2, parity: 'all' },
    });
    expect(occurrenceWeeks(semester.id)).toEqual([1, 2]);

    const res = await app.inject({
      method: 'PUT',
      url: API + '/semester',
      payload: { startDate: '2026-09-07' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.weeks[0].startDate).toBe('2026-09-07');
    expect(occurrenceWeeks(semester.id)).toEqual([1, 2]);
  });

  it('POST /semester 新建学期并置为启用', async () => {
    const before = await getSemester();
    const res = await app.inject({
      method: 'POST',
      url: API + '/semester',
      payload: { name: '2026 秋季学期', startDate: '2026-09-07', totalWeeks: 18, week1Parity: 'even' },
    });
    expect(res.statusCode).toBe(201);
    const created = res.json().data.semester;
    expect(created.isActive).toBe(true);
    expect(created.activeTemplateId).toBe(before.activeTemplateId);
    expect(res.json().data.weeks).toHaveLength(18);

    const current = await getSemester();
    expect(current.id).toBe(created.id);
    expect(current.id).not.toBe(before.id);

    const db = getDb();
    const activeCount = db.prepare('SELECT COUNT(*) AS n FROM semester WHERE is_active = 1').get() as { n: number };
    expect(Number(activeCount.n)).toBe(1);
  });

  it('POST /semester 可指定启用模板', async () => {
    const templates = await app.inject({ method: 'GET', url: API + '/templates' });
    const preset = templates.json().data.templates.find((item: any) => item.name === '大学小节');
    const res = await app.inject({
      method: 'POST',
      url: API + '/semester',
      payload: {
        name: '2027 春季学期',
        startDate: '2027-02-22',
        totalWeeks: 16,
        week1Parity: 'odd',
        activeTemplateId: preset.id,
      },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().data.semester.activeTemplateId).toBe(preset.id);
  });

  it('PUT /semester 非法输入返回 422 中文错误', async () => {
    const res = await app.inject({ method: 'PUT', url: API + '/semester', payload: { totalWeeks: 0 } });
    expect(res.statusCode).toBe(422);
    const body = res.json();
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.details[0].message).toContain('1-60');
  });

  it('POST /semester 缺少字段返回 422', async () => {
    const res = await app.inject({ method: 'POST', url: API + '/semester', payload: { name: '不完整学期' } });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
  });
});
