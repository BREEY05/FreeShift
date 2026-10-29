import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AppUser, ImportResult } from '@freeshift/shared';
import { buildApp } from '../src/app.ts';
import { all, closeDb, get } from '../src/db/index.ts';
import { parseCsv } from '../src/services/csvService.ts';
import type { AlgoFixture } from './helpers/algoFixtures.ts';
import { addSchedule, api, countOccurrences, countSchedules, setupAlgoFixture, slotByLabel } from './helpers/algoFixtures.ts';

let app: ReturnType<typeof buildApp>;
let fixture: AlgoFixture;

const HEADER = 'user,weekday,slot_label,start_week,end_week,parity,note';

function user(name: string): AppUser {
  const found = fixture.users.find((item) => item.name === name);
  if (!found) throw new Error('测试用户不存在：' + name);
  return found;
}

async function importCsv(csv: string, dryRun = false) {
  return app.inject({
    method: 'POST',
    url: '/api/v1/import/schedules' + (dryRun ? '?dry_run=1' : ''),
    headers: { 'content-type': 'text/csv' },
    payload: csv,
  });
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

describe('GET /export/schedules', () => {
  it('返回带 BOM 的 CSV 附件并正确转义', async () => {
    const lin = user('小林');
    const slot1 = slotByLabel(fixture, '时段1');
    const slot2 = slotByLabel(fixture, '时段2');
    addSchedule({
      userId: lin.id,
      weekday: 1,
      slotId: slot1.id,
      startWeek: 1,
      endWeek: 16,
      parity: 'all',
      note: '高数, "实验"',
    });
    addSchedule({ userId: lin.id, weekday: 3, slotId: slot2.id, startWeek: 1, endWeek: 5, parity: 'odd', note: '' });

    const response = await app.inject({ method: 'GET', url: '/api/v1/export/schedules' });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/csv');
    expect(response.headers['content-disposition']).toContain('attachment');
    expect(response.headers['content-disposition']).toContain('schedules.csv');
    expect(response.body.charCodeAt(0)).toBe(0xfeff);

    const rows = parseCsv(response.body);
    expect(rows[0]).toEqual(['user', 'weekday', 'slot_label', 'start_week', 'end_week', 'parity', 'note']);
    expect(rows).toHaveLength(3);
    expect(rows[1]).toEqual(['小林', '1', '时段1', '1', '16', 'all', '高数, "实验"']);
    expect(rows[2]).toEqual(['小林', '3', '时段2', '1', '5', 'odd', '']);

    const filtered = await app.inject({ method: 'GET', url: '/api/v1/export/schedules?from_week=10&to_week=20' });
    const filteredRows = parseCsv(filtered.body);
    expect(filteredRows).toHaveLength(2);
    expect(filteredRows[1][2]).toBe('时段1');
  });

  it('非法周次范围返回 422', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/export/schedules?from_week=6&to_week=3' });
    expect(response.statusCode).toBe(422);
  });
});

describe('GET /export/board', () => {
  it('导出某周聚合表，格子内容为“空闲 N/M”', async () => {
    const lin = user('小林');
    const slot1 = slotByLabel(fixture, '时段1');
    addSchedule({ userId: lin.id, weekday: 1, slotId: slot1.id, startWeek: 1, endWeek: 20 });

    const response = await app.inject({ method: 'GET', url: '/api/v1/export/board?week=1' });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/csv');
    expect(response.headers['content-disposition']).toContain('board-week1.csv');
    expect(response.body.charCodeAt(0)).toBe(0xfeff);

    const rows = parseCsv(response.body);
    expect(rows[0]).toEqual(['时间段', '周一', '周二', '周三', '周四', '周五', '周六', '周日']);
    expect(rows).toHaveLength(1 + fixture.slots.length);
    expect(rows[1]).toEqual(['时段1', '空闲 2/3', '空闲 3/3', '空闲 3/3', '空闲 3/3', '空闲 3/3', '空闲 3/3', '空闲 3/3']);
    expect(rows[2]).toEqual(['时段2', '空闲 3/3', '空闲 3/3', '空闲 3/3', '空闲 3/3', '空闲 3/3', '空闲 3/3', '空闲 3/3']);
  });
});

describe('POST /import/schedules', () => {
  it('dry_run 只校验：统计将创建数并返回带行号的错误', async () => {
    const csv =
      '\uFEFF' +
      [
        HEADER,
        '小林,1,时段1,1,4,all,"高数, 实验"',
        '阿哲,8,时段2,1,4,all,',
        '幽灵,2,时段3,1,4,all,',
        '小林,1,不存在,1,4,all,',
        '小林,2,时段2,5,3,all,',
        '小林,3,时段3,1,4,sometimes,',
      ].join('\r\n');

    const response = await importCsv(csv, true);
    expect(response.statusCode).toBe(200);
    const result = JSON.parse(response.body).data as ImportResult;
    expect(result.created).toBe(1);
    expect(result.skipped).toBe(0);
    expect(result.errors.map((error) => error.row)).toEqual([3, 4, 5, 6, 7]);
    expect(result.errors[0].message).toContain('weekday');
    expect(result.errors[1].message).toContain('用户不存在');
    expect(result.errors[2].message).toContain('时间段不存在');
    expect(result.errors[3].message).toContain('周次范围');
    expect(result.errors[4].message).toContain('parity');
    expect(countSchedules()).toBe(0);
    expect(countOccurrences()).toBe(0);
  });

  it('真实导入写入 schedule + occurrence（含双周展开与引号转义）', async () => {
    const csv = [HEADER, '小林,1,时段1,1,4,all,"高数, 实验"', '阿哲,2,时段3,1,4,even,双周课'].join('\n');
    const response = await importCsv(csv);
    expect(response.statusCode).toBe(200);
    const result = JSON.parse(response.body).data as ImportResult;
    expect(result).toEqual({ created: 2, skipped: 0, errors: [] });

    expect(countSchedules()).toBe(2);
    const lin = user('小林');
    const linSchedule = get<{ id: number; note: string; parity: string }>(
      'SELECT id, note, parity FROM schedule WHERE user_id = ?',
      [lin.id],
    );
    expect(linSchedule?.note).toBe('高数, 实验');
    expect(linSchedule?.parity).toBe('all');
    const linWeeks = all<{ week_no: number }>(
      'SELECT week_no FROM schedule_occurrence WHERE schedule_id = ? ORDER BY week_no',
      [Number(linSchedule?.id)],
    ).map((row) => Number(row.week_no));
    expect(linWeeks).toEqual([1, 2, 3, 4]);

    const zhe = user('阿哲');
    const zheSchedule = get<{ id: number; parity: string }>('SELECT id, parity FROM schedule WHERE user_id = ?', [zhe.id]);
    expect(zheSchedule?.parity).toBe('even');
    const zheWeeks = all<{ week_no: number }>(
      'SELECT week_no FROM schedule_occurrence WHERE schedule_id = ? ORDER BY week_no',
      [Number(zheSchedule?.id)],
    ).map((row) => Number(row.week_no));
    // 第 1 周为单周，双周命中第 2、4 周
    expect(zheWeeks).toEqual([2, 4]);
  });

  it('与已有占用冲突的行计入 skipped，行内重复也只创建一次', async () => {
    const lin = user('小林');
    const slot1 = slotByLabel(fixture, '时段1');
    addSchedule({ userId: lin.id, weekday: 1, slotId: slot1.id, startWeek: 1, endWeek: 2 });

    const csv = [
      HEADER,
      '小林,1,时段1,1,2,all,重复占用',
      '阿哲,3,时段2,1,2,all,',
      '阿哲,3,时段2,1,2,all,文件内重复',
    ].join('\r\n');
    const response = await importCsv(csv);
    const result = JSON.parse(response.body).data as ImportResult;
    expect(result.created).toBe(1);
    expect(result.skipped).toBe(2);
    expect(result.errors).toEqual([]);
    expect(countSchedules()).toBe(2);
  });

  it('表头缺少必需列时返回 422', async () => {
    const response = await importCsv('foo,bar\n1,2');
    expect(response.statusCode).toBe(422);
  });

  it('导入结果可通过导出接口回读', async () => {
    const csv = [HEADER, '雨晨,4,时段5,2,6,odd,社团'].join('\n');
    await importCsv(csv);
    const exported = await app.inject({ method: 'GET', url: '/api/v1/export/schedules' });
    const rows = parseCsv(exported.body);
    expect(rows[1]).toEqual(['雨晨', '4', '时段5', '2', '6', 'odd', '社团']);

    const schedules = all<{ id: number; start_week: number; note: string }>('SELECT * FROM schedule');
    expect(schedules).toHaveLength(1);
    expect(Number(schedules[0].start_week)).toBe(2);
    expect(schedules[0].note).toBe('社团');
  });
});

describe('DELETE /data/reset', () => {
  it('清空当前组织的安排与成员，并返回删除条数', async () => {
    const slot = slotByLabel(fixture, '时段1');
    addSchedule({ userId: user('小林').id, weekday: 1, slotId: slot.id, startWeek: 1, endWeek: 20 });
    addSchedule({ userId: user('阿哲').id, weekday: 2, slotId: slot.id, startWeek: 1, endWeek: 20 });
    expect(countSchedules()).toBe(2);
    expect(countOccurrences()).toBeGreaterThan(0);

    const response = await app.inject({ method: 'DELETE', url: '/api/v1/data/reset' });
    expect(response.statusCode).toBe(200);
    const data = JSON.parse(response.body).data as { deletedSchedules: number; deletedUsers: number };
    expect(data.deletedSchedules).toBe(2);
    expect(data.deletedUsers).toBe(3);

    expect(countSchedules()).toBe(0);
    expect(countOccurrences()).toBe(0);
    expect(all('SELECT * FROM app_user WHERE org_id = (SELECT id FROM organization ORDER BY id LIMIT 1)')).toHaveLength(0);
    // 组织与成员关系保留
    expect(all('SELECT * FROM organization').length).toBeGreaterThanOrEqual(1);
    expect(all('SELECT * FROM org_member').length).toBeGreaterThanOrEqual(1);
  });

  it('空组织重复重置返回 0 且不影响组织本身', async () => {
    await app.inject({ method: 'DELETE', url: '/api/v1/data/reset' });
    const response = await app.inject({ method: 'DELETE', url: '/api/v1/data/reset' });
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body).data).toEqual({ deletedSchedules: 0, deletedUsers: 0 });
    expect(all('SELECT * FROM organization').length).toBeGreaterThanOrEqual(1);
    expect(all('SELECT * FROM org_member').length).toBeGreaterThanOrEqual(1);
  });
});
