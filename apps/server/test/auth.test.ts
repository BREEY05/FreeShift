import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { installAuth } from '../src/routes/auth.ts';
import { AppError } from '../src/lib/errors.ts';
import { closeDb, get, run } from '../src/db/index.ts';
import type { AuthMail } from '../src/services/authService.ts';

let app: FastifyInstance;
let clock: number;
let messages: AuthMail[];
const ROOT = '/api/v1/auth';
const ADMIN = '380154843@qq.com';
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
/** 直接写库加白名单（管理员通过 /accounts 授权之外的初始化路径） */
function allow(...emails: string[]): void {
  for (const email of emails) {
    run("INSERT INTO auth_account(email, role, created_at) VALUES (?, 'member', ?) ON CONFLICT(email) DO NOTHING", [email, clock]);
  }
}
const send = (email = 'Person@Example.com') => app.inject({ method: 'POST', url: ROOT + '/send-code', payload: { email } });
const code = () => messages[messages.length - 1]!.text.match(/\d{6}/)![0];
const verify = (value = code(), email = 'person@example.com') => app.inject({ method: 'POST', url: ROOT + '/verify', payload: { email, code: value } });
const loginAs = async (email: string): Promise<string> => {
  expect((await send(email)).statusCode).toBe(200);
  const response = await verify(code(), email);
  expect(response.statusCode).toBe(200);
  return String(response.headers['set-cookie']).split(';')[0]!;
};
const adminCookie = () => loginAs(ADMIN);
beforeEach(() => {
  closeDb();
  vi.stubEnv('DATABASE_PATH', ':memory:');
  vi.stubEnv('APP_ORIGIN', 'https://freeshift.example');
  vi.stubEnv('AUTH_COOKIE_SECURE', 'true');
  vi.stubEnv('ADMIN_EMAIL', ADMIN);
  clock = 1_800_000_000_000;
  messages = [];
  app = makeApp();
  allow('person@example.com');
});
afterEach(async () => { await app.close(); closeDb(); vi.unstubAllEnvs(); });

describe('email authentication', () => {
  it('protects the API, exposes public session and health, and does not bypass prefixes', async () => {
    expect((await app.inject(ROOT + '/session')).json()).toEqual({ data: { enabled: true, email: null, role: null } });
    expect((await app.inject('/api/v1/private')).statusCode).toBe(401);
    expect((await app.inject(ROOT + '/session/extra')).statusCode).toBe(401);
    expect((await app.inject('/healthz')).statusCode).toBe(200);
  });
  it('normalizes identities, hashes credentials, creates sessions, consumes OTP, and revokes logout', async () => {
    expect((await send()).json()).toEqual({ data: { expiresIn: 600, retryAfter: 60 } });
    const otp = get<{ code_hash: string; salt: string }>('SELECT * FROM auth_otp')!;
    expect(otp.code_hash).not.toContain(code());
    const response = await verify();
    expect(response.json()).toEqual({ data: { enabled: true, email: 'person@example.com', role: 'member' } });
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
    allow(...Array.from({ length: 15 }, (_, n) => 'other' + n + '@example.com'), 'blocked@example.com');
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
    allow('person@example.com');
    const response = await send();
    expect(response.statusCode).toBe(503);
    expect(response.body).not.toContain('secret');
    expect(get('SELECT * FROM auth_otp')).toBeUndefined();
  });
  it('allows offline access without invoking the sender', async () => {
    await app.close(); app = makeApp(false, true);
    expect((await app.inject(ROOT + '/session')).json()).toEqual({ data: { enabled: false, email: null, role: null } });
    expect((await app.inject('/api/v1/private')).statusCode).toBe(200);
    expect((await send()).statusCode).toBe(200);
    expect(messages).toHaveLength(0);
  });
});

describe('access authorization', () => {
  it('rejects unlisted emails without sending mail or storing an OTP', async () => {
    const response = await send('stranger@example.com');
    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('NOT_AUTHORIZED');
    expect(messages).toHaveLength(0);
    expect(get('SELECT * FROM auth_otp')).toBeUndefined();
    // 未授权邮箱即使拿到验证码也无法登录
    expect((await verify('123456', 'stranger@example.com')).statusCode).toBe(403);
    expect(get('SELECT * FROM auth_session')).toBeUndefined();
  });
  it('bootstraps the configured admin and reports the role in the session', async () => {
    const admin = get<{ email: string; role: string }>('SELECT email, role FROM auth_account WHERE email = ?', [ADMIN])!;
    expect(admin.role).toBe('admin');
    const cookie = await adminCookie();
    expect((await app.inject({ url: ROOT + '/session', headers: { cookie } })).json()).toEqual({ data: { enabled: true, email: ADMIN, role: 'admin' } });
  });
  it('lets an admin add, list, promote and remove accounts, and the added email logs in without registering', async () => {
    const cookie = await adminCookie();
    const created = await app.inject({ method: 'POST', url: ROOT + '/accounts', headers: { cookie }, payload: { email: 'New@Example.com' } });
    expect(created.statusCode).toBe(201);
    expect(created.json().data.account).toMatchObject({ email: 'new@example.com', role: 'member', createdAt: clock, lastLoginAt: null });
    const list = await app.inject({ url: ROOT + '/accounts', headers: { cookie } });
    expect(list.json().data.adminEmail).toBe(ADMIN);
    expect(list.json().data.accounts.map((item: { email: string }) => item.email)).toEqual([ADMIN, 'new@example.com', 'person@example.com']);
    expect((await app.inject({ method: 'POST', url: ROOT + '/accounts', headers: { cookie }, payload: { email: 'new@example.com' } })).statusCode).toBe(409);
    expect((await app.inject({ method: 'POST', url: ROOT + '/accounts', headers: { cookie }, payload: { email: 'not-an-email' } })).statusCode).toBe(422);
    expect((await app.inject({ method: 'POST', url: ROOT + '/accounts', headers: { cookie }, payload: { email: 'x@example.com', role: 'owner' } })).statusCode).toBe(422);
    // 新邮箱不需要注册流程，直接收码登录
    const newCookie = await loginAs('new@example.com');
    expect((await app.inject({ url: ROOT + '/session', headers: { cookie: newCookie } })).json().data.role).toBe('member');
    const promoted = await app.inject({ method: 'PATCH', url: ROOT + '/accounts/new@example.com', headers: { cookie }, payload: { role: 'admin' } });
    expect(promoted.json().data.account.role).toBe('admin');
    const removed = await app.inject({ method: 'DELETE', url: ROOT + '/accounts/new@example.com', headers: { cookie } });
    expect(removed.json()).toEqual({ data: { removed: 'new@example.com' } });
    // 被移除的邮箱会话立即失效，且不能再获取验证码
    expect((await app.inject({ url: '/api/v1/private', headers: { cookie: newCookie } })).statusCode).toBe(401);
    expect((await send('new@example.com')).statusCode).toBe(403);
  });
  it('denies account management to members and anonymous callers', async () => {
    const memberCookie = await loginAs('person@example.com');
    expect((await app.inject({ url: ROOT + '/accounts', headers: { cookie: memberCookie } })).statusCode).toBe(403);
    expect((await app.inject({ url: ROOT + '/accounts' })).statusCode).toBe(401);
    const post = await app.inject({ method: 'POST', url: ROOT + '/accounts', headers: { cookie: memberCookie }, payload: { email: 'sneaky@example.com' } });
    expect(post.statusCode).toBe(403);
    expect(post.json().error.code).toBe('FORBIDDEN');
    expect(get('SELECT * FROM auth_account WHERE email = ?', ['sneaky@example.com'])).toBeUndefined();
  });
  it('protects against self-modification and demoting the last admin', async () => {
    const cookie = await adminCookie();
    const selfDelete = await app.inject({ method: 'DELETE', url: ROOT + '/accounts/' + encodeURIComponent(ADMIN), headers: { cookie } });
    expect(selfDelete.statusCode).toBe(403);
    expect(selfDelete.json().error.code).toBe('CANNOT_MODIFY_SELF');
    const selfDemote = await app.inject({ method: 'PATCH', url: ROOT + '/accounts/' + encodeURIComponent(ADMIN), headers: { cookie }, payload: { role: 'member' } });
    expect(selfDemote.statusCode).toBe(403);
    expect(selfDemote.json().error.code).toBe('CANNOT_MODIFY_SELF');
    expect(get<{ role: string }>('SELECT role FROM auth_account WHERE email = ?', [ADMIN])!.role).toBe('admin');
    const promoted = await app.inject({ method: 'POST', url: ROOT + '/accounts', headers: { cookie }, payload: { email: 'second@example.com', role: 'admin' } });
    expect(promoted.json().data.account.role).toBe('admin');
    const secondCookie = await loginAs('second@example.com');
    // 最后一位管理员不能被其他人降级或删除
    expect((await app.inject({ method: 'PATCH', url: ROOT + '/accounts/' + encodeURIComponent(ADMIN), headers: { cookie: secondCookie }, payload: { role: 'member' } })).statusCode).toBe(200);
    // ADMIN 已被降级为成员，现在只剩 second@example.com 一位管理员
    const demoteLastAdmin = await app.inject({ method: 'PATCH', url: ROOT + '/accounts/' + encodeURIComponent(ADMIN), headers: { cookie: secondCookie }, payload: { role: 'member' } });
    expect(demoteLastAdmin.statusCode).toBe(200);
    // 唯一管理员自我降级被 CANNOT_MODIFY_SELF 拦下，且角色保持 admin
    const selfDemoteLast = await app.inject({ method: 'PATCH', url: ROOT + '/accounts/second@example.com', headers: { cookie: secondCookie }, payload: { role: 'member' } });
    expect(selfDemoteLast.statusCode).toBe(403);
    expect(selfDemoteLast.json().error.code).toBe('CANNOT_MODIFY_SELF');
    expect(get<{ role: string }>('SELECT role FROM auth_account WHERE email = ?', ['second@example.com'])!.role).toBe('admin');
    // 唯一管理员也删不掉自己
    const deleteLastAdmin = await app.inject({ method: 'DELETE', url: ROOT + '/accounts/second@example.com', headers: { cookie: secondCookie } });
    expect(deleteLastAdmin.statusCode).toBe(403);
    expect(deleteLastAdmin.json().error.code).toBe('CANNOT_MODIFY_SELF');
    // 恢复第一位管理员后，最后一位管理员仍可正常管理
    expect((await app.inject({ method: 'PATCH', url: ROOT + '/accounts/' + encodeURIComponent(ADMIN), headers: { cookie: secondCookie }, payload: { role: 'admin' } })).statusCode).toBe(200);
    const selfDemoteWithTwo = await app.inject({ method: 'PATCH', url: ROOT + '/accounts/second@example.com', headers: { cookie: secondCookie }, payload: { role: 'member' } });
    expect(selfDemoteWithTwo.statusCode).toBe(403);
    expect(selfDemoteWithTwo.json().error.code).toBe('CANNOT_MODIFY_SELF');
    expect((await app.inject({ url: ROOT + '/accounts', headers: { cookie: secondCookie } })).statusCode).toBe(200);
    expect(get<{ role: string }>('SELECT role FROM auth_account WHERE email = ?', ['second@example.com'])!.role).toBe('admin');
  });
  it('requires JSON bodies for account mutations', async () => {
    const cookie = await adminCookie();
    const response = await app.inject({ method: 'POST', url: ROOT + '/accounts', headers: { cookie, 'content-type': 'text/plain' }, payload: '{}' });
    expect(response.statusCode).toBe(415);
  });
});
