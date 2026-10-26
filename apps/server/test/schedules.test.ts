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

async function createSchedule(payload: Record<string, unknown>): Promise<any> {
  return app.inject({ method: 'POST', url: API + '/schedules', payload });
}

function occurrenceWeeks(semesterId: number, userId: number): number[] {
  const rows = getDb()
    .prepare(
      'SELECT week_no FROM schedule_occurrence WHERE semester_id = ? AND user_id = ? ORDER BY week_no ASC',
    )
    .all(semesterId, userId) as { week_no: number }[];
  return rows.map((row) => Number(row.week_no));
}

function scheduleCount(): number {
  const row = getDb().prepare('SELECT COUNT(*) AS n FROM schedule').get() as { n: number };
  return Number(row.n);
}

describe('schedule routes', () => {
  it('POST /schedules 创建安排并展开单周 occurrence', async () => {
    const semester = await getSemester();
    const slots = await getSlots();
    const user = await createUser('小林');
    const res = await createSchedule({
      userId: user.id,
      weekday: 1,
      slotId: slots[0].id,
      startWeek: 1,
      endWeek: 4,
      parity: 'odd',
      note: '高等数学',
    });
    expect(res.statusCode).toBe(201);
    const schedule = res.json().data.schedule;
    expect(schedule.userId).toBe(user.id);
    expect(schedule.semesterId).toBe(semester.id);
    expect(schedule.weekday).toBe(1);
    expect(schedule.parity).toBe('odd');
    expect(schedule.note).toBe('高等数学');
    expect(occurrenceWeeks(semester.id, user.id)).toEqual([1, 3]);
  });

  it('POST /schedules 双周安排只展开双周', async () => {
    const semester = await getSemester();
    const slots = await getSlots();
    const user = await createUser('阿哲');
    const res = await createSchedule({
      userId: user.id,
      weekday: 2,
      slotId: slots[1].id,
      startWeek: 1,
      endWeek: 4,
      parity: 'even',
    });
    expect(res.statusCode).toBe(201);
    expect(occurrenceWeeks(semester.id, user.id)).toEqual([2, 4]);
  });

  it('第 1 周为双周时单双周展开对应偏移', async () => {
    const semester = await getSemester();
    await app.inject({ method: 'PUT', url: API + '/semester', payload: { week1Parity: 'even' } });
    const slots = await getSlots();
    const user = await createUser('雨晨');
    const res = await createSchedule({
      userId: user.id,
      weekday: 3,
      slotId: slots[0].id,
      startWeek: 1,
      endWeek: 4,
      parity: 'even',
    });
    expect(res.statusCode).toBe(201);
    expect(occurrenceWeeks(semester.id, user.id)).toEqual([1, 3]);
  });

  it('POST /schedules 同用户同周同格冲突返回 409 ConflictDetail[]', async () => {
    const semester = await getSemester();
    const slots = await getSlots();
    const user = await createUser('思远');
    const first = await createSchedule({
      userId: user.id,
      weekday: 1,
      slotId: slots[0].id,
      startWeek: 1,
      endWeek: 4,
      parity: 'odd',
      note: '泛函分析',
    });
    expect(first.statusCode).toBe(201);
    const firstId = first.json().data.schedule.id;

    const conflict = await createSchedule({
      userId: user.id,
      weekday: 1,
      slotId: slots[0].id,
      startWeek: 3,
      endWeek: 4,
      parity: 'odd',
      note: '重复',
    });
    expect(conflict.statusCode).toBe(409);
    const body = conflict.json();
    expect(body.error.code).toBe('SCHEDULE_CONFLICT');
    expect(Array.isArray(body.error.details)).toBe(true);
    expect(body.error.details).toHaveLength(1);
    const detail = body.error.details[0];
    expect(detail.weekNo).toBe(3);
    expect(detail.weekday).toBe(1);
    expect(detail.slotId).toBe(slots[0].id);
    expect(detail.slotLabel).toBe(slots[0].label);
    expect(detail.scheduleId).toBe(firstId);
    expect(detail.startWeek).toBe(1);
    expect(detail.endWeek).toBe(4);
    expect(detail.parity).toBe('odd');
    expect(detail.note).toBe('泛函分析');
    expect(scheduleCount()).toBe(1);
  });

  it('不同格子/不同用户不冲突', async () => {
    const semester = await getSemester();
    const slots = await getSlots();
    const alice = await createUser('甲');
    const bob = await createUser('乙');
    const base = {
      weekday: 1,
      startWeek: 1,
      endWeek: 4,
      parity: 'all',
    };
    const first = await createSchedule({ userId: alice.id, slotId: slots[0].id, ...base });
    expect(first.statusCode).toBe(201);
    const otherSlot = await createSchedule({ userId: alice.id, slotId: slots[1].id, ...base });
    expect(otherSlot.statusCode).toBe(201);
    const otherWeekday = await createSchedule({ userId: alice.id, slotId: slots[0].id, ...base, weekday: 2 });
    expect(otherWeekday.statusCode).toBe(201);
    const otherUser = await createSchedule({ userId: bob.id, slotId: slots[0].id, ...base });
    expect(otherUser.statusCode).toBe(201);
    expect(occurrenceWeeks(semester.id, alice.id)).toHaveLength(12);
  });

  it('POST /schedules 校验用户与时间段存在', async () => {
    const slots = await getSlots();
    const missingUser = await createSchedule({ userId: 9999, weekday: 1, slotId: slots[0].id, startWeek: 1, endWeek: 2 });
    expect(missingUser.statusCode).toBe(404);

    const user = await createUser('校验');
    const missingSlot = await createSchedule({ userId: user.id, weekday: 1, slotId: 9999, startWeek: 1, endWeek: 2 });
    expect(missingSlot.statusCode).toBe(404);

    const invalid = await createSchedule({ userId: user.id, weekday: 9, slotId: slots[0].id, startWeek: 1, endWeek: 2 });
    expect(invalid.statusCode).toBe(422);
  });

  it('PATCH /schedules/:id 修改区间后重建 occurrence', async () => {
    const semester = await getSemester();
    const slots = await getSlots();
    const user = await createUser('乐天');
    const created = await createSchedule({
      userId: user.id,
      weekday: 1,
      slotId: slots[0].id,
      startWeek: 1,
      endWeek: 4,
      parity: 'odd',
    });
    const id = created.json().data.schedule.id;
    expect(occurrenceWeeks(semester.id, user.id)).toEqual([1, 3]);

    const res = await app.inject({
      method: 'PATCH',
      url: API + '/schedules/' + id,
      payload: { endWeek: 8, parity: 'even', note: '改到双周' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.schedule.note).toBe('改到双周');
    expect(occurrenceWeeks(semester.id, user.id)).toEqual([2, 4, 6, 8]);
  });

  it('PATCH /schedules/:id 冲突时返回 409 且不落库', async () => {
    const semester = await getSemester();
    const slots = await getSlots();
    const user = await createUser('思远');
    const first = await createSchedule({
      userId: user.id,
      weekday: 1,
      slotId: slots[0].id,
      startWeek: 1,
      endWeek: 4,
      parity: 'all',
    });
    const second = await createSchedule({
      userId: user.id,
      weekday: 1,
      slotId: slots[1].id,
      startWeek: 1,
      endWeek: 4,
      parity: 'all',
    });
    const secondId = second.json().data.schedule.id;
    expect(first.statusCode).toBe(201);

    const res = await app.inject({
      method: 'PATCH',
      url: API + '/schedules/' + secondId,
      payload: { slotId: slots[0].id },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('SCHEDULE_CONFLICT');
    expect(res.json().error.details.length).toBe(4);

    const detail = await app.inject({ method: 'GET', url: API + '/schedules/' + secondId });
    expect(detail.json().data.schedule.slotId).toBe(slots[1].id);
    expect(occurrenceWeeks(semester.id, user.id)).toHaveLength(8);
  });

  it('GET /schedules 支持 user_id/from_week/to_week/weekday 过滤', async () => {
    const slots = await getSlots();
    const alice = await createUser('甲');
    const bob = await createUser('乙');
    await createSchedule({ userId: alice.id, weekday: 1, slotId: slots[0].id, startWeek: 1, endWeek: 4, parity: 'all' });
    await createSchedule({ userId: alice.id, weekday: 3, slotId: slots[1].id, startWeek: 5, endWeek: 8, parity: 'all' });
    await createSchedule({ userId: bob.id, weekday: 1, slotId: slots[0].id, startWeek: 1, endWeek: 2, parity: 'all' });

    const all = await app.inject({ method: 'GET', url: API + '/schedules' });
    expect(all.json().data.schedules).toHaveLength(3);

    const byUser = await app.inject({ method: 'GET', url: API + '/schedules?user_id=' + alice.id });
    expect(byUser.json().data.schedules).toHaveLength(2);

    const byWeekday = await app.inject({ method: 'GET', url: API + '/schedules?weekday=1' });
    expect(byWeekday.json().data.schedules).toHaveLength(2);

    const fromWeek = await app.inject({ method: 'GET', url: API + '/schedules?from_week=5' });
    expect(fromWeek.json().data.schedules).toHaveLength(1);

    const toWeek = await app.inject({ method: 'GET', url: API + '/schedules?to_week=2' });
    expect(toWeek.json().data.schedules).toHaveLength(2);
  });

  it('POST /schedules/check 只返回冲突不写库', async () => {
    const semester = await getSemester();
    const slots = await getSlots();
    const user = await createUser('预检');
    await createSchedule({ userId: user.id, weekday: 1, slotId: slots[0].id, startWeek: 1, endWeek: 4, parity: 'odd' });
    expect(occurrenceWeeks(semester.id, user.id)).toEqual([1, 3]);

    const res = await app.inject({
      method: 'POST',
      url: API + '/schedules/check',
      payload: {
        userId: user.id,
        weekday: 1,
        slotIds: [slots[0].id],
        startWeek: 1,
        endWeek: 4,
        parity: 'odd',
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.conflicts).toHaveLength(2);
    expect(scheduleCount()).toBe(1);

    const exclude = await app.inject({
      method: 'POST',
      url: API + '/schedules/check',
      payload: {
        userId: user.id,
        weekday: 1,
        slotIds: [slots[0].id],
        startWeek: 1,
        endWeek: 4,
        parity: 'odd',
        excludeScheduleId: res.json().data.conflicts[0].scheduleId,
      },
    });
    expect(exclude.json().data.conflicts).toHaveLength(0);
  });

  it('DELETE /schedules/:id 删除安排并级联占用点', async () => {
    const semester = await getSemester();
    const slots = await getSlots();
    const user = await createUser('删除');
    const created = await createSchedule({
      userId: user.id,
      weekday: 1,
      slotId: slots[0].id,
      startWeek: 1,
      endWeek: 4,
      parity: 'all',
    });
    const id = created.json().data.schedule.id;
    expect(occurrenceWeeks(semester.id, user.id)).toHaveLength(4);

    const res = await app.inject({ method: 'DELETE', url: API + '/schedules/' + id });
    expect(res.statusCode).toBe(204);
    expect(occurrenceWeeks(semester.id, user.id)).toHaveLength(0);

    const again = await app.inject({ method: 'GET', url: API + '/schedules/' + id });
    expect(again.statusCode).toBe(404);
  });

  it('POST /schedules/batch strict 存在冲突时整体 409 不落库', async () => {
    const semester = await getSemester();
    const slots = await getSlots();
    const user = await createUser('批量严格');
    await createSchedule({ userId: user.id, weekday: 1, slotId: slots[0].id, startWeek: 1, endWeek: 4, parity: 'odd' });
    expect(scheduleCount()).toBe(1);

    const res = await app.inject({
      method: 'POST',
      url: API + '/schedules/batch',
      payload: {
        userId: user.id,
        cells: [{ weekday: 1, slotIds: [slots[0].id, slots[1].id] }],
        weeks: { start: 1, end: 4, parity: 'odd' },
        mode: 'strict',
      },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('SCHEDULE_CONFLICT');
    expect(res.json().error.details.length).toBeGreaterThan(0);
    expect(scheduleCount()).toBe(1);
    expect(occurrenceWeeks(semester.id, user.id)).toEqual([1, 3]);
  });

  it('POST /schedules/batch skip 跳过冲突格并返回明细', async () => {
    const semester = await getSemester();
    const slots = await getSlots();
    const user = await createUser('批量跳过');
    await createSchedule({ userId: user.id, weekday: 1, slotId: slots[0].id, startWeek: 1, endWeek: 4, parity: 'odd' });

    const res = await app.inject({
      method: 'POST',
      url: API + '/schedules/batch',
      payload: {
        userId: user.id,
        cells: [{ weekday: 1, slotIds: [slots[0].id, slots[1].id] }],
        weeks: { start: 1, end: 4, parity: 'odd' },
        mode: 'skip',
      },
    });
    expect(res.statusCode).toBe(201);
    const data = res.json().data;
    expect(data.created).toBe(1);
    expect(data.skipped).toBe(1);
    expect(data.conflicts).toHaveLength(2);
    expect(data.schedules).toHaveLength(1);
    expect(data.schedules[0].slotId).toBe(slots[1].id);
    expect(scheduleCount()).toBe(2);
    expect(occurrenceWeeks(semester.id, user.id)).toHaveLength(4);
  });

  it('POST /schedules/batch 对重复格子去重', async () => {
    const slots = await getSlots();
    const user = await createUser('批量去重');
    const res = await app.inject({
      method: 'POST',
      url: API + '/schedules/batch',
      payload: {
        userId: user.id,
        cells: [
          { weekday: 2, slotIds: [slots[0].id, slots[0].id] },
          { weekday: 2, slotIds: [slots[0].id] },
        ],
        weeks: { start: 1, end: 2, parity: 'all' },
      },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().data.created).toBe(1);
    expect(scheduleCount()).toBe(1);
  });

  it('POST /schedules/batch 无冲突时批量创建多个格子', async () => {
    const semester = await getSemester();
    const slots = await getSlots();
    const user = await createUser('批量成功');
    const res = await app.inject({
      method: 'POST',
      url: API + '/schedules/batch',
      payload: {
        userId: user.id,
        cells: [{ weekday: 2, slotIds: [slots[0].id, slots[1].id] }],
        weeks: { start: 1, end: 2, parity: 'all' },
        mode: 'strict',
      },
    });
    expect(res.statusCode).toBe(201);
    const data = res.json().data;
    expect(data.created).toBe(2);
    expect(data.skipped).toBe(0);
    expect(data.conflicts).toHaveLength(0);
    expect(occurrenceWeeks(semester.id, user.id)).toHaveLength(4);
  });

  it('POST /schedules/batch 非法周区间返回 422', async () => {
    const slots = await getSlots();
    const user = await createUser('批量非法');
    const res = await app.inject({
      method: 'POST',
      url: API + '/schedules/batch',
      payload: {
        userId: user.id,
        cells: [{ weekday: 1, slotIds: [slots[0].id] }],
        weeks: { start: 5, end: 3, parity: 'all' },
      },
    });
    expect(res.statusCode).toBe(422);
    expect(scheduleCount()).toBe(0);
  });
});
