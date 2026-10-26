import type { ConflictDetail } from '@freeshift/shared';
import { ApiError } from '../api/client';

export interface ValidationIssue {
  path: string;
  message: string;
}

/** 把任意异常转成用户可读的中文提示 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (Array.isArray(error.details)) {
      const issues = error.details as Array<{ path?: unknown; message?: unknown }>;
      const parts = issues
        .map((item) => {
          const path = typeof item?.path === 'string' ? item.path : '';
          const message = typeof item?.message === 'string' ? item.message : '';
          if (!message) return '';
          return path ? path + '：' + message : message;
        })
        .filter(Boolean);
      if (parts.length > 0) return parts.join('；');
    }
    return error.message || '请求失败（' + error.status + '）';
  }
  if (error instanceof Error && error.message) return error.message;
  return '网络异常，请稍后重试';
}

/** 409 冲突明细（ConflictDetail[]），不是冲突时返回 null */
export function getConflictDetails(error: unknown): ConflictDetail[] | null {
  if (error instanceof ApiError && error.status === 409 && Array.isArray(error.details)) {
    return error.details as ConflictDetail[];
  }
  return null;
}

/** 422 校验错误拆成字段级错误，key 取 path 最后一段（如 startWeek） */
export function getFieldErrors(error: unknown): Record<string, string> {
  const result: Record<string, string> = {};
  if (!(error instanceof ApiError) || !Array.isArray(error.details)) return result;
  const issues = error.details as Array<{ path?: unknown; message?: unknown }>;
  for (const issue of issues) {
    if (typeof issue?.path !== 'string' || typeof issue.message !== 'string') continue;
    const segments = issue.path.split('.');
    const key = segments[segments.length - 1] || issue.path;
    result[key] = issue.message;
  }
  return result;
}

/** 是否是 409 冲突 */
export function isConflictError(error: unknown): boolean {
  return error instanceof ApiError && error.status === 409;
}
