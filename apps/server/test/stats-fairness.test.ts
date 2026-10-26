import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AppUser, FairnessReport, FairnessUser } from '@freeshift/shared';
import { buildApp } from '../src/app.ts';
import { closeDb } from '../src/db/index.ts';
import type { AlgoFixture } from './helpers/algoFixtures.ts';
import { addSchedule, api, setupAlgoFixture, slotByLabel } from './helpers/algoFixtures.ts';

let app: ReturnType<typeof buildApp>;
let fixture: AlgoFixture;

function user(name: string): AppUser {
  const found = fixture.users.find((item) => item.name === name);
  if (!found) throw new Error('测试用户不存在：' + name);
  return found;
}

function fairnessUser(report: FairnessReport, name: string): FairnessUser {
  const found = report.users.find((item) => item.name === name);
  if (!found) throw new Error('报告中缺少用户：' + name);
  return found;
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

describe('GET /stats/fairness', () => {
  it('统计占用格数/分钟/连续块，并给出基尼系数与不均衡提示', async () => {
    const lin = user('小林');
    const zhe = user('阿哲');
    const yu = user('雨晨');
    const slot1 = slotByLabel(fixture, '时段1');
    const slot2 = slotByLabel(fixture, '时段2');
    addSchedule({ userId: lin.id, weekday: 1, slotId: slot1.id, startWeek: 1, endWeek: 4 });
    addSchedule({ userId: zhe.id, weekday: 1, slotId: slot1.id, startWeek: 1, endWeek: 4 });
    addSchedule({ userId: zhe.id, weekday: 1, slotId: slot2.id, startWeek: 1, endWeek: 4 });

    const response = await api<FairnessReport>(app, 'GET', '/api/v1/stats/fairness?from_week=1&to_week=4');
    expect(response.status).toBe(200);
    const report = response.data;
    expect(report.fromWeek).toBe(1);
    expect(report.toWeek).toBe(4);
    expect(report.users.map((item) => item.name)).toEqual(['小林', '阿哲', '雨晨']);

    const linStat = fairnessUser(report, '小林');
    expect(linStat.occupiedCells).toBe(4);
    expect(linStat.occupiedMinutes).toBe(240);
    expect(linStat.maxContiguousMinutes).toBe(60);

    const zheStat = fairnessUser(report, '阿哲');
    expect(zheStat.occupiedCells).toBe(8);
    expect(zheStat.occupiedMinutes).toBe(480);
    expect(zheStat.maxContiguousMinutes).toBe(120);

    const yuStat = fairnessUser(report, '雨晨');
    expect(yuStat.occupiedCells).toBe(0);
    expect(yuStat.occupiedMinutes).toBe(0);
    expect(yuStat.maxContiguousMinutes).toBe(0);

    // x = [240, 480, 0]：μ=240，G = 1920 / (2×9×240) ≈ 0.4444
    expect(report.mean).toBeCloseTo(240, 6);
    expect(report.gini).toBeCloseTo(1920 / (2 * 9 * 240), 6);
    expect(report.variance).toBeCloseTo(38400, 6);
    expect(report.hints.length).toBe(1);
    expect(report.hints[0]).toContain('不均衡');
    expect(report.hints[0]).toContain('基尼系数');
    expect(report.hints[0]).toContain('阿哲');
    expect(report.hints[0]).toContain('雨晨');
  });

  it('单日连续占用超过 300 分钟时给出提示，且不在跨周累加', async () => {
    const zhe = user('阿哲');
    fixture.slots.forEach((slot) => {
      addSchedule({ userId: zhe.id, weekday: 2, slotId: slot.id, startWeek: 1, endWeek: 2 });
    });

    const response = await api<FairnessReport>(app, 'GET', '/api/v1/stats/fairness?from_week=1&to_week=2');
    const zheStat = fairnessUser(response.data, '阿哲');
    expect(zheStat.occupiedCells).toBe(14);
    expect(zheStat.occupiedMinutes).toBe(840);
    // 每周单独计算最大连续块（7 格 × 60 分钟），不跨周累加
    expect(zheStat.maxContiguousMinutes).toBe(420);
    expect(response.data.hints.some((hint) => hint.includes('连续') && hint.includes('阿哲'))).toBe(true);
    expect(response.data.hints.some((hint) => hint.includes('300'))).toBe(true);
  });

  it('人数不足 3 时不判定不均衡；全零时基尼为 0', async () => {
    fixture = setupAlgoFixture(['小林', '阿哲']);
    const lin = user('小林');
    const slot1 = slotByLabel(fixture, '时段1');
    addSchedule({ userId: lin.id, weekday: 1, slotId: slot1.id, startWeek: 1, endWeek: 4 });

    const twoUsers = await api<FairnessReport>(app, 'GET', '/api/v1/stats/fairness?from_week=1&to_week=4');
    expect(twoUsers.data.gini).toBeGreaterThan(0.25);
    expect(twoUsers.data.hints.some((hint) => hint.includes('不均衡'))).toBe(false);

    fixture = setupAlgoFixture(['小林', '阿哲', '雨晨']);
    const balanced = await api<FairnessReport>(app, 'GET', '/api/v1/stats/fairness?from_week=1&to_week=4');
    expect(balanced.data.gini).toBe(0);
    expect(balanced.data.variance).toBe(0);
    expect(balanced.data.mean).toBe(0);
    expect(balanced.data.hints).toEqual([]);
  });

  it('默认统计整学期，非法周次范围返回 422', async () => {
    const response = await api<FairnessReport>(app, 'GET', '/api/v1/stats/fairness');
    expect(response.status).toBe(200);
    expect(response.data.fromWeek).toBe(1);
    expect(response.data.toWeek).toBe(20);

    const reversed = await api(app, 'GET', '/api/v1/stats/fairness?from_week=6&to_week=3');
    expect(reversed.status).toBe(422);
    const outOfRange = await api(app, 'GET', '/api/v1/stats/fairness?to_week=99');
    expect(outOfRange.status).toBe(422);
    const zeroFrom = await api(app, 'GET', '/api/v1/stats/fairness?from_week=0');
    expect(zeroFrom.status).toBe(422);
  });
});
