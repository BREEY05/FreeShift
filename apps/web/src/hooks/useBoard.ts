import type { Schedule } from '@freeshift/shared';
import { useQuery } from '@tanstack/react-query';
import { fetchAggregateBoard, fetchPersonalBoard } from '../api/board';
import { fetchSchedules } from '../api/schedules';

export const boardKeys = {
  all: ['board'] as const,
  aggregate: (week: number | null) => ['board', 'aggregate', week ?? 'current'] as const,
  personal: (userId: number | null, week: number | null) =>
    ['board', 'personal', userId ?? 'none', week ?? 'current'] as const,
  weekSchedules: (week: number | null) => ['schedules', 'week', week ?? 'current'] as const,
};

/** 聚合看板：一次请求拿到整周网格 */
export function useAggregateBoard(week: number | null) {
  return useQuery({
    queryKey: boardKeys.aggregate(week),
    queryFn: () => fetchAggregateBoard({ week: week ?? undefined }),
    staleTime: 15_000,
  });
}

/** 个人看板（未选人时不请求） */
export function usePersonalBoard(userId: number | null, week: number | null) {
  return useQuery({
    queryKey: boardKeys.personal(userId, week),
    queryFn: () => fetchPersonalBoard(userId as number, week ?? undefined),
    enabled: userId !== null,
    staleTime: 15_000,
  });
}

/** 某一周的原始安排（用于抽屉里的备注） */
export function useWeekSchedules(week: number | null) {
  return useQuery({
    queryKey: boardKeys.weekSchedules(week),
    queryFn: async (): Promise<Schedule[]> => {
      if (week === null) return [];
      return fetchSchedules({ fromWeek: week, toWeek: week });
    },
    enabled: week !== null,
    staleTime: 30_000,
    retry: false,
  });
}
