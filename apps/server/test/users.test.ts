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

async function createUser(name: string, payload: Record<string, unknown> = {}): Promise<any> {
  const res = await app.inject({ method: 'POST', url: API + '/users', payload: { name, ...payload } });
  expect(res.statusCode).toBe(201);
  return res.json().data.user;
}

async function listUsers(includeInactive = false): Promise<any[]> {
  const url = API + '/users' + (includeInactive ? '?include_inactive=1' : '');
  const res = await app.inject({ method: 'GET', url });
  expect(res.statusCode).toBe(200);
  return res.json().data.users;
}

async function getActiveSemester(): Promise<any> {
  const res = await app.inject({ method: 'GET', url: API + '/semester' });
  return res.json().data.semester;
}

async function getSlots(): Promise<any[]> {
  const semester = await getActiveSemester();
  const res = await app.inject({ method: 'GET', url: API + '/templates/' + semester.activeTemplateId });
  return res.json().data.slots;
}

describe('user routes', () => {
  it('GET /users 默认只返回启用用户且按 sortOrder 排序', async () => {
    const a = await createUser('小林');
    const b = await createUser('阿哲');
    const users = await listUsers();
    expect(users.map((user) => user.id)).toEqual([a.id, b.id]);
    expect(users[0].color).toBe('#4F46E5');
    expect(users[1].color).toBe('#0EA5E9');
    expect(typeof users[0].sortOrder).toBe('number');
  });

  it('POST /users 支持自定义颜色与备注', async () => {
    const user = await createUser('雨晨', { color: '#123456', note: '设计 2023' });
    expect(user.color).toBe('#123456');
    expect(user.note).toBe('设计 2023');
    expect(user.isActive).toBe(true);
  });

  it('POST /users 重名返回 409 USER_EXISTS', async () => {
    await createUser('思远');
    const res = await app.inject({ method: 'POST', url: API + '/users', payload: { name: '思远' } });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('USER_EXISTS');
  });

  it('POST /users 空名字返回 422', async () => {
    const res = await app.inject({ method: 'POST', url: API + '/users', payload: { name: '   ' } });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('GET /users/:id 不存在返回 404', async () => {
    const res = await app.inject({ method: 'GET', url: API + '/users/9999' });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('NOT_FOUND');
  });

  it('PATCH /users/:id 修改字段与软停用', async () => {
    const user = await createUser('乐天');
    const patched = await app.inject({
      method: 'PATCH',
      url: API + '/users/' + user.id,
      payload: { name: '乐天乐', note: '经管 2024', color: '#ABCDEF' },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().data.user.name).toBe('乐天乐');
    expect(patched.json().data.user.color).toBe('#ABCDEF');

    const deactivated = await app.inject({
      method: 'PATCH',
      url: API + '/users/' + user.id,
      payload: { isActive: false },
    });
    expect(deactivated.statusCode).toBe(200);
    expect(deactivated.json().data.user.isActive).toBe(false);

    const activeUsers = await listUsers(false);
    expect(activeUsers.some((item) => item.id === user.id)).toBe(false);
    const allUsers = await listUsers(true);
    expect(allUsers.some((item) => item.id === user.id)).toBe(true);
  });

  it('PATCH /users/:id 改名重名返回 409', async () => {
    await createUser('甲');
    const b = await createUser('乙');
    const res = await app.inject({ method: 'PATCH', url: API + '/users/' + b.id, payload: { name: '甲' } });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('USER_EXISTS');
  });

  it('DELETE /users/:id 默认软删除并保留安排', async () => {
    const user = await createUser('软删除');
    const slots = await getSlots();
    const semester = await getActiveSemester();
    const created = await app.inject({
      method: 'POST',
      url: API + '/schedules',
      payload: { userId: user.id, weekday: 1, slotId: slots[0].id, startWeek: 1, endWeek: 2, parity: 'all' },
    });
    expect(created.statusCode).toBe(201);

    const res = await app.inject({ method: 'DELETE', url: API + '/users/' + user.id });
    expect(res.statusCode).toBe(204);
    expect(res.body).toBe('');

    expect((await listUsers(false)).some((item) => item.id === user.id)).toBe(false);
    const all = await listUsers(true);
    const soft = all.find((item) => item.id === user.id);
    expect(soft.isActive).toBe(false);

    const schedules = await app.inject({ method: 'GET', url: API + '/schedules?user_id=' + user.id });
    expect(schedules.json().data.schedules).toHaveLength(1);

    const db = getDb();
    const occurrences = db
      .prepare('SELECT COUNT(*) AS n FROM schedule_occurrence WHERE semester_id = ? AND user_id = ?')
      .get(semester.id, user.id) as { n: number };
    expect(Number(occurrences.n)).toBe(2);
  });

  it('DELETE /users/:id?hard=1 硬删除并级联安排与占用点', async () => {
    const user = await createUser('硬删除');
    const slots = await getSlots();
    const semester = await getActiveSemester();
    await app.inject({
      method: 'POST',
      url: API + '/schedules',
      payload: { userId: user.id, weekday: 3, slotId: slots[2].id, startWeek: 1, endWeek: 4, parity: 'odd' },
    });

    const res = await app.inject({ method: 'DELETE', url: API + '/users/' + user.id + '?hard=1' });
    expect(res.statusCode).toBe(204);
    expect((await listUsers(true)).some((item) => item.id === user.id)).toBe(false);

    const db = getDb();
    const schedules = db.prepare('SELECT COUNT(*) AS n FROM schedule WHERE user_id = ?').get(user.id) as { n: number };
    expect(Number(schedules.n)).toBe(0);
    const occurrences = db
      .prepare('SELECT COUNT(*) AS n FROM schedule_occurrence WHERE semester_id = ? AND user_id = ?')
      .get(semester.id, user.id) as { n: number };
    expect(Number(occurrences.n)).toBe(0);
  });

  it('PUT /users/order 按 ids 重排 sortOrder', async () => {
    const a = await createUser('甲');
    const b = await createUser('乙');
    const c = await createUser('丙');
    const res = await app.inject({ method: 'PUT', url: API + '/users/order', payload: { ids: [c.id, a.id, b.id] } });
    expect(res.statusCode).toBe(200);
    const ordered = res.json().data.users;
    expect(ordered.map((user: any) => user.id).slice(0, 3)).toEqual([c.id, a.id, b.id]);
    expect(ordered[0].sortOrder).toBe(1);

    const users = await listUsers();
    expect(users.map((user) => user.id)).toEqual([c.id, a.id, b.id]);
  });

  it('PUT /users/order 重复或不存在 ID 返回 404/422', async () => {
    const a = await createUser('甲');
    const dup = await app.inject({ method: 'PUT', url: API + '/users/order', payload: { ids: [a.id, a.id] } });
    expect(dup.statusCode).toBe(422);

    const missing = await app.inject({ method: 'PUT', url: API + '/users/order', payload: { ids: [9999] } });
    expect(missing.statusCode).toBe(404);
  });
});
