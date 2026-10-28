import type { FastifyInstance, FastifyRequest } from 'fastify';
import { AppError } from '../lib/errors.ts';
import {
  addAccount,
  ensureAdminAccount,
  latestAdminEmail,
  listAccounts,
  normalizeEmail,
  normalizeRole,
  removeAccount,
  revokeSession,
  sendCode,
  sessionAccount,
  SESSION_SECONDS,
  setAccountRole,
  smtpSendMail,
  verifyCode,
  type AuthSender,
  type SessionAccount,
} from '../services/authService.ts';

export interface InstallAuthOptions {
  sendMail?: AuthSender;
  /** Clock injection for expiry/rate-limit tests, milliseconds since epoch. */
  now?: () => number;
}
const ROOT = '/api/v1/auth';
const COOKIE = 'freeshift_session';
const PUBLIC = new Set(['GET ' + ROOT + '/session', 'POST ' + ROOT + '/send-code', 'POST ' + ROOT + '/verify', 'POST ' + ROOT + '/logout']);
function token(request: FastifyRequest): string | undefined {
  return request.headers.cookie?.split(';').map((part) => part.trim()).find((part) => part.startsWith(COOKIE + '='))?.slice(COOKIE.length + 1);
}
function body(request: FastifyRequest): Record<string, unknown> {
  if (!request.body || typeof request.body !== 'object' || Array.isArray(request.body)) {
    throw new AppError(422, 'VALIDATION_ERROR', '请求体必须为 JSON 对象');
  }
  return request.body as Record<string, unknown>;
}
/** 路径参数中的邮箱（含 %40 等转义），先解码再走 normalizeEmail。 */
function pathEmail(request: FastifyRequest): string {
  const raw = (request.params as { email?: string } | undefined)?.email;
  if (typeof raw !== 'string' || raw === '') throw new AppError(404, 'NOT_FOUND', '该邮箱不在授权列表中');
  try {
    return normalizeEmail(decodeURIComponent(raw));
  } catch (error) {
    if (error instanceof AppError) throw new AppError(404, 'NOT_FOUND', '该邮箱不在授权列表中');
    throw error;
  }
}

/** Call directly on the root Fastify instance before registering any API routes. */
export function installAuth(app: FastifyInstance, options: InstallAuthOptions = {}): void {
  const enabled = process.env.AUTH_ENABLED !== 'false';
  const now = options.now ?? Date.now;
  const sender = options.sendMail ?? smtpSendMail;
  const secure = process.env.AUTH_COOKIE_SECURE === 'true' || (process.env.AUTH_COOKIE_SECURE !== 'false' && process.env.NODE_ENV === 'production');
  const cookie = (value: string, age: number): string => COOKIE + '=' + value + '; Path=/; HttpOnly; SameSite=Lax; Max-Age=' + age + (secure ? '; Secure' : '');
  const current = (request: FastifyRequest): SessionAccount | null => (enabled ? sessionAccount(token(request), now()) : null);
  const requireAdmin = (request: FastifyRequest): SessionAccount => {
    const account = current(request);
    if (!account) throw new AppError(401, 'AUTH_REQUIRED', '请先使用邮箱验证码登录');
    if (account.role !== 'admin') throw new AppError(403, 'FORBIDDEN', '需要管理员权限');
    return account;
  };

  // 内置管理员：不存在则创建，存在但为 member 则提升为 admin（邮箱不落日志）。
  if (enabled) ensureAdminAccount(now());

  app.addHook('onRequest', async (request, reply) => {
    const path = request.url.split('?')[0] ?? '';
    if (path !== '/api' && !path.startsWith('/api/')) return;
    reply.header('Cache-Control', 'no-store');
    if (!enabled) return;
    const mutation = !['GET', 'HEAD', 'OPTIONS'].includes(request.method);
    if (mutation) {
      const origin = request.headers.origin;
      const expected = process.env.APP_ORIGIN ?? request.protocol + '://' + request.host;
      let valid = true;
      if (origin) {
        try { valid = origin !== 'null' && new URL(origin).origin === new URL(expected).origin; } catch { valid = false; }
      }
      if (!valid || request.headers['sec-fetch-site'] === 'cross-site') throw new AppError(403, 'ORIGIN_FORBIDDEN', '请求来源不被允许');
      // 认证相关的写请求必须是 JSON（DELETE 无请求体，不在此列）
      if (path.startsWith(ROOT + '/') && request.method !== 'DELETE' && request.headers['content-type']?.split(';')[0]?.trim().toLowerCase() !== 'application/json') {
        throw new AppError(415, 'JSON_REQUIRED', '请使用 application/json 请求体');
      }
    }
    if (!PUBLIC.has(request.method + ' ' + path) && !sessionAccount(token(request), now())) {
      throw new AppError(401, 'AUTH_REQUIRED', '请先使用邮箱验证码登录');
    }
  });

  app.get(ROOT + '/session', async (request) => {
    const account = current(request);
    return { data: { enabled, email: account?.email ?? null, role: account?.role ?? null } };
  });
  app.post(ROOT + '/send-code', async (request, reply) => {
    if (!enabled) return { data: { enabled: false, email: null, role: null } };
    try { await sendCode(normalizeEmail(body(request).email), request.ip, sender, now()); }
    catch (error) {
      if (error instanceof AppError && error.statusCode === 429) reply.header('Retry-After', String((error.details as { retryAfter: number }).retryAfter));
      throw error;
    }
    return { data: { expiresIn: 600, retryAfter: 60 } };
  });
  app.post(ROOT + '/verify', async (request, reply) => {
    if (!enabled) return { data: { enabled: false, email: null, role: null } };
    const payload = body(request);
    const email = normalizeEmail(payload.email);
    const result = verifyCode(email, payload.code, now());
    reply.header('Set-Cookie', cookie(result.token, SESSION_SECONDS));
    return { data: { enabled: true, email, role: result.role } };
  });
  app.post(ROOT + '/logout', async (request, reply) => {
    if (enabled) revokeSession(token(request));
    reply.header('Set-Cookie', cookie('', 0));
    return { data: { enabled, email: null, role: null } };
  });

  // ---- 访问授权（仅管理员）----
  app.get(ROOT + '/accounts', async (request) => {
    requireAdmin(request);
    return { data: { accounts: listAccounts(), adminEmail: latestAdminEmail() } };
  });
  app.post(ROOT + '/accounts', async (request, reply) => {
    const caller = requireAdmin(request);
    const payload = body(request);
    const { account } = addAccount(payload.email, payload.role, caller.email, now());
    reply.status(201);
    return { data: { account } };
  });
  app.patch(ROOT + '/accounts/:email', async (request) => {
    const caller = requireAdmin(request);
    const account = setAccountRole(pathEmail(request), normalizeRole(body(request).role, 'member'), caller.email);
    return { data: { account } };
  });
  app.delete(ROOT + '/accounts/:email', async (request) => {
    const caller = requireAdmin(request);
    return { data: { removed: removeAccount(pathEmail(request), caller.email) } };
  });
}
