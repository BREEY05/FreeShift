import type { AuthRole } from '../auth/api';
import { ApiError, type ApiErrorPayload } from './client';

export interface AccessAccount {
  email: string;
  role: AuthRole;
  createdAt: number | null;
  lastLoginAt: number | null;
}

export interface AccessAccountList {
  accounts: AccessAccount[];
  adminEmail: string;
}

/** 账户列表查询键：['auth-accounts'] 前缀便于统一失效 */
export const authAccountKeys = {
  all: ['auth-accounts'] as const,
  list: () => ['auth-accounts', 'list'] as const,
};

function filterValue(value: unknown): string {
  return encodeURIComponent(typeof value === 'string' ? value : String(value ?? ''));
}

/**
 * 访问授权 API。沿用 client.ts 的约定：同源、携带 Cookie、禁用缓存、JSON 响应，
 * 错误封装为 {error:{code,message,details}}，这里统一抛出 ApiError 以便复用 getErrorMessage。
 */
async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch('/api/v1/auth/accounts' + path, {
      credentials: 'same-origin',
      cache: 'no-store',
      ...init,
      headers: {
        Accept: 'application/json',
        ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(init.headers ?? {}),
      },
    });
  } catch {
    throw new ApiError(0, { code: 'NETWORK_ERROR', message: '网络异常，请稍后重试' });
  }

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

/** 授权账户列表 + 当前管理员邮箱 */
export async function fetchAccessAccounts(signal?: AbortSignal): Promise<AccessAccountList> {
  const data = await request<{ accounts: AccessAccount[]; adminEmail: string }>('', { method: 'GET', signal });
  return {
    accounts: Array.isArray(data?.accounts) ? data.accounts : [],
    adminEmail: typeof data?.adminEmail === 'string' ? data.adminEmail : '',
  };
}

/** 新增授权邮箱（添加即视为已验证可用） */
export async function addAccessAccount(email: string, role: AuthRole): Promise<AccessAccount> {
  const data = await request<{ account: AccessAccount }>('', {
    method: 'POST',
    body: JSON.stringify({ email, role }),
  });
  return data.account;
}

/** 修改角色（设为管理员 / 设为成员） */
export async function setAccessAccountRole(email: string, role: AuthRole): Promise<AccessAccount> {
  const data = await request<{ account: AccessAccount }>('/' + filterValue(email), {
    method: 'PATCH',
    body: JSON.stringify({ role }),
  });
  return data.account;
}

/** 移除授权 */
export async function removeAccessAccount(email: string): Promise<string> {
  const data = await request<{ removed: string }>('/' + filterValue(email), { method: 'DELETE' });
  return data.removed;
}
