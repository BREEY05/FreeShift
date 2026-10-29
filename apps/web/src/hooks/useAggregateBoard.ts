import { useQuery } from '@tanstack/react-query';
import { fetchAggregateBoard } from '../api/board';

export const aggregateBoardKeys = {
  all: ['board', 'aggregate'] as const,
  byWeek: (week: number | null, userIds: number[] | null) =>
    ['board', 'aggregate', week ?? 'current', userIds && userIds.length > 0 ? userIds.join(',') : 'all'] as const,
};

/** 聚合看板：可限定成员范围（同步成员），未限定时展示组织内全部成员 */
export function useAggregateBoardWithin(week: number | null, userIds: number[] | null) {
  return useQuery({
    queryKey: aggregateBoardKeys.byWeek(week, userIds),
    queryFn: () => fetchAggregateBoard({ week: week ?? undefined, userIds: userIds ?? undefined }),
    staleTime: 15_000,
  });
}
