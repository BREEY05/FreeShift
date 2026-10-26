import { DEFAULT_USER_COLORS } from '@freeshift/shared';
import { getDb } from './index.ts';
import { getActiveSemester, getTemplateSlots } from '../services/context.ts';
import { refreshOccurrences } from '../services/occurrence.ts';

interface DemoUser {
  name: string;
  note: string;
}

interface DemoPlan {
  user: string;
  weekday: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  slotLabel: string;
  startWeek: number;
  endWeek: number;
  parity: 'all' | 'odd' | 'even';
  note: string;
}

const demoUsers: DemoUser[] = [
  { name: '小林', note: '计算机 2024' },
  { name: '阿哲', note: '计算机 2024' },
  { name: '雨晨', note: '设计 2023' },
  { name: '思远', note: '数学 2023' },
  { name: '乐天', note: '经管 2024' },
];

const demoPlans: DemoPlan[] = [
  { user: '小林', weekday: 1, slotLabel: '第1-2节', startWeek: 1, endWeek: 16, parity: 'all', note: '高等数学' },
  { user: '小林', weekday: 3, slotLabel: '第3-4节', startWeek: 1, endWeek: 20, parity: 'all', note: '大学英语' },
  { user: '小林', weekday: 5, slotLabel: '第5-6节', startWeek: 1, endWeek: 8, parity: 'all', note: '物理实验' },
  { user: '阿哲', weekday: 2, slotLabel: '第1-2节', startWeek: 1, endWeek: 16, parity: 'odd', note: '算法设计（单周）' },
  { user: '阿哲', weekday: 4, slotLabel: '第3-4节', startWeek: 1, endWeek: 20, parity: 'all', note: '数据库系统' },
  { user: '阿哲', weekday: 1, slotLabel: '第5-6节', startWeek: 1, endWeek: 16, parity: 'even', note: '体育（双周）' },
  { user: '雨晨', weekday: 1, slotLabel: '第3-4节', startWeek: 1, endWeek: 12, parity: 'all', note: '设计实习' },
  { user: '雨晨', weekday: 3, slotLabel: '第5-6节', startWeek: 1, endWeek: 20, parity: 'all', note: '视觉传达' },
  { user: '雨晨', weekday: 5, slotLabel: '第7-8节', startWeek: 1, endWeek: 16, parity: 'all', note: '项目例会' },
  { user: '思远', weekday: 2, slotLabel: '第3-4节', startWeek: 1, endWeek: 20, parity: 'all', note: '泛函分析' },
  { user: '思远', weekday: 4, slotLabel: '第1-2节', startWeek: 1, endWeek: 16, parity: 'even', note: '助教答疑（双周）' },
  { user: '思远', weekday: 3, slotLabel: '第7-8节', startWeek: 1, endWeek: 18, parity: 'all', note: '体能训练' },
  { user: '乐天', weekday: 1, slotLabel: '第7-8节', startWeek: 1, endWeek: 20, parity: 'all', note: '兼职' },
  { user: '乐天', weekday: 2, slotLabel: '第5-6节', startWeek: 1, endWeek: 16, parity: 'all', note: '创新创业' },
  { user: '乐天', weekday: 4, slotLabel: '第5-6节', startWeek: 1, endWeek: 12, parity: 'odd', note: '社团活动（单周）' },
];

export function seedDemo(): { users: number; schedules: number } {
  const db = getDb();
  const semester = getActiveSemester();
  const slots = getTemplateSlots(semester.activeTemplateId);
  const slotByLabel = new Map(slots.map((slot) => [slot.label, slot]));

  const insertUser = db.prepare(
    'INSERT OR IGNORE INTO app_user (name, color, note, is_active, sort_order) VALUES (?, ?, ?, 1, ?)',
  );
  demoUsers.forEach((user, index) => {
    insertUser.run(user.name, DEFAULT_USER_COLORS[index % DEFAULT_USER_COLORS.length], user.note, index + 1);
  });

  const users = db.prepare('SELECT id, name FROM app_user').all() as { id: number; name: string }[];
  const userIdByName = new Map(users.map((user) => [user.name, Number(user.id)]));

  const insertSchedule = db.prepare(
    'INSERT INTO schedule (semester_id, user_id, weekday, slot_id, start_week, end_week, parity, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  );
  const findSchedule = db.prepare(
    'SELECT id FROM schedule WHERE semester_id = ? AND user_id = ? AND weekday = ? AND slot_id = ? AND start_week = ? AND end_week = ? AND parity = ?',
  );

  let created = 0;
  for (const plan of demoPlans) {
    const userId = userIdByName.get(plan.user);
    const slot = slotByLabel.get(plan.slotLabel);
    if (!userId || !slot) continue;
    const existing = findSchedule.get(
      semester.id,
      userId,
      plan.weekday,
      slot.id,
      plan.startWeek,
      plan.endWeek,
      plan.parity,
    );
    if (existing) continue;

    const result = insertSchedule.run(
      semester.id,
      userId,
      plan.weekday,
      slot.id,
      plan.startWeek,
      plan.endWeek,
      plan.parity,
      plan.note,
    );
    const scheduleId = Number(result.lastInsertRowid);
    refreshOccurrences(
      {
        id: scheduleId,
        semesterId: semester.id,
        userId,
        weekday: plan.weekday,
        slotId: slot.id,
        startWeek: plan.startWeek,
        endWeek: plan.endWeek,
        parity: plan.parity,
      },
      semester.week1Parity,
    );
    created += 1;
  }

  return { users: demoUsers.length, schedules: created };
}

seedDemo();
console.log('[seed] 演示数据已写入：5 位用户与示例安排（已存在的记录会跳过）');
