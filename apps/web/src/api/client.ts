export const API_BASE = '/api/v1';

export interface ApiErrorPayload {
  code: string;
  message: string;
  details?: unknown;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, body: ApiErrorPayload) {
    super(body.message);
    this.name = 'ApiError';
    this.status = status;
    this.code = body.code;
    this.details = body.details;
  }
}

type QueryValue = string | number | boolean | null | undefined;
export type QueryParams = Record<string, QueryValue | QueryValue[]>;

function buildQuery(params?: QueryParams): string {
  if (!params) return '';
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) {
      const items = value.filter((item) => item !== undefined && item !== null && item !== '');
      if (items.length > 0) search.set(key, items.join(','));
    } else {
      search.set(key, String(value));
    }
  }
  const query = search.toString();
  return query ? '?' + query : '';
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(API_BASE + path, {
    ...init,
    headers: {
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers ?? {}),
    },
  });

  const text = await response.text();
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }

  if (!response.ok) {
    if (response.status === 401) window.dispatchEvent(new Event('freeshift:unauthorized'));
    const errorPayload = (payload as { error?: ApiErrorPayload } | null)?.error;
    throw new ApiError(
      response.status,
      errorPayload ?? { code: 'NETWORK_ERROR', message: '请求失败（' + response.status + '）' },
    );
  }

  return (payload as { data?: T } | null)?.data as T;
}

export const api = {
  get<T>(path: string, params?: QueryParams): Promise<T> {
    return request<T>(path + buildQuery(params));
  },
  post<T>(path: string, body?: unknown): Promise<T> {
    return request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });
  },
  put<T>(path: string, body?: unknown): Promise<T> {
    return request<T>(path, { method: 'PUT', body: body === undefined ? undefined : JSON.stringify(body) });
  },
  patch<T>(path: string, body?: unknown): Promise<T> {
    return request<T>(path, { method: 'PATCH', body: body === undefined ? undefined : JSON.stringify(body) });
  },
  delete<T = void>(path: string): Promise<T> {
    return request<T>(path, { method: 'DELETE' });
  },
};
