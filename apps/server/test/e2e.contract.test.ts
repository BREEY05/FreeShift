import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.ts';

/**
 * 端到端契约冒烟测试：只通过 HTTP 接口走完主流程，校验前后端契约。
 * 由 Lead 维护，覆盖：学期、用户、安排、冲突、聚合、个人视图、推荐、公平性、CSV。
 */
let app: FastifyInstance;

beforeAll(async () => {
  app = buildApp();
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

async function call(
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  url: string,
  payload?: unknown,
  contentType?: string,
) {
  const response = await app.inject({
    method,
    url,
    ...(payload === undefined
      ? {}
      : { payload: payload as object, ...(contentType ? { headers: { 'content-type': contentType } } : {}) }),
  });
  let body: any = null;
  try {
    body = response.body ? JSON.parse(response.body) : null;
  } catch {
    body = response.body;
  }
  return { status: response.statusCode, body, headers: response.headers };
}

describe('FreeShift 端到端契约', () => {
  it('健康检查与学期周历', async () => {
    const health = await call('GET', '/healthz');
    expect(health.status).toBe(200);
    expect(health.body.status).toBe('ok');

    const semester = await call('GET', '/api/v1/semester');
    expect(semester.status).toBe(200);
    expect(semester.body.data.semester.totalWeeks).toBe(20);
    expect(semester.body.data.weeks).toHaveLength(20);
    expect(semester.body.data.weeks[0].weekNo).toBe(1);
    expect(['odd', 'even']).toContain(semester.body.data.weeks[0].parity);
  });

  it('创建用户并录入安排，冲突时 409', async () => {
    const created = [] as number[];
    for (const name of ['测试甲', '测试乙', '测试丙']) {
      const res = await call('POST', '/api/v1/users', { name, note: 'e2e' });
      expect(res.status).toBe(201);
      created.push(res.body.data.user.id);
    }
    const list = await call('GET', '/api/v1/users');
    expect(list.body.data.users.length).toBeGreaterThanOrEqual(3);

    const schedule = await call('POST', '/api/v1/schedules', {
      userId: created[0],
      weekday: 1,
      slotId: 1,
      startWeek: 1,
      endWeek: 16,
      parity: 'all',
      note: '端到端测试',
    });
    expect(schedule.status).toBe(201);

    const conflict = await call('POST', '/api/v1/schedules', {
      userId: created[0],
      weekday: 1,
      slotId: 1,
      startWeek: 8,
      endWeek: 8,
      parity: 'all',
    });
    expect(conflict.status).toBe(409);
    expect(Array.isArray(conflict.body.error.details)).toBe(true);
    expect(conflict.body.error.code).toBe('SCHEDULE_CONFLICT');

    const batch = await call('POST', '/api/v1/schedules/batch', {
      userId: created[1],
      cells: [{ weekday: 1, slotIds: [1, 2] }],
      weeks: { start: 1, end: 8, parity: 'all' },
      mode: 'strict',
    });
    expect(batch.status).toBe(201);
    expect(batch.body.data.created).toBe(2);
  });

  it('聚合看板人数与名单一致', async () => {
    const users = (await call('GET', '/api/v1/users')).body.data.users;
    const board = await call('GET', '/api/v1/board/aggregate?week=1');
    expect(board.status).toBe(200);
    const data = board.body.data;
    expect(data.cells.length).toBe(7 * data.slots.length);
    const usersById = new Map(users.map((user: any) => [user.id, user]));
    const mondayFirst = data.cells.find((cell: any) => cell.weekday === 1 && cell.slotId === 1);
    expect(mondayFirst).toBeTruthy();
    expect(mondayFirst.occupiedUserIds.length + mondayFirst.freeUserIds.length).toBe(mondayFirst.totalUsers);
    for (const userId of mondayFirst.freeUserIds) expect(usersById.has(userId)).toBe(true);

    const cell = await call('GET', '/api/v1/board/cell?week=1&weekday=1&slot_id=1');
    expect(cell.status).toBe(200);
    expect(cell.body.data.occupiedUsers.length).toBe(mondayFirst.occupiedUserIds.length);
    expect(cell.body.data.freeUsers.length).toBe(mondayFirst.freeCount);
  });

  it('个人视图能定位到可编辑的安排', async () => {
    const users = (await call('GET', '/api/v1/users')).body.data.users;
    const target = users.find((user: any) => user.name === '测试甲');
    const personal = await call('GET', '/api/v1/board/user/' + target.id + '?week=3');
    expect(personal.status).toBe(200);
    const cell = personal.body.data.cells.find((item: any) => item.weekday === 1 && item.slotId === 1);
    expect(cell.scheduleId).toBeTruthy();
    expect(cell.note).toBe('端到端测试');
  });

  it('推荐接口返回可用结果', async () => {
    const users = (await call('GET', '/api/v1/users')).body.data.users.slice(0, 2);
    const common = await call('POST', '/api/v1/recommend/common-free', {
      week: 1,
      userIds: users.map((user: any) => user.id),
    });
    expect(common.status).toBe(200);
    for (const block of common.body.data.blocks) {
      expect(block.length).toBeGreaterThanOrEqual(1);
      expect(block.slotIds.length).toBe(block.length);
    }

    const scored = await call('POST', '/api/v1/recommend/scored', { week: 2, topK: 5 });
    expect(scored.status).toBe(200);
    const cells = scored.body.data.cells;
    expect(cells.length).toBeGreaterThan(0);
    for (let index = 1; index < cells.length; index += 1) {
      expect(cells[index - 1].score).toBeGreaterThanOrEqual(cells[index].score);
    }

    const alternatives = await call('POST', '/api/v1/recommend/alternatives', {
      userId: users[0].id,
      weekday: 1,
      slotId: 1,
      startWeek: 1,
      endWeek: 8,
      parity: 'all',
    });
    expect(alternatives.status).toBe(200);
    expect(Array.isArray(alternatives.body.data.cells)).toBe(true);
  });

  it('公平性统计与 CSV 导出导入', async () => {
    const fairness = await call('GET', '/api/v1/stats/fairness?from_week=1&to_week=8');
    expect(fairness.status).toBe(200);
    expect(fairness.body.data.users.length).toBeGreaterThanOrEqual(3);
    expect(typeof fairness.body.data.gini).toBe('number');

    const exported = await call('GET', '/api/v1/export/schedules');
    expect(exported.status).toBe(200);
    expect(String(exported.headers['content-type'])).toContain('text/csv');
    expect(String(exported.body)).toContain('user,weekday,slot_label');

    const dryRun = await call(
      'POST',
      '/api/v1/import/schedules?dry_run=1',
      'user,weekday,slot_label,start_week,end_week,parity,note\n不存在的人,1,第1-2节,1,4,all,导入测试\n',
      'text/csv',
    );
    expect(dryRun.status).toBe(200);
    expect(dryRun.body.data.created).toBe(0);
    expect(dryRun.body.data.errors.length).toBe(1);
  });
});