import type { ImportResult } from '@freeshift/shared';
import { API_BASE, ApiError, api, type ApiErrorPayload } from './client';

export interface MetaInfo {
  version: string;
  db: string;
  timezone: string;
}

function buildQuery(params: Record<string, number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    search.set(key, String(value));
  }
  const query = search.toString();
  return query ? '?' + query : '';
}

/** 安排 CSV 下载地址（直接给 <a href> 使用，服务端附带 Content-Disposition） */
export function schedulesExportUrl(fromWeek?: number, toWeek?: number): string {
  return API_BASE + '/export/schedules' + buildQuery({ from_week: fromWeek, to_week: toWeek });
}

/** 某周聚合看板 CSV 下载地址 */
export function boardExportUrl(week?: number): string {
  return API_BASE + '/export/board' + buildQuery({ week });
}

async function parseJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

/** 导入安排 CSV：api client 只支持 JSON，这里直接发 text/csv 文本 */
export async function importSchedulesCsv(csvText: string, dryRun: boolean): Promise<ImportResult> {
  const response = await fetch(API_BASE + '/import/schedules' + (dryRun ? '?dry_run=1' : ''), {
    method: 'POST',
    headers: { 'Content-Type': 'text/csv' },
    body: csvText,
  });
  const payload = await parseJson(response);
  if (!response.ok) {
    const errorPayload = (payload as { error?: ApiErrorPayload } | null)?.error;
    throw new ApiError(
      response.status,
      errorPayload ?? { code: 'IMPORT_FAILED', message: '导入失败（' + response.status + '）' },
    );
  }
  return (payload as { data: ImportResult } | null)?.data as ImportResult;
}

/** GET /meta：版本、数据库类型、时区 */
export function fetchMetaInfo(): Promise<MetaInfo> {
  return api.get<MetaInfo>('/meta');
}
