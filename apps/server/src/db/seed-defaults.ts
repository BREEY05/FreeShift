import type { DatabaseSync } from 'node:sqlite';
import { DEFAULT_RECOMMEND_CONFIG, PRESET_TEMPLATE_NAMES, addDays, todayIso } from '@freeshift/shared';
import type { DayPart } from '@freeshift/shared';

interface PresetSlot {
  label: string;
  start: string;
  end: string;
  dayPart: DayPart;
  durationMin: number;
}

interface PresetTemplate {
  name: string;
  description: string;
  slots: PresetSlot[];
}

const twoPeriods: PresetSlot[] = [
  { label: '第1-2节', start: '08:00', end: '09:40', dayPart: 'morning', durationMin: 100 },
  { label: '第3-4节', start: '10:00', end: '11:40', dayPart: 'morning', durationMin: 100 },
  { label: '第5-6节', start: '14:00', end: '15:40', dayPart: 'afternoon', durationMin: 100 },
  { label: '第7-8节', start: '16:00', end: '17:40', dayPart: 'afternoon', durationMin: 100 },
  { label: '第9-10节', start: '19:00', end: '20:40', dayPart: 'evening', durationMin: 100 },
];

const singlePeriods: PresetSlot[] = [
  { label: '第1节', start: '08:00', end: '08:45', dayPart: 'morning', durationMin: 45 },
  { label: '第2节', start: '08:55', end: '09:40', dayPart: 'morning', durationMin: 45 },
  { label: '第3节', start: '10:00', end: '10:45', dayPart: 'morning', durationMin: 45 },
  { label: '第4节', start: '10:55', end: '11:40', dayPart: 'morning', durationMin: 45 },
  { label: '第5节', start: '14:00', end: '14:45', dayPart: 'afternoon', durationMin: 45 },
  { label: '第6节', start: '14:55', end: '15:40', dayPart: 'afternoon', durationMin: 45 },
  { label: '第7节', start: '16:00', end: '16:45', dayPart: 'afternoon', durationMin: 45 },
  { label: '第8节', start: '16:55', end: '17:40', dayPart: 'afternoon', durationMin: 45 },
];

const halfDay: PresetSlot[] = [
  { label: '上午', start: '09:00', end: '12:00', dayPart: 'morning', durationMin: 180 },
  { label: '下午', start: '13:30', end: '18:00', dayPart: 'afternoon', durationMin: 270 },
  { label: '晚上', start: '19:00', end: '21:00', dayPart: 'evening', durationMin: 120 },
];

const presets: PresetTemplate[] = [
  { name: PRESET_TEMPLATE_NAMES.TWO_PERIODS, description: '每天 5 个时间段，每段两节连排（100 分钟）', slots: twoPeriods },
  { name: PRESET_TEMPLATE_NAMES.SINGLE_PERIODS, description: '每天 8 节，每节 45 分钟', slots: singlePeriods },
  { name: PRESET_TEMPLATE_NAMES.HALF_DAY, description: '上午 / 下午 / 晚上三个大段', slots: halfDay },
  { name: PRESET_TEMPLATE_NAMES.EMPTY, description: '空白模板，按需添加自定义时间段', slots: [] },
];

/** 本周周一（YYYY-MM-DD） */
export function mondayOf(dateIso: string): string {
  const date = new Date(dateIso + 'T00:00:00Z');
  const offset = (date.getUTCDay() + 6) % 7;
  return addDays(dateIso, -offset);
}

function ensurePresetTemplates(db: DatabaseSync): void {
  const findTemplate = db.prepare('SELECT id FROM slot_template WHERE name = ?');
  const insertTemplate = db.prepare('INSERT INTO slot_template (name, description, is_preset) VALUES (?, ?, 1)');
  const insertSlot = db.prepare(
    'INSERT INTO time_slot (template_id, label, start_time, end_time, day_part, duration_min, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)',
  );

  for (const preset of presets) {
    const existing = findTemplate.get(preset.name) as { id?: number } | undefined;
    if (existing && existing.id) continue;
    const result = insertTemplate.run(preset.name, preset.description);
    const templateId = Number(result.lastInsertRowid);
    preset.slots.forEach((slot, index) => {
      insertSlot.run(templateId, slot.label, slot.start, slot.end, slot.dayPart, slot.durationMin, index + 1);
    });
  }
}

function ensureDefaultSemester(db: DatabaseSync): void {
  const count = db.prepare('SELECT COUNT(*) AS n FROM semester').get() as { n: number | bigint };
  if (Number(count.n) > 0) return;

  const template = db
    .prepare('SELECT id FROM slot_template WHERE name = ?')
    .get(PRESET_TEMPLATE_NAMES.TWO_PERIODS) as { id: number | bigint } | undefined;
  if (!template) return;

  const today = todayIso();
  const year = today.slice(0, 4);
  const month = Number(today.slice(5, 7));
  const season = month >= 2 && month <= 7 ? '春季学期' : '秋季学期';
  const name = year + ' ' + season;

  db.prepare(
    'INSERT INTO semester (name, start_date, total_weeks, week1_parity, active_template_id, is_active) VALUES (?, ?, ?, ?, ?, 1)',
  ).run(name, mondayOf(today), 20, 'odd', Number(template.id));
}

export function seedDefaults(db: DatabaseSync): void {
  db.prepare('INSERT OR IGNORE INTO algo_config (id, weights_json) VALUES (1, ?)').run(
    JSON.stringify(DEFAULT_RECOMMEND_CONFIG),
  );
  ensurePresetTemplates(db);
  ensureDefaultSemester(db);
}
