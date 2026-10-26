import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AggregateBoard, AppUser, CellDetail, PersonalBoard, Schedule } from '@freeshift/shared';
import { buildApp } from '../src/app.ts';
import { closeDb } from '../src/db/index.ts';
import type { AlgoFixture } from './helpers/algoFixtures.ts';
import {
  addSchedule,
  api,
  setupAlgoFixture,
  slotByLabel,
} from './helpers/algoFixtures.ts';

let app: ReturnType<typeof buildApp>;
let fixture: AlgoFixture;

function user(name: string): AppUser {
  const found = fixture.users.find((item) => item.name === name);
  if (!found) throw new Error('测试用户不存在：' + name);
  return found;
}

function cellOf(board: AggregateBoard, weekday: number, slotId: number) {
  const cell = board.cells.find((item) => item.weekday === weekday && item.slotId === slotId);
  if (!cell) throw new Error('格子不存在：' + weekday + '/' + slotId);
  return cell;
}

function personalCellOf(board: PersonalBoard, weekday: number, slotId: number) {
  const cell = board.cells.find((item) => item.weekday === weekday && item.slotId === slotId);
  if (!cell) throw new Error('个人格子不存在：' + weekday + '/' + slotId);
  return cell;
}

beforeAll(() => {
  app = buildApp();
});

afterAll(async () => {
  await app.close();
  closeDb();
});

beforeEach(() => {
  fixture = setupAlgoFixture(['小林', '阿哲', '雨晨', '思远']);
});

describe('GET /board/aggregate', () => {
  it('人数与名单同源，且单双周正确', async () => {
    const lin = user('小林');
    const zhe = user('阿哲');
    const yu = user('雨晨');
    const si = user('思远');
    const slot1 = slotByLabel(fixture, '时段1');

    addSchedule({ userId: lin.id, weekday: 1, slotId: slot1.id, startWeek: 1, endWeek: 20, parity: 'all', note: '高数' });
    addSchedule({ userId: zhe.id, weekday: 1, slotId: slot1.id, startWeek: 1, endWeek: 20, parity: 'even' });
    addSchedule({ userId: si.id, weekday: 1, slotId: slot1.id, startWeek: 3, endWeek: 4 });

    const week1 = await api<AggregateBoard>(app, 'GET', '/api/v1/board/aggregate?week=1');
    expect(week1.status).toBe(200);
    const board = week1.data;
    expect(board.week.weekNo).toBe(1);
    expect(board.week.parity).toBe('odd');
    expect(board.slots).toHaveLength(7);
    expect(board.slots.map((slot) => slot.sortOrder)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(board.users.map((item) => item.name)).toEqual(['小林', '阿哲', '雨晨', '思远']);
    expect(board.cells).toHaveLength(7 * 7);

    const week1Cell = cellOf(board, 1, slot1.id);
    expect(week1Cell.totalUsers).toBe(4);
    expect(week1Cell.freeCount).toBe(3);
    expect(week1Cell.occupiedUserIds).toEqual([lin.id]);
    expect([...week1Cell.freeUserIds].sort((a, b) => a - b)).toEqual([zhe.id, yu.id, si.id].sort((a, b) => a - b));

    // 第 2 周为双周：小林（每周）+ 阿哲（双周）占用
    const week2 = await api<AggregateBoard>(app, 'GET', '/api/v1/board/aggregate?week=2');
    const week2Cell = cellOf(week2.data, 1, slot1.id);
    expect(week2.data.week.parity).toBe('even');
    expect(week2Cell.freeCount).toBe(2);
    expect(week2Cell.occupiedUserIds).toEqual([lin.id, zhe.id]);
    expect([...week2Cell.freeUserIds].sort((a, b) => a - b)).toEqual([yu.id, si.id].sort((a, b) => a - b));

    // 第 3 周为单周：小林 + 思远（第 3-4 周）
    const week3 = await api<AggregateBoard>(app, 'GET', '/api/v1/board/aggregate?week=3');
    const week3Cell = cellOf(week3.data, 1, slot1.id);
    expect(week3Cell.occupiedUserIds).toEqual([lin.id, si.id]);
    expect(week3Cell.freeCount).toBe(2);

    // 网格中每格 freeCount + occupied 数一致，名单与人数一致
    for (const cell of board.cells) {
      expect(cell.freeUserIds).toHaveLength(cell.freeCount);
      expect(cell.freeCount + cell.occupiedUserIds.length).toBe(cell.totalUsers);
    }
  });

  it('user_ids 子集、day_parts 与 filter 裁剪', async () => {
    const lin = user('小林');
    const zhe = user('阿哲');
    const yu = user('雨晨');
    const si = user('思远');
    const slot1 = slotByLabel(fixture, '时段1');
    addSchedule({ userId: lin.id, weekday: 1, slotId: slot1.id, startWeek: 1, endWeek: 20, parity: 'all' });
    addSchedule({ userId: zhe.id, weekday: 1, slotId: slot1.id, startWeek: 1, endWeek: 20, parity: 'even' });
    addSchedule({ userId: si.id, weekday: 1, slotId: slot1.id, startWeek: 3, endWeek: 4 });

    const subset = await api<AggregateBoard>(app, 'GET', '/api/v1/board/aggregate?week=1&user_ids=' + zhe.id + ',' + yu.id);
    expect(subset.data.users.map((item) => item.name)).toEqual(['阿哲', '雨晨']);
    const subsetCell = cellOf(subset.data, 1, slot1.id);
    expect(subsetCell.totalUsers).toBe(2);
    expect(subsetCell.freeCount).toBe(2);

    const subsetEven = await api<AggregateBoard>(app, 'GET', '/api/v1/board/aggregate?week=2&user_ids=' + zhe.id + ',' + yu.id);
    const subsetEvenCell = cellOf(subsetEven.data, 1, slot1.id);
    expect(subsetEvenCell.totalUsers).toBe(2);
    expect(subsetEvenCell.freeCount).toBe(1);
    expect(subsetEvenCell.freeUserIds).toEqual([yu.id]);

    const morning = await api<AggregateBoard>(app, 'GET', '/api/v1/board/aggregate?week=1&day_parts=morning');
    expect(morning.data.slots).toHaveLength(3);
    expect(morning.data.cells).toHaveLength(7 * 3);
    expect(morning.data.slots.every((slot) => slot.dayPart === 'morning')).toBe(true);

    const partial = await api<AggregateBoard>(
      app,
      'GET',
      '/api/v1/board/aggregate?week=1&user_ids=' + lin.id + ',' + zhe.id + '&filter=partial',
    );
    expect(partial.data.cells).toHaveLength(1);
    expect(partial.data.cells[0].weekday).toBe(1);
    expect(partial.data.cells[0].slotId).toBe(slot1.id);

    const fullFree = await api<AggregateBoard>(
      app,
      'GET',
      '/api/v1/board/aggregate?week=1&user_ids=' + zhe.id + ',' + yu.id + '&filter=full_free',
    );
    expect(fullFree.data.cells).toHaveLength(7 * 7);

    // 双周被两人同时占用时 freeCount=0，不属于 partial
    const fullyOccupied = await api<AggregateBoard>(
      app,
      'GET',
      '/api/v1/board/aggregate?week=2&user_ids=' + lin.id + ',' + zhe.id + '&filter=partial',
    );
    expect(fullyOccupied.data.cells.some((cell) => cell.freeCount === 0)).toBe(false);
  });
});

describe('GET /board/cell', () => {
  it('返回格子空闲与占用用户', async () => {
    const lin = user('小林');
    const slot1 = slotByLabel(fixture, '时段1');
    addSchedule({ userId: lin.id, weekday: 3, slotId: slot1.id, startWeek: 1, endWeek: 20 });

    const response = await api<CellDetail>(app, 'GET', '/api/v1/board/cell?week=1&weekday=3&slot_id=' + slot1.id);
    expect(response.status).toBe(200);
    expect(response.data.week.weekNo).toBe(1);
    expect(response.data.weekday).toBe(3);
    expect(response.data.slot.id).toBe(slot1.id);
    expect(response.data.occupiedUsers.map((item) => item.name)).toEqual(['小林']);
    expect(response.data.freeUsers.map((item) => item.name)).toEqual(['阿哲', '雨晨', '思远']);
  });

  it('校验 slot 属于当前模板与 weekday 合法', async () => {
    const slot1 = slotByLabel(fixture, '时段1');
    const badSlot = await api(app, 'GET', '/api/v1/board/cell?week=1&weekday=1&slot_id=999999');
    expect(badSlot.status).toBe(422);
    const badWeekday = await api(app, 'GET', '/api/v1/board/cell?week=1&weekday=8&slot_id=' + slot1.id);
    expect(badWeekday.status).toBe(422);
    const missingWeekday = await api(app, 'GET', '/api/v1/board/cell?week=1&slot_id=' + slot1.id);
    expect(missingWeekday.status).toBe(422);
  });
});

describe('GET /board/user/:id', () => {
  it('个人视图按周命中 scheduleId 并带 note', async () => {
    const zhe = user('阿哲');
    const slot1 = slotByLabel(fixture, '时段1');
    const slot2 = slotByLabel(fixture, '时段2');
    const evenId = addSchedule({
      userId: zhe.id,
      weekday: 1,
      slotId: slot1.id,
      startWeek: 1,
      endWeek: 20,
      parity: 'even',
      note: '算法设计',
    });
    const rangeId = addSchedule({
      userId: zhe.id,
      weekday: 2,
      slotId: slot2.id,
      startWeek: 5,
      endWeek: 6,
      note: '数据库系统',
    });

    const week1 = await api<PersonalBoard>(app, 'GET', '/api/v1/board/user/' + zhe.id + '?week=1');
    expect(week1.status).toBe(200);
    expect(week1.data.user.name).toBe('阿哲');
    expect(week1.data.cells).toHaveLength(7 * 7);
    expect(personalCellOf(week1.data, 1, slot1.id).scheduleId).toBeNull();
    expect(personalCellOf(week1.data, 2, slot2.id).scheduleId).toBeNull();

    const week2 = await api<PersonalBoard>(app, 'GET', '/api/v1/board/user/' + zhe.id + '?week=2');
    const hit = personalCellOf(week2.data, 1, slot1.id);
    expect(hit.scheduleId).toBe(evenId);
    expect(hit.note).toBe('算法设计');

    const week5 = await api<PersonalBoard>(app, 'GET', '/api/v1/board/user/' + zhe.id + '?week=5');
    // 第 5 周为单周，双周安排不命中；区间安排命中
    expect(personalCellOf(week5.data, 1, slot1.id).scheduleId).toBeNull();
    expect(personalCellOf(week5.data, 2, slot2.id).scheduleId).toBe(rangeId);
    expect(personalCellOf(week5.data, 2, slot2.id).note).toBe('数据库系统');

    const missing = await api(app, 'GET', '/api/v1/board/user/999999?week=1');
    expect(missing.status).toBe(404);
  });
});

describe('GET /board/user/:id/schedules', () => {
  it('按周区间重叠过滤个人安排', async () => {
    const zhe = user('阿哲');
    const slot1 = slotByLabel(fixture, '时段1');
    const longId = addSchedule({ userId: zhe.id, weekday: 1, slotId: slot1.id, startWeek: 1, endWeek: 20, parity: 'even' });
    const midId = addSchedule({ userId: zhe.id, weekday: 2, slotId: slot1.id, startWeek: 5, endWeek: 6 });
    const lateId = addSchedule({ userId: zhe.id, weekday: 3, slotId: slot1.id, startWeek: 10, endWeek: 12 });

    const all = await api<{ schedules: Schedule[] }>(app, 'GET', '/api/v1/board/user/' + zhe.id + '/schedules');
    expect(all.status).toBe(200);
    expect(all.data.schedules.map((item) => item.id).sort((a, b) => a - b)).toEqual(
      [longId, midId, lateId].sort((a, b) => a - b),
    );

    const early = await api<{ schedules: Schedule[] }>(
      app,
      'GET',
      '/api/v1/board/user/' + zhe.id + '/schedules?from_week=1&to_week=4',
    );
    expect(early.data.schedules.map((item) => item.id)).toEqual([longId]);

    const mid = await api<{ schedules: Schedule[] }>(
      app,
      'GET',
      '/api/v1/board/user/' + zhe.id + '/schedules?from_week=5&to_week=5',
    );
    expect(mid.data.schedules.map((item) => item.id).sort((a, b) => a - b)).toEqual(
      [longId, midId].sort((a, b) => a - b),
    );

    const invalid = await api(app, 'GET', '/api/v1/board/user/' + zhe.id + '/schedules?from_week=6&to_week=3');
    expect(invalid.status).toBe(422);
  });
});
