import type { FastifyInstance, FastifyRequest } from 'fastify';
import { AppError } from '../lib/errors.ts';
import { normalizeEmail, revokeSession, sendCode, sessionEmail, SESSION_SECONDS, smtpSendMail, verifyCode, type AuthSender } from '../services/authService.ts';

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

/** Call directly on the root Fastify instance before registering any API routes. */
export function installAuth(app: FastifyInstance, options: InstallAuthOptions = {}): void {
  const enabled = process.env.AUTH_ENABLED !== 'false';
  const now = options.now ?? Date.now;
  const sender = options.sendMail ?? smtpSendMail;
  const secure = process.env.AUTH_COOKIE_SECURE === 'true' || (process.env.AUTH_COOKIE_SECURE !== 'false' && process.env.NODE_ENV === 'production');
  const cookie = (value: string, age: number): string => COOKIE + '=' + value + '; Path=/; HttpOnly; SameSite=Lax; Max-Age=' + age + (secure ? '; Secure' : '');
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
      if (PUBLIC.has(request.method + ' ' + path) && request.headers['content-type']?.split(';')[0]?.trim().toLowerCase() !== 'application/json') {
        throw new AppError(415, 'JSON_REQUIRED', '请使用 application/json 请求体');
      }
    }
    if (!PUBLIC.has(request.method + ' ' + path) && !sessionEmail(token(request), now())) {
      throw new AppError(401, 'AUTH_REQUIRED', '请先使用邮箱验证码登录');
    }
  });
  app.get(ROOT + '/session', async (request) => ({ data: { enabled, email: enabled ? sessionEmail(token(request), now()) : null } }));
  app.post(ROOT + '/send-code', async (request, reply) => {
    if (!enabled) return { data: { enabled: false, email: null } };
    try { await sendCode(normalizeEmail(body(request).email), request.ip, sender, now()); }
    catch (error) {
      if (error instanceof AppError && error.statusCode === 429) reply.header('Retry-After', String((error.details as { retryAfter: number }).retryAfter));
      throw error;
    }
    return { data: { expiresIn: 600, retryAfter: 60 } };
  });
  app.post(ROOT + '/verify', async (request, reply) => {
    if (!enabled) return { data: { enabled: false, email: null } };
    const payload = body(request);
    const email = normalizeEmail(payload.email);
    const value = verifyCode(email, payload.code, now());
    reply.header('Set-Cookie', cookie(value, SESSION_SECONDS));
    return { data: { enabled: true, email } };
  });
  app.post(ROOT + '/logout', async (request, reply) => {
    if (enabled) revokeSession(token(request));
    reply.header('Set-Cookie', cookie('', 0));
    return { data: { enabled, email: null } };
  });
}
