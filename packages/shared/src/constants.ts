import type { DayPart, FactorScores, Parity, RecommendConfig, Weekday } from './types.js';

export const WEEKDAY_LABELS: Record<Weekday, string> = {
  1: '周一',
  2: '周二',
  3: '周三',
  4: '周四',
  5: '周五',
  6: '周六',
  7: '周日',
};

export const WEEKDAY_ORDER: Weekday[] = [1, 2, 3, 4, 5, 6, 7];

export const DAY_PART_LABELS: Record<DayPart, string> = {
  morning: '上午',
  afternoon: '下午',
  evening: '晚上',
};

export const PARITY_LABELS: Record<Parity, string> = {
  all: '每周',
  odd: '单周',
  even: '双周',
};

export const WEEK_PARITY_LABELS: Record<'odd' | 'even', string> = {
  odd: '单周',
  even: '双周',
};

export const MAX_TOTAL_WEEKS = 60;

export const DEFAULT_FACTOR_WEIGHTS: FactorScores = {
  freeRatio: 0.35,
  continuity: 0.25,
  history: 0.2,
  friendliness: 0.1,
  recentLoad: 0.1,
};

export const FACTOR_LABELS: Record<keyof FactorScores, string> = {
  freeRatio: '空闲占比',
  continuity: '连续时长',
  history: '历史偏好',
  friendliness: '时段友好度',
  recentLoad: '近期负载',
};

export const DEFAULT_DAY_PART_SCORES: Record<DayPart, number> = {
  morning: 0.9,
  afternoon: 0.8,
  evening: 0.5,
};

export const DEFAULT_RECOMMEND_CONFIG: RecommendConfig = {
  weights: DEFAULT_FACTOR_WEIGHTS,
  dayPart: DEFAULT_DAY_PART_SCORES,
  historyWeeks: 4,
  recentWindow: 1,
};

export const DEFAULT_USER_COLORS = [
  '#4F46E5',
  '#0EA5E9',
  '#0F766E',
  '#D97706',
  '#DB2777',
  '#7C3AED',
  '#059669',
  '#DC2626',
];

export const PRESET_TEMPLATE_NAMES = {
  AUTUMN_COURSE: '大学课表（秋）',
  TWO_PERIODS: '大学两节连排',
  SINGLE_PERIODS: '大学小节',
  HALF_DAY: '半天制',
  EMPTY: '空白模板',
} as const;
