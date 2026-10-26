import type { BatchScheduleInput, Schedule, ScheduleInput } from '@freeshift/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';
import { batchSchedules, createSchedule, deleteSchedule, updateSchedule } from '../api/schedules';

export interface ScheduleActions {
  create: (input: ScheduleInput) => Promise<Schedule>;
  update: (id: number, input: Partial<ScheduleInput>) => Promise<Schedule>;
  remove: (id: number) => Promise<void>;
  batch: (input: BatchScheduleInput) => Promise<Awaited<ReturnType<typeof batchSchedules>>>;
  invalidate: () => void;
}

/**
 * 安排写操作统一入口：写入成功后刷新看板与安排相关查询。
 */
export function useScheduleActions(): ScheduleActions {
  const queryClient = useQueryClient();

  const invalidate = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: boardInvalidationKeys.boards });
    // 只刷新按周拉取的安排列表，避免失效已删除安排的详情查询
    void queryClient.invalidateQueries({ queryKey: boardInvalidationKeys.weekSchedules });
  }, [queryClient]);

  return useMemo<ScheduleActions>(
    () => ({
      create: async (input) => {
        const schedule = await createSchedule(input);
        invalidate();
        return schedule;
      },
      update: async (id, input) => {
        const schedule = await updateSchedule(id, input);
        invalidate();
        return schedule;
      },
      remove: async (id) => {
        await deleteSchedule(id);
        invalidate();
      },
      batch: async (input) => {
        const result = await batchSchedules(input);
        invalidate();
        return result;
      },
      invalidate,
    }),
    [invalidate],
  );
}

/** queryKey 前缀（与 useBoard 中的 key 对齐） */
const boardInvalidationKeys = {
  boards: ['board'] as const,
  weekSchedules: ['schedules', 'week'] as const,
};
