export interface AuthSession {
  enabled: boolean;
  email: string | null;
}

export class AuthRequestError extends Error {
  constructor(message: string, readonly retryAfter = 0) {
    super(message);
    this.name = 'AuthRequestError';
  }
}

async function request<T>(path: string, body?: object, signal?: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await fetch('/api/v1/auth/' + path, {
      method: body === undefined ? 'GET' : 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      signal,
      headers: body === undefined ? { Accept: 'application/json' } : { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new AuthRequestError('暂时无法连接服务，请检查网络后重试。');
  }
  const payload = await response.json().catch(() => null) as { data?: T; error?: { message?: string; details?: { retryAfter?: number } } } | null;
  if (!response.ok) {
    const retryAfter = Number(response.headers.get('Retry-After') ?? payload?.error?.details?.retryAfter ?? 0);
    throw new AuthRequestError(payload?.error?.message || '请求未完成，请稍后重试。', Number.isFinite(retryAfter) ? retryAfter : 0);
  }
  if (payload?.data === undefined) throw new AuthRequestError('服务响应异常，请稍后重试。');
  return payload.data;
}

function validateSession(session: AuthSession): AuthSession {
  if (typeof session?.enabled !== 'boolean' || (session.email !== null && typeof session.email !== 'string')) {
    throw new AuthRequestError('会话响应异常，请重试。');
  }
  return session;
}

export const authApi = {
  async session(signal?: AbortSignal) { return validateSession(await request<AuthSession>('session', undefined, signal)); },
  sendCode(email: string) { return request<{ expiresIn: number; retryAfter: number }>('send-code', { email }); },
  async verify(email: string, code: string) { return validateSession(await request<AuthSession>('verify', { email, code })); },
  logout() { return request<unknown>('logout', {}); },
};
