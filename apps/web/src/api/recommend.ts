import type {
  AlternativesInput,
  AlternativesResult,
  CommonFreeInput,
  DayPart,
  FactorScores,
  FreeBlock,
  RecommendConfig,
  ScoredCell,
  ScoredInput,
} from '@freeshift/shared';
import { api } from './client';

export const recommendKeys = {
  all: ['recommend'] as const,
  commonFree: (week: number | undefined, userIds: number[], topK: number, requireTimeAdjacent: boolean) =>
    ['recommend', 'common-free', week ?? 'current', userIds.join(','), topK, requireTimeAdjacent] as const,
  scored: (
    week: number | undefined,
    userIds: number[],
    filters: ScoredInput['filters'],
    topK: number,
  ) => ['recommend', 'scored', week ?? 'current', userIds.join(','), filters ?? {}, topK] as const,
  config: () => ['recommend', 'config'] as const,
};

export async function fetchCommonFree(input: CommonFreeInput): Promise<FreeBlock[]> {
  const data = await api.post<{ blocks: FreeBlock[] }>('/recommend/common-free', input);
  return data.blocks;
}

export async function fetchScoredCells(input: ScoredInput): Promise<ScoredCell[]> {
  const data = await api.post<{ cells: ScoredCell[] }>('/recommend/scored', input);
  return data.cells;
}

export function fetchAlternatives(input: AlternativesInput): Promise<AlternativesResult> {
  return api.post<AlternativesResult>('/recommend/alternatives', input);
}

export interface RecommendConfigInput {
  weights?: Partial<FactorScores>;
  dayPart?: Partial<Record<DayPart, number>>;
  historyWeeks?: number;
  recentWindow?: number;
}

export function fetchRecommendConfig(): Promise<RecommendConfig> {
  return api.get<RecommendConfig>('/recommend/config');
}

/** 权重由服务端自动归一化后存储 */
export function saveRecommendConfig(input: RecommendConfigInput): Promise<RecommendConfig> {
  return api.put<RecommendConfig>('/recommend/config', input);
}
