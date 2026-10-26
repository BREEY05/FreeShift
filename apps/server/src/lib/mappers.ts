import type { AppUser, Schedule, Semester, SlotTemplate, TimeSlot, WeekParity } from '@freeshift/shared';

export interface SemesterRow {
  id: number;
  name: string;
  start_date: string;
  total_weeks: number;
  week1_parity: WeekParity;
  active_template_id: number | null;
  is_active: number;
  created_at: string;
  updated_at: string;
}

export interface TemplateRow {
  id: number;
  name: string;
  description: string;
  is_preset: number;
  created_at: string;
  slot_count?: number;
  is_active?: number;
}

export interface SlotRow {
  id: number;
  template_id: number;
  label: string;
  start_time: string | null;
  end_time: string | null;
  day_part: 'morning' | 'afternoon' | 'evening';
  duration_min: number;
  sort_order: number;
}

export interface UserRow {
  id: number;
  name: string;
  color: string;
  note: string;
  is_active: number;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface ScheduleRow {
  id: number;
  semester_id: number;
  user_id: number;
  weekday: number;
  slot_id: number;
  start_week: number;
  end_week: number;
  parity: 'all' | 'odd' | 'even';
  note: string;
  created_at: string;
  updated_at: string;
}

export function mapSemester(row: SemesterRow): Semester {
  return {
    id: Number(row.id),
    name: row.name,
    startDate: row.start_date,
    totalWeeks: Number(row.total_weeks),
    week1Parity: row.week1_parity,
    activeTemplateId: row.active_template_id === null ? null : Number(row.active_template_id),
    isActive: Number(row.is_active) === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapTemplate(row: TemplateRow): SlotTemplate {
  return {
    id: Number(row.id),
    name: row.name,
    description: row.description,
    isPreset: Number(row.is_preset) === 1,
    slotCount: Number(row.slot_count ?? 0),
    isActive: Number(row.is_active ?? 0) === 1,
    createdAt: row.created_at,
  };
}

export function mapSlot(row: SlotRow): TimeSlot {
  return {
    id: Number(row.id),
    templateId: Number(row.template_id),
    label: row.label,
    startTime: row.start_time,
    endTime: row.end_time,
    dayPart: row.day_part,
    durationMin: Number(row.duration_min),
    sortOrder: Number(row.sort_order),
  };
}

export function mapUser(row: UserRow): AppUser {
  return {
    id: Number(row.id),
    name: row.name,
    color: row.color,
    note: row.note,
    isActive: Number(row.is_active) === 1,
    sortOrder: Number(row.sort_order),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapSchedule(row: ScheduleRow): Schedule {
  return {
    id: Number(row.id),
    semesterId: Number(row.semester_id),
    userId: Number(row.user_id),
    weekday: Number(row.weekday) as Schedule['weekday'],
    slotId: Number(row.slot_id),
    startWeek: Number(row.start_week),
    endWeek: Number(row.end_week),
    parity: row.parity,
    note: row.note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
