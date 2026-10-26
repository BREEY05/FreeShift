import type {
  BatchScheduleInput,
  BatchScheduleResult,
  ConflictCheckInput,
  ConflictDetail,
  Schedule,
  ScheduleInput,
  Weekday,
} from '@freeshift/shared';
import { api } from './client';

export function createSchedule(input: ScheduleInput): Promise<Schedule> {
  return api.post<Schedule>('/schedules', input);
}

export function updateSchedule(id: number, input: Partial<ScheduleInput>): Promise<Schedule> {
  return api.patch<Schedule>('/schedules/' + id, input);
}

export function deleteSchedule(id: number): Promise<void> {
  return api.delete('/schedules/' + id);
}

export function fetchSchedule(id: number): Promise<Schedule> {
  return api.get<Schedule>('/schedules/' + id);
}

export interface ScheduleQuery {
  userId?: number;
  fromWeek?: number;
  toWeek?: number;
  weekday?: Weekday;
}

export async function fetchSchedules(query: ScheduleQuery = {}): Promise<Schedule[]> {
  const data = await api.get<{ schedules: Schedule[] }>('/schedules', {
    user_id: query.userId,
    from_week: query.fromWeek,
    to_week: query.toWeek,
    weekday: query.weekday,
  });
  return data.schedules;
}

export function batchSchedules(input: BatchScheduleInput): Promise<BatchScheduleResult> {
  return api.post<BatchScheduleResult>('/schedules/batch', input);
}

/** 保存前预检冲突（不写库） */
export async function checkConflicts(input: ConflictCheckInput): Promise<ConflictDetail[]> {
  const data = await api.post<{ conflicts: ConflictDetail[] }>('/schedules/check', input);
  return data.conflicts;
}
