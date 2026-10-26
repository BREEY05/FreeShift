export interface HeatTier {
  /** 图例说明 */
  label: string;
  background: string;
  border: string;
  text: string;
}

/**
 * 5 档空闲热度：0 人灰 → 部分空闲浅青 → 全员空闲深青。
 * 最后一档单独表示“全员空闲”，避免小团体（如 5 人）下 4/5 与 5/5 无法区分。
 */
export const HEAT_TIERS: readonly HeatTier[] = [
  { label: '无空闲', background: '#F3F4F6', border: '#E6E8EC', text: '#6B7280' },
  { label: '<50%', background: '#ECFDF5', border: '#D1FAE5', text: '#065F46' },
  { label: '50-75%', background: '#D1FAE5', border: '#A7F3D0', text: '#065F46' },
  { label: '75-100%', background: '#A7F3D0', border: '#6EE7B7', text: '#065F46' },
  { label: '全员空闲', background: '#6EE7B7', border: '#34D399', text: '#065F46' },
] as const;

export type HeatLevel = 0 | 1 | 2 | 3 | 4;

export function heatLevelOf(freeCount: number, totalUsers: number): HeatLevel {
  if (totalUsers <= 0 || freeCount <= 0) return 0;
  if (freeCount >= totalUsers) return 4;
  const ratio = freeCount / totalUsers;
  if (ratio < 0.5) return 1;
  if (ratio < 0.75) return 2;
  return 3;
}

export function heatTierOf(freeCount: number, totalUsers: number): HeatTier {
  return HEAT_TIERS[heatLevelOf(freeCount, totalUsers)];
}

/** #RRGGBB + alpha -> rgba() */
export function withAlpha(hex: string, alpha: number): string {
  const normalized = /^#([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!normalized) return 'rgba(79, 70, 229, ' + alpha + ')';
  const value = normalized[1];
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return 'rgba(' + r + ', ' + g + ', ' + b + ', ' + alpha + ')';
}

/** 用户色作为浅底（用于个人视图/头像） */
export function userSoftBackground(color: string | undefined): string {
  if (!color) return 'rgba(79, 70, 229, 0.12)';
  return withAlpha(color, 0.12);
}

export function userInitial(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return '?';
  return trimmed.slice(0, 1).toUpperCase();
}