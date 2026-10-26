import type { AppUser, DayPart, Parity, Semester, TimeSlot, Weekday } from '@freeshift/shared';
import { DEFAULT_RECOMMEND_CONFIG, DEFAULT_USER_COLORS } from '@freeshift/shared';
import type { FastifyInstance } from 'fastify';
import { all, get, getDb, run } from '../../src/db/index.ts';
import type { SlotRow, UserRow } from '../../src/lib/mappers.ts';
import { mapSlot, mapUser } from '../../src/lib/mappers.ts';
import { getActiveSemester, getTemplateSlots } from '../../src/services/context.ts';
import { refreshOccurrences } from '../../src/services/occurrence.ts';

export const TEST_TEMPLATE_NAME = '算法测试模板';
export const TEST_TOTAL_WEEKS = 20;
export const TEST_WEEK1_PARITY = 'odd' as const;
export const TEST_START_DATE = '2026-03-02';

interface SlotDef {
  label: string;
  startTime: string;
  endTime: string;
  dayPart: DayPart;
}

/** 7 格全部时间连续（08:00-15:00，每格 60 分钟），便于验证连续块合并 */
const SLOT_DEFS: SlotDef[] = [
  { label: '时段1', startTime: '08:00', endTime: '09:00', dayPart: 'morning' },
  { label: '时段2', startTime: '09:00', endTime: '10:00', dayPart: 'morning' },
  { label: '时段3', startTime: '10:00', endTime: '11:00', dayPart: 'morning' },
  { label: '时段4', startTime: '11:00', endTime: '12:00', dayPart: 'afternoon' },
  { label: '时段5', startTime: '12:00', endTime: '13:00', dayPart: 'afternoon' },
  { label: '时段6', startTime: '13:00', endTime: '14:00', dayPart: 'evening' },
  { label: '时段7', startTime: '14:00', endTime: '15:00', dayPart: 'evening' },
];

export interface AlgoFixture {
  semester: Semester;
  templateId: number;
  slots: TimeSlot[];
  users: AppUser[];
}

export interface AddScheduleInput {
  userId: number;
  weekday: Weekday;
  slotId: number;
  startWeek: number;
  endWeek: number;
  parity?: Parity;
  note?: string;
}

function ensureTestTemplate(): number {
  const existing = get<{ id: number }>('SELECT id FROM slot_template WHERE name = ?', [TEST_TEMPLATE_NAME]);
  let templateId: number;
  if (existing) {
    templateId = Number(existing.id);
    run('DELETE FROM time_slot WHERE template_id = ?', [templateId]);
  } else {
    templateId = run('INSERT INTO slot_template (name, description, is_preset) VALUES (?, ?, 0)', [
      TEST_TEMPLATE_NAME,
      '测试用 7 格连续模板',
    ]).lastInsertRowid;
  }
  SLOT_DEFS.forEach((slot, index) => {
    run(
      'INSERT INTO time_slot (template_id, label, start_time, end_time, day_part, duration_min, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [templateId, slot.label, slot.startTime, slot.endTime, slot.dayPart, 60, index + 1],
    );
  });
  return templateId;
}

/**
 * 重置数据并构造确定性的学期 / 模板 / 用户。
 * 每个测试前调用：清空安排与用户、固定学期周次与单双周、重置算法配置。
 */
export function setupAlgoFixture(userNames: string[] = []): AlgoFixture {
  const db = getDb();
  db.exec('DELETE FROM schedule_occurrence; DELETE FROM schedule; DELETE FROM app_user;');

  const templateId = ensureTestTemplate();
  const semester = getActiveSemester();
  run(
    `UPDATE semester
        SET name = ?, start_date = ?, total_weeks = ?, week1_parity = ?, active_template_id = ?,
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE id = ?`,
    ['测试学期', TEST_START_DATE, TEST_TOTAL_WEEKS, TEST_WEEK1_PARITY, templateId, semester.id],
  );

  run('UPDATE algo_config SET weights_json = ? WHERE id = 1', [JSON.stringify(DEFAULT_RECOMMEND_CONFIG)]);

  if (userNames.length > 0) addUsers(userNames);

  const currentSemester = getActiveSemester();
  return {
    semester: currentSemester,
    templateId,
    slots: getTemplateSlots(templateId),
    users: listUsers(),
  };
}

export function addUsers(names: string[]): AppUser[] {
  const maxRow = get<{ n: number }>('SELECT COALESCE(MAX(sort_order), 0) AS n FROM app_user');
  let sortOrder = Number(maxRow?.n ?? 0);
  names.forEach((name, index) => {
    sortOrder += 1;
    run('INSERT INTO app_user (name, color, note, is_active, sort_order) VALUES (?, ?, ?, 1, ?)', [
      name,
      DEFAULT_USER_COLORS[index % DEFAULT_USER_COLORS.length],
      '',
      sortOrder,
    ]);
  });
  return listUsers();
}

export function listUsers(): AppUser[] {
  return all<UserRow>('SELECT * FROM app_user ORDER BY sort_order ASC, id ASC').map(mapUser);
}

export function getSlots(templateId: number): TimeSlot[] {
  return all<SlotRow>('SELECT * FROM time_slot WHERE template_id = ? ORDER BY sort_order ASC', [templateId]).map(mapSlot);
}

export function slotByLabel(fixture: AlgoFixture, label: string): TimeSlot {
  const slot = fixture.slots.find((item) => item.label === label);
  if (!slot) throw new Error('测试模板缺少时间段：' + label);
  return slot;
}

/** 直接写 schedule + occurrence（复用 occurrence.ts 展开，与业务写入逻辑一致） */
export function addSchedule(input: AddScheduleInput): number {
  const semester = getActiveSemester();
  const result = run(
    'INSERT INTO schedule (semester_id, user_id, weekday, slot_id, start_week, end_week, parity, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [
      semester.id,
      input.userId,
      input.weekday,
      input.slotId,
      input.startWeek,
      input.endWeek,
      input.parity ?? 'all',
      input.note ?? '',
    ],
  );
  const scheduleId = result.lastInsertRowid;
  refreshOccurrences(
    {
      id: scheduleId,
      semesterId: semester.id,
      userId: input.userId,
      weekday: input.weekday,
      slotId: input.slotId,
      startWeek: input.startWeek,
      endWeek: input.endWeek,
      parity: input.parity ?? 'all',
    },
    semester.week1Parity,
  );
  return scheduleId;
}

export function countSchedules(): number {
  return Number(get<{ n: number }>('SELECT COUNT(*) AS n FROM schedule')?.n ?? 0);
}

export function countOccurrences(): number {
  return Number(get<{ n: number }>('SELECT COUNT(*) AS n FROM schedule_occurrence')?.n ?? 0);
}

export interface InjectResult<T> {
  status: number;
  data: T;
  body: unknown;
  text: string;
}

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** 统一注入：解析 { data } 包裹 */
export async function api<T = unknown>(
  app: FastifyInstance,
  method: Method,
  url: string,
  payload?: unknown,
  headers: Record<string, string> = {},
): Promise<InjectResult<T>> {
  const response = await app.inject({
    method,
    url,
    headers: payload === undefined ? headers : { 'content-type': 'application/json', ...headers },
    payload: payload === undefined ? undefined : JSON.stringify(payload),
  });
  const text = response.body;
  let body: unknown = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = null;
  }
  const data = (body as { data?: T } | null)?.data as T;
  return { status: response.statusCode, data, body, text };
}
