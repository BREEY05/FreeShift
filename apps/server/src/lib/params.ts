import { AppError } from './errors.ts';

export function toId(value: unknown, name = 'id'): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new AppError(422, 'VALIDATION_ERROR', name + ' 必须为正整数');
  }
  return parsed;
}

export function toInt(value: unknown, fallback: number): number;
export function toInt(value: unknown, fallback?: number): number | undefined;
export function toInt(value: unknown, fallback?: number): number | undefined {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    throw new AppError(422, 'VALIDATION_ERROR', '参数必须为整数：' + String(value));
  }
  return parsed;
}

export function toBool(value: unknown): boolean | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (value === true || value === '1' || value === 'true') return true;
  if (value === false || value === '0' || value === 'false') return false;
  return undefined;
}
