import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type {
  AlternativesResult,
  AppUser,
  FactorScores,
  FreeBlock,
  RecommendConfig,
  ScoredCell,
} from '@freeshift/shared';
import { DEFAULT_FACTOR_WEIGHTS } from '@freeshift/shared';
import { buildApp } from '../src/app.ts';
import { closeDb, run } from '../src/db/index.ts';
import type { AlgoFixture } from './helpers/algoFixtures.ts';
import { addSchedule, api, setupAlgoFixture, slotByLabel } from './helpers/algoFixtures.ts';

let app: ReturnType<typeof buildApp>;
let fixture: AlgoFixture;

function user(name: string): AppUser {
  const found = fixture.users.find((item) => item.name === name);
  if (!found) throw new Error('测试用户不存在：' + name);
  return found;
}

function zeroWeights(): Partial<FactorScores> {
  return { freeRatio: 0, continuity: 0, history: 0, friendliness: 0, recentLoad: 0 };
}

beforeAll(() => {
  app = buildApp();
});

afterAll(async () => {
  await app.close();
  closeDb();
});

beforeEach(() => {
  fixture = setupAlgoFixture(['小林', '阿哲', '雨晨']);
});

describe('POST /recommend/common-free', () => {
  it('相邻空闲格合并为连续块并按长度/星期/顺序排序', async () => {
    const lin = user('小林');
    const zhe = user('阿哲');
    const slot5 = slotByLabel(fixture, '时段5');
    const slot6 = slotByLabel(fixture, '时段6');
    const slot7 = slotByLabel(fixture, '时段7');
    addSchedule({ userId: lin.id, weekday: 1, slotId: slot5.id, startWeek: 1, endWeek: 20 });
    addSchedule({ userId: zhe.id, weekday: 1, slotId: slot6.id, startWeek: 1, endWeek: 20 });
    addSchedule({ userId: zhe.id, weekday: 1, slotId: slot7.id, startWeek: 1, endWeek: 20 });

    const response = await api<{ blocks: FreeBlock[] }>(app, 'POST', '/api/v1/recommend/common-free', {
      week: 1,
      userIds: [lin.id, zhe.id],
    });
    expect(response.status).toBe(200);
    const blocks = response.data.blocks;
    expect(blocks).toHaveLength(7);
    // 周二到周日整天空闲（7 连格），周一只剩 1-4 格
    expect(blocks.slice(0, 6).map((block) => block.weekday)).toEqual([2, 3, 4, 5, 6, 7]);
    expect(blocks[0].length).toBe(7);
    expect(blocks[0].labels).toEqual(['时段1', '时段2', '时段3', '时段4', '时段5', '时段6', '时段7']);
    expect(blocks[0].startTime).toBe('08:00');
    expect(blocks[0].endTime).toBe('15:00');
    expect(blocks[0].durationMin).toBe(420);

    const monday = blocks[6];
    expect(monday.weekday).toBe(1);
    expect(monday.length).toBe(4);
    expect(monday.slotIds).toEqual(fixture.slots.slice(0, 4).map((slot) => slot.id));
    expect(monday.startTime).toBe('08:00');
    expect(monday.endTime).toBe('12:00');
    expect(monday.durationMin).toBe(240);

    const top2 = await api<{ blocks: FreeBlock[] }>(app, 'POST', '/api/v1/recommend/common-free', {
      week: 1,
      userIds: [lin.id, zhe.id],
      topK: 2,
    });
    expect(top2.data.blocks).toHaveLength(2);
    expect(top2.data.blocks.map((block) => block.weekday)).toEqual([2, 3]);
  });

  it('requireTimeAdjacent 影响时间不连续时是否合并', async () => {
    const lin = user('小林');
    const slot4 = slotByLabel(fixture, '时段4');
    // 在时段3/4 之间制造 30 分钟间隙
    run('UPDATE time_slot SET start_time = ? WHERE id = ?', ['11:30', slot4.id]);

    const strict = await api<{ blocks: FreeBlock[] }>(app, 'POST', '/api/v1/recommend/common-free', {
      week: 1,
      userIds: [lin.id],
    });
    const strictMonday = strict.data.blocks.filter((block) => block.weekday === 1);
    expect(strictMonday.map((block) => block.length)).toEqual([4, 3]);
    expect(strictMonday[0].labels).toEqual(['时段4', '时段5', '时段6', '时段7']);
    expect(strictMonday[1].labels).toEqual(['时段1', '时段2', '时段3']);

    const loose = await api<{ blocks: FreeBlock[] }>(app, 'POST', '/api/v1/recommend/common-free', {
      week: 1,
      userIds: [lin.id],
      requireTimeAdjacent: false,
    });
    const looseMonday = loose.data.blocks.filter((block) => block.weekday === 1);
    expect(looseMonday).toHaveLength(1);
    expect(looseMonday[0].length).toBe(7);
  });

  it('非法用户返回 422', async () => {
    const response = await api(app, 'POST', '/api/v1/recommend/common-free', { week: 1, userIds: [999999] });
    expect(response.status).toBe(422);
  });
});

describe('POST /recommend/scored', () => {
  it('权重变化改变排序，且候选只含所选用户空闲格', async () => {
    const lin = user('小林');
    const zhe = user('阿哲');
    const yu = user('雨晨');
    const slot1 = slotByLabel(fixture, '时段1');
    const slot2 = slotByLabel(fixture, '时段2');
    addSchedule({ userId: zhe.id, weekday: 1, slotId: slot1.id, startWeek: 1, endWeek: 20 });
    addSchedule({ userId: yu.id, weekday: 2, slotId: slot2.id, startWeek: 1, endWeek: 20 });

    const freeRatioFirst = await api<{ cells: ScoredCell[] }>(app, 'POST', '/api/v1/recommend/scored', {
      week: 1,
      userIds: [lin.id],
      weights: { ...zeroWeights(), freeRatio: 1 },
    });
    expect(freeRatioFirst.status).toBe(200);
    const byFree = freeRatioFirst.data.cells;
    expect(byFree).toHaveLength(7 * 7);
    expect(byFree[0].weekday).toBe(1);
    expect(byFree[0].slotId).toBe(slot2.id);
    expect(byFree[0].freeCount).toBe(3);
    expect(byFree[0].score).toBe(1);
    expect(byFree[0].factors.freeRatio).toBe(1);

    const friendlinessFirst = await api<{ cells: ScoredCell[] }>(app, 'POST', '/api/v1/recommend/scored', {
      week: 1,
      userIds: [lin.id],
      weights: { ...zeroWeights(), friendliness: 1 },
    });
    const byFriendly = friendlinessFirst.data.cells;
    expect(byFriendly[0].weekday).toBe(1);
    expect(byFriendly[0].slotId).toBe(slot1.id);
    expect(byFriendly[0].factors.friendliness).toBe(1);
    expect(byFriendly[0].score).toBe(1);
    expect(byFriendly[0].slotLabel).toBe('时段1');
    expect(byFriendly[0].reasons.length).toBeGreaterThanOrEqual(1);
    expect(byFriendly[0].reasons.length).toBeLessThanOrEqual(3);

    // 默认权重下 score = Σ w × factor
    const defaults = await api<{ cells: ScoredCell[] }>(app, 'POST', '/api/v1/recommend/scored', {
      week: 1,
      userIds: [lin.id],
    });
    const top = defaults.data.cells[0];
    let expected = 0;
    for (const key of Object.keys(DEFAULT_FACTOR_WEIGHTS) as (keyof FactorScores)[]) {
      expected += DEFAULT_FACTOR_WEIGHTS[key] * top.factors[key];
    }
    expect(top.score).toBeCloseTo(expected, 5);
  });

  it('filters 裁剪候选（dayParts/weekdays/allFreeOnly/minFreeRatio）', async () => {
    const lin = user('小林');
    const zhe = user('阿哲');
    const yu = user('雨晨');
    const slot1 = slotByLabel(fixture, '时段1');
    const slot2 = slotByLabel(fixture, '时段2');
    addSchedule({ userId: zhe.id, weekday: 1, slotId: slot1.id, startWeek: 1, endWeek: 20 });
    addSchedule({ userId: yu.id, weekday: 2, slotId: slot2.id, startWeek: 1, endWeek: 20 });

    const morning = await api<{ cells: ScoredCell[] }>(app, 'POST', '/api/v1/recommend/scored', {
      week: 1,
      userIds: [lin.id],
      filters: { dayParts: ['morning'] },
    });
    expect(morning.data.cells).toHaveLength(7 * 3);

    const monday = await api<{ cells: ScoredCell[] }>(app, 'POST', '/api/v1/recommend/scored', {
      week: 1,
      userIds: [lin.id],
      filters: { weekdays: [1] },
    });
    expect(monday.data.cells).toHaveLength(7);

    // 缺省 user_ids：候选 = 全部启用用户都空闲的格子（排除两格）
    const allUsers = await api<{ cells: ScoredCell[] }>(app, 'POST', '/api/v1/recommend/scored', {
      week: 1,
      filters: { allFreeOnly: true },
    });
    expect(allUsers.data.cells).toHaveLength(47);
    expect(allUsers.data.cells.every((cell) => cell.freeCount === cell.totalUsers)).toBe(true);

    const allFreeRatio = await api<{ cells: ScoredCell[] }>(app, 'POST', '/api/v1/recommend/scored', {
      week: 1,
      userIds: [lin.id],
      filters: { minFreeRatio: 1 },
    });
    expect(allFreeRatio.data.cells).toHaveLength(47);

    const topK = await api<{ cells: ScoredCell[] }>(app, 'POST', '/api/v1/recommend/scored', {
      week: 1,
      userIds: [lin.id],
      topK: 5,
    });
    expect(topK.data.cells).toHaveLength(5);
  });

  it('非法参数返回 422', async () => {
    const bad = await api(app, 'POST', '/api/v1/recommend/scored', { filters: { weekdays: [9] } });
    expect(bad.status).toBe(422);
  });
});

describe('POST /recommend/alternatives', () => {
  it('按冲突人数升序、空闲人数降序排序并返回原格统计', async () => {
    const lin = user('小林');
    const zhe = user('阿哲');
    const yu = user('雨晨');
    const slot1 = slotByLabel(fixture, '时段1');
    const slot2 = slotByLabel(fixture, '时段2');
    const slot3 = slotByLabel(fixture, '时段3');
    const slot4 = slotByLabel(fixture, '时段4');
    const slot5 = slotByLabel(fixture, '时段5');
    const slot6 = slotByLabel(fixture, '时段6');

    addSchedule({ userId: lin.id, weekday: 2, slotId: slot1.id, startWeek: 1, endWeek: 20 });
    addSchedule({ userId: zhe.id, weekday: 1, slotId: slot3.id, startWeek: 1, endWeek: 10 });
    addSchedule({ userId: zhe.id, weekday: 1, slotId: slot4.id, startWeek: 1, endWeek: 20 });
    addSchedule({ userId: yu.id, weekday: 1, slotId: slot4.id, startWeek: 1, endWeek: 20 });

    const target = { userId: lin.id, weekday: 1, slotId: slot1.id, startWeek: 1, endWeek: 20, parity: 'all' };
    const response = await api<AlternativesResult>(app, 'POST', '/api/v1/recommend/alternatives', {
      ...target,
      topK: 3,
    });
    expect(response.status).toBe(200);
    expect(response.data.cells).toHaveLength(3);
    expect(response.data.cells.map((cell) => cell.slotId)).toEqual([slot2.id, slot5.id, slot6.id]);
    expect(response.data.cells.every((cell) => cell.occupiedUsers === 0)).toBe(true);
    expect(response.data.cells.every((cell) => cell.freeUsers === 3)).toBe(true);
    expect(response.data.cells[0].score).toBe(1);
    expect(response.data.source).toEqual({ weekday: 1, slotId: slot1.id, occupiedUsers: 0, freeUsers: 3 });

    // 原格也有人占用时 source 统计正确
    addSchedule({ userId: zhe.id, weekday: 1, slotId: slot1.id, startWeek: 1, endWeek: 20 });
    addSchedule({ userId: yu.id, weekday: 1, slotId: slot1.id, startWeek: 1, endWeek: 20 });
    const withConflict = await api<AlternativesResult>(app, 'POST', '/api/v1/recommend/alternatives', target);
    expect(withConflict.data.source.occupiedUsers).toBe(2);
    expect(withConflict.data.source.freeUsers).toBe(1);

    // 全量候选保持排序约束
    const cells = withConflict.data.cells;
    expect(cells.length).toBe(7 * 7 - 1 - 1);
    for (let index = 1; index < cells.length; index += 1) {
      const prev = cells[index - 1];
      const current = cells[index];
      expect(prev.occupiedUsers).toBeLessThanOrEqual(current.occupiedUsers);
      if (prev.occupiedUsers === current.occupiedUsers) {
        expect(prev.freeUsers).toBeGreaterThanOrEqual(current.freeUsers);
      }
    }
  });

  it('校验目标时间段属于当前模板与周次范围', async () => {
    const lin = user('小林');
    const slot1 = slotByLabel(fixture, '时段1');
    const badSlot = await api(app, 'POST', '/api/v1/recommend/alternatives', {
      userId: lin.id,
      weekday: 1,
      slotId: 999999,
      startWeek: 1,
      endWeek: 4,
      parity: 'all',
    });
    expect(badSlot.status).toBe(422);
    const badRange = await api(app, 'POST', '/api/v1/recommend/alternatives', {
      userId: lin.id,
      weekday: 1,
      slotId: slot1.id,
      startWeek: 5,
      endWeek: 3,
      parity: 'all',
    });
    expect(badRange.status).toBe(422);
  });
});

describe('/recommend/config', () => {
  it('读取默认配置、归一化保存并立即生效', async () => {
    const initial = await api<RecommendConfig>(app, 'GET', '/api/v1/recommend/config');
    expect(initial.status).toBe(200);
    expect(initial.data.weights).toEqual(DEFAULT_FACTOR_WEIGHTS);
    expect(initial.data.dayPart).toEqual({ morning: 0.9, afternoon: 0.8, evening: 0.5 });
    expect(initial.data.historyWeeks).toBe(4);
    expect(initial.data.recentWindow).toBe(1);

    const saved = await api<RecommendConfig>(app, 'PUT', '/api/v1/recommend/config', {
      weights: { freeRatio: 1, continuity: 1, history: 1, friendliness: 1, recentLoad: 1 },
      historyWeeks: 6,
      recentWindow: 2,
    });
    expect(saved.status).toBe(200);
    for (const key of Object.keys(DEFAULT_FACTOR_WEIGHTS) as (keyof FactorScores)[]) {
      expect(saved.data.weights[key]).toBeCloseTo(0.2, 6);
    }
    expect(saved.data.historyWeeks).toBe(6);
    expect(saved.data.recentWindow).toBe(2);

    const persisted = await api<RecommendConfig>(app, 'GET', '/api/v1/recommend/config');
    expect(persisted.data).toEqual(saved.data);

    // 只加大 freeRatio: 归一化后其余按原值比例缩小
    const boosted = await api<RecommendConfig>(app, 'PUT', '/api/v1/recommend/config', {
      weights: { freeRatio: 3 },
    });
    const weights = boosted.data.weights;
    const sum = (Object.values(weights) as number[]).reduce((total, value) => total + value, 0);
    expect(sum).toBeCloseTo(1, 4);
    expect(weights.freeRatio).toBeGreaterThan(0.2);

    // 权重立即生效：仅保留 freeRatio 权重时 score 等于该因子归一化值
    const onlyFreeRatio = await api<RecommendConfig>(app, 'PUT', '/api/v1/recommend/config', {
      weights: { freeRatio: 2, continuity: 0, history: 0, friendliness: 0, recentLoad: 0 },
    });
    expect(onlyFreeRatio.data.weights).toEqual({
      freeRatio: 1,
      continuity: 0,
      history: 0,
      friendliness: 0,
      recentLoad: 0,
    });
    const lin = user('小林');
    const scored = await api<{ cells: ScoredCell[] }>(app, 'POST', '/api/v1/recommend/scored', {
      week: 1,
      userIds: [lin.id],
    });
    const top = scored.data.cells[0];
    expect(top.score).toBeCloseTo(top.factors.freeRatio, 5);
  });

  it('非法权重返回 422', async () => {
    const negative = await api(app, 'PUT', '/api/v1/recommend/config', { weights: { freeRatio: -1 } });
    expect(negative.status).toBe(422);
    const zero = await api(app, 'PUT', '/api/v1/recommend/config', {
      weights: { freeRatio: 0, continuity: 0, history: 0, friendliness: 0, recentLoad: 0 },
    });
    expect(zero.status).toBe(422);
    const badDayPart = await api(app, 'PUT', '/api/v1/recommend/config', { dayPart: { morning: 2 } });
    expect(badDayPart.status).toBe(422);
  });
});
