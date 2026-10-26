import type { FairnessReport } from '@freeshift/shared';
import { api } from './client';

export const statsKeys = {
  all: ['stats'] as const,
  fairness: (fromWeek: number | undefined, toWeek: number | undefined) =>
    ['stats', 'fairness', fromWeek ?? 'all', toWeek ?? 'all'] as const,
};

export function fetchFairness(fromWeek?: number, toWeek?: number): Promise<FairnessReport> {
  return api.get<FairnessReport>('/stats/fairness', { from_week: fromWeek, to_week: toWeek });
}
