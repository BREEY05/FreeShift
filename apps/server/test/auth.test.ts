import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { installAuth } from '../src/routes/auth.ts';
import { AppError } from '../src/lib/errors.ts';
import { closeDb, get } from '../src/db/index.ts';
import type { AuthMail } from '../src/services/authService.ts';

let app: FastifyInstance;
let clock: number;
let messages: AuthMail[];
const ROOT = '/api/v1/auth';
function makeApp(enabled = true, failing = false): FastifyInstance {
  vi.stubEnv('AUTH_ENABLED', enabled ? 'true' : 'false');
  const instance = Fastify();
  instance.setErrorHandler((error, _request, reply) => {
    if (error instanceof AppError) return reply.code(error.statusCode).send({ error: { code: error.code, details: error.details } });
    const failure = error as { statusCode?: number; code?: string };
    return reply.code(failure.statusCode ?? 500).send({ error: { code: failure.code } });
  });
  installAuth(instance, { now: () => clock, sendMail: async (mail) => {
    if (failing) throw new Error('secret SMTP password');
    messages.push(mail);
  } });
  instance.get('/api/v1/private', async () => ({ data: 'shared workspace' }));
  instance.post('/api/v1/private', async () => ({ data: 'updated' }));
  instance.get('/healthz', async () => ({ ok: true }));
  return instance;
}
const send = (email = 'Person@Example.com') => app.inject({ method: 'POST', url: ROOT + '/send-code', payload: { email } });
const code = () => messages[messages.length - 1]!.text.match(/\d{6}/)![0];
const verify = (value = code(), email = 'person@example.com') => app.inject({ method: 'POST', url: ROOT + '/verify', payload: { email, code: value } });
beforeEach(() => {
  closeDb();
  vi.stubEnv('DATABASE_PATH', ':memory:');
  vi.stubEnv('APP_ORIGIN', 'https://freeshift.example');
  vi.stubEnv('AUTH_COOKIE_SECURE', 'true');
  clock = 1_800_000_000_000;
  messages = [];
  app = makeApp();
});
afterEach(async () => { await app.close(); closeDb(); vi.unstubAllEnvs(); });

describe('email authentication', () => {
  it('protects the API, exposes public session and health, and does not bypass prefixes', async () => {
    expect((await app.inject(ROOT + '/session')).json()).toEqual({ data: { enabled: true, email: null } });
    expect((await app.inject('/api/v1/private')).statusCode).toBe(401);
    expect((await app.inject(ROOT + '/session/extra')).statusCode).toBe(401);
    expect((await app.inject('/healthz')).statusCode).toBe(200);
  });
  it('normalizes identities, hashes credentials, creates sessions, consumes OTP, and revokes logout', async () => {
    expect((await send()).json()).toEqual({ data: { expiresIn: 600, retryAfter: 60 } });
    const otp = get<{ code_hash: string; salt: string }>('SELECT * FROM auth_otp')!;
    expect(otp.code_hash).not.toContain(code());
    const response = await verify();
    expect(response.json()).toEqual({ data: { enabled: true, email: 'person@example.com' } });
    const header = String(response.headers['set-cookie']);
    expect(header).toContain('HttpOnly; SameSite=Lax; Max-Age=2592000; Secure');
    const cookie = header.split(';')[0]!;
    const stored = get<{ token_hash: string }>('SELECT * FROM auth_session')!;
    expect(stored.token_hash).not.toBe(cookie.split('=')[1]);
    expect((await app.inject({ url: '/api/v1/private', headers: { cookie } })).statusCode).toBe(200);
    expect((await app.inject({ url: ROOT + '/session', headers: { cookie } })).json().data.email).toBe('person@example.com');
    expect((await verify()).statusCode).toBe(401);
    const logout = await app.inject({ method: 'POST', url: ROOT + '/logout', headers: { cookie }, payload: {} });
    expect(String(logout.headers['set-cookie'])).toContain('Max-Age=0');
    expect((await app.inject({ url: '/api/v1/private', headers: { cookie } })).statusCode).toBe(401);
    expect(get('SELECT * FROM app_user')).toBeUndefined();
  });
  it('locks OTP after five failed attempts and expires codes after ten minutes', async () => {
    await send();
    const correct = code();
    const wrong = correct === '000000' ? '000001' : '000000';
    for (let n = 0; n < 5; n++) expect((await verify(wrong)).statusCode).toBe(401);
    expect((await verify(correct)).statusCode).toBe(401);
    clock += 60_000;
    await send();
    clock += 600_000;
    expect((await verify()).statusCode).toBe(401);
  });
  it('expires sessions after thirty days and rejects forged tokens', async () => {
    await send();
    const response = await verify();
    const cookie = String(response.headers['set-cookie']).split(';')[0]!;
    clock += 30 * 24 * 60 * 60 * 1000;
    expect((await app.inject({ url: '/api/v1/private', headers: { cookie } })).statusCode).toBe(401);
    expect((await app.inject({ url: '/api/v1/private', headers: { cookie: 'freeshift_session=forged' } })).statusCode).toBe(401);
  });
  it('persists email cooldown and hourly email and IP limits across app recreation', async () => {
    await send();
    await app.close();
    app = makeApp();
    const limited = await send();
    expect(limited.statusCode).toBe(429);
    expect(limited.headers['retry-after']).toBe('60');
    for (let n = 1; n < 5; n++) { clock += 60_000; expect((await send()).statusCode).toBe(200); }
    clock += 60_000;
    expect((await send()).statusCode).toBe(429);
    for (let n = 0; n < 15; n++) expect((await send('other' + n + '@example.com')).statusCode).toBe(200);
    expect((await send('blocked@example.com')).statusCode).toBe(429);
    clock += 3_600_000;
    expect((await send()).statusCode).toBe(200);
  });
  it('rejects foreign origins and non-JSON auth bodies before sending', async () => {
    expect((await app.inject({ method: 'POST', url: ROOT + '/send-code', headers: { origin: 'https://evil.example' }, payload: { email: 'person@example.com' } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: ROOT + '/send-code', headers: { 'content-type': 'text/plain' }, payload: '{}' })).statusCode).toBe(415);
    expect((await app.inject({ method: 'POST', url: ROOT + '/send-code', payload: { email: 'invalid' } })).statusCode).toBe(422);
    expect(messages).toHaveLength(0);
    await send();
    const cookie = String((await verify()).headers['set-cookie']).split(';')[0]!;
    expect((await app.inject({ method: 'POST', url: '/api/v1/private', headers: { cookie, origin: 'https://evil.example' }, payload: {} })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: '/api/v1/private', headers: { cookie, origin: 'https://freeshift.example' }, payload: {} })).statusCode).toBe(200);
  });
  it('sanitizes mail failures and invalidates an undelivered OTP', async () => {
    await app.close(); app = makeApp(true, true);
    const response = await send();
    expect(response.statusCode).toBe(503);
    expect(response.body).not.toContain('secret');
    expect(get('SELECT * FROM auth_otp')).toBeUndefined();
  });
  it('allows offline access without invoking the sender', async () => {
    await app.close(); app = makeApp(false, true);
    expect((await app.inject(ROOT + '/session')).json()).toEqual({ data: { enabled: false, email: null } });
    expect((await app.inject('/api/v1/private')).statusCode).toBe(200);
    expect((await send()).statusCode).toBe(200);
    expect(messages).toHaveLength(0);
  });
});
