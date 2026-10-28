import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { createRequire } from 'node:module';
import { all, get, run, transaction } from '../db/index.ts';
import { AppError } from '../lib/errors.ts';

export interface AuthMail { to: string; subject: string; text: string }
export type AuthSender = (message: AuthMail) => Promise<unknown>;
export const SESSION_SECONDS = 30 * 24 * 60 * 60;
const OTP_MS = 600_000;
const DEFAULT_ADMIN_EMAIL = '380154843@qq.com';
const hash = (value: string): string => createHash('sha256').update(value).digest('hex');

export type AuthRole = 'admin' | 'member';

export interface AccountRow {
  email: string;
  role: AuthRole;
  created_at: number;
  added_by: string | null;
  last_login_at: number | null;
}

export interface AccountView {
  email: string;
  role: AuthRole;
  createdAt: number | null;
  lastLoginAt: number | null;
}

/** 数据库行 -> 接口视图（epoch 毫秒数字或 null）。 */
export function toAccountView(row: AccountRow): AccountView {
  return {
    email: row.email,
    role: row.role,
    createdAt: typeof row.created_at === 'number' ? row.created_at : null,
    lastLoginAt: typeof row.last_login_at === 'number' ? row.last_login_at : null,
  };
}

/** 白名单校验：不在授权列表中的邮箱既不能收验证码也不能登录。 */
function assertAllowlisted(email: string): AccountRow {
  const row = get<AccountRow>('SELECT * FROM auth_account WHERE email = ?', [email]);
  if (!row) throw new AppError(403, 'NOT_AUTHORIZED', '该邮箱尚未获得访问授权，请联系管理员');
  return row;
}

function adminEmailRaw(): string {
  const configured = process.env.ADMIN_EMAIL;
  return typeof configured === 'string' && configured.trim() !== '' ? configured.trim().toLowerCase() : DEFAULT_ADMIN_EMAIL;
}

/** 内置管理员邮箱：已配置且合法时返回规范化邮箱，否则回落到默认值。从未落日志。 */
export function adminEmail(): string {
  try { return normalizeEmail(adminEmailRaw()); } catch { return DEFAULT_ADMIN_EMAIL; }
}

/** 安装时写入内置管理员（不存在则创建，存在但为 member 则提升为 admin）。 */
export function ensureAdminAccount(now: number): void {
  const email = adminEmail();
  run(
    "INSERT INTO auth_account(email, role, created_at, added_by) VALUES (?, 'admin', ?, NULL) " +
      "ON CONFLICT(email) DO UPDATE SET role = 'admin' WHERE auth_account.role <> 'admin'",
    [email, now],
  );
}

export function normalizeEmail(value: unknown): string {
  if (typeof value !== 'string' || value.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())) {
    throw new AppError(422, 'VALIDATION_ERROR', '请输入有效的邮箱地址');
  }
  return value.trim().toLowerCase();
}

export function normalizeRole(value: unknown, fallback: AuthRole = 'member'): AuthRole {
  if (value === undefined || value === null) return fallback;
  if (value === 'admin' || value === 'member') return value;
  throw new AppError(422, 'VALIDATION_ERROR', '角色只能为 admin 或 member');
}

export function listAccounts(): AccountView[] {
  return all<AccountRow>(
    "SELECT * FROM auth_account ORDER BY CASE role WHEN 'admin' THEN 0 ELSE 1 END, email ASC",
  ).map(toAccountView);
}

export function getAccount(email: string): AccountView | null {
  const row = get<AccountRow>('SELECT * FROM auth_account WHERE email = ?', [email]);
  return row ? toAccountView(row) : null;
}

/** 最近一次登录的邮箱（前端在无会话时展示联系管理员提示，不暴露邮箱是否已授权）。 */
export function latestAdminEmail(): string {
  const row = get<{ email: string }>("SELECT email FROM auth_account WHERE role = 'admin' ORDER BY (last_login_at IS NULL), last_login_at DESC, email ASC LIMIT 1");
  return row?.email ?? adminEmail();
}

/**
 * 新增授权账户（授权 = 已注册 + 已验证，无需再走验证码）。
 * 重复邮箱 409，非法邮箱由 normalizeEmail 抛 422。
 */
export function addAccount(emailValue: unknown, roleValue: unknown, addedBy: string | null, now: number): { account: AccountView; created: boolean } {
  const email = normalizeEmail(emailValue);
  const role = normalizeRole(roleValue);
  const existing = get<AccountRow>('SELECT * FROM auth_account WHERE email = ?', [email]);
  if (existing) throw new AppError(409, 'ACCOUNT_EXISTS', '该邮箱已在授权列表中');
  run('INSERT INTO auth_account(email, role, created_at, added_by) VALUES (?, ?, ?, ?)', [email, role, now, addedBy]);
  return { account: getAccount(email) as AccountView, created: true };
}

function adminCount(): number {
  return get<{ n: number }>("SELECT COUNT(*) AS n FROM auth_account WHERE role = 'admin'")?.n ?? 0;
}

/** 不能把最后一位管理员删掉或降级。 */
function assertKeepsAdmin(target: AccountRow): void {
  if (target.role === 'admin' && adminCount() <= 1) {
    throw new AppError(403, 'LAST_ADMIN', '至少需要保留一位管理员');
  }
}

/** 移除授权账户；其会话通过 auth_session 的 ON DELETE CASCADE 一并失效。 */
export function removeAccount(emailValue: unknown, callerEmail: string): string {
  const email = normalizeEmail(emailValue);
  const caller = get<AccountRow>('SELECT * FROM auth_account WHERE email = ?', [callerEmail]);
  if (!caller || caller.role !== 'admin') throw new AppError(403, 'FORBIDDEN', '需要管理员权限');
  const target = get<AccountRow>('SELECT * FROM auth_account WHERE email = ?', [email]);
  if (!target) throw new AppError(404, 'NOT_FOUND', '该邮箱不在授权列表中');
  if (target.email === caller.email) throw new AppError(403, 'CANNOT_MODIFY_SELF', '不能修改自己的权限');
  assertKeepsAdmin(target);
  transaction(() => {
    run('DELETE FROM auth_session WHERE email = ?', [email]);
    run('DELETE FROM auth_otp WHERE email = ?', [email]);
    run('DELETE FROM auth_account WHERE email = ?', [email]);
  });
  return email;
}

/** 调整授权账户角色，禁止修改自己与降级最后一位管理员。 */
export function setAccountRole(emailValue: unknown, roleValue: unknown, callerEmail: string): AccountView {
  const email = normalizeEmail(emailValue);
  const caller = get<AccountRow>('SELECT * FROM auth_account WHERE email = ?', [callerEmail]);
  if (!caller || caller.role !== 'admin') throw new AppError(403, 'FORBIDDEN', '需要管理员权限');
  const role = normalizeRole(roleValue, 'member');
  const target = get<AccountRow>('SELECT * FROM auth_account WHERE email = ?', [email]);
  if (!target) throw new AppError(404, 'NOT_FOUND', '该邮箱不在授权列表中');
  if (target.role === role) return toAccountView(target);
  // 唯一管理员自我降级同时违反两条规则，优先给出"不能修改自己"
  if (target.email === caller.email) throw new AppError(403, 'CANNOT_MODIFY_SELF', '不能修改自己的权限');
  assertKeepsAdmin(target);
  run('UPDATE auth_account SET role = ? WHERE email = ?', [role, email]);
  return getAccount(email) as AccountView;
}

export const smtpSendMail: AuthSender = async (message) => {
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!user || !pass) throw new AppError(503, 'MAIL_UNAVAILABLE', '邮件服务尚未配置');
  const port = Number(process.env.SMTP_PORT ?? 465);
  // Lazy loading means an injected sender never loads or connects to SMTP.
  const nodemailer = createRequire(import.meta.url)('nodemailer') as {
    createTransport(options: object): { sendMail(message: object): Promise<unknown>; close(): void };
  };
  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST ?? 'smtp.qq.com', port, secure: port === 465,
    auth: { user, pass }, connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 15_000,
  });
  try {
    return await transport.sendMail({ ...message, from: process.env.SMTP_FROM ?? user });
  } finally { transport.close(); }
};

export async function sendCode(email: string, ip: string, sendMail: AuthSender, now: number): Promise<void> {
  // 授权检查必须先于任何 OTP / 限流写入，且不暴露是否存在待验证验证码。
  assertAllowlisted(email);
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  const salt = randomBytes(32).toString('hex');
  const codeHash = hash(salt + code);
  transaction(() => {
    run('DELETE FROM auth_rate_limit WHERE window_start <= ?', [now - 3_600_000]);
    run('DELETE FROM auth_otp WHERE expires_at <= ?', [now]);
    const limits = [
      { key: 'email:' + email, max: 5, cooldown: 60_000 },
      { key: 'ip:' + hash(ip), max: 20, cooldown: 0 },
    ];
    for (const limit of limits) {
      const row = get<{ count: number; last_sent: number; window_start: number }>(
        'SELECT * FROM auth_rate_limit WHERE key = ?', [limit.key]);
      if (row && (row.count >= limit.max || now - row.last_sent < limit.cooldown)) {
        const retryAfter = Math.max(1, Math.ceil((row.count >= limit.max
          ? row.window_start + 3_600_000 - now : limit.cooldown - (now - row.last_sent)) / 1000));
        throw new AppError(429, 'RATE_LIMITED', '请求过于频繁，请稍后再试', { retryAfter });
      }
    }
    for (const limit of limits) run(
      'INSERT INTO auth_rate_limit(key, window_start, count, last_sent) VALUES (?, ?, 1, ?) ON CONFLICT(key) DO UPDATE SET count = count + 1, last_sent = excluded.last_sent',
      [limit.key, now, now]);
    run('INSERT INTO auth_otp(email, code_hash, salt, expires_at, attempts) VALUES (?, ?, ?, ?, 0) ON CONFLICT(email) DO UPDATE SET code_hash = excluded.code_hash, salt = excluded.salt, expires_at = excluded.expires_at, attempts = 0',
      [email, codeHash, salt, now + OTP_MS]);
  });
  try {
    await sendMail({ to: email, subject: 'FreeShift 登录验证码', text: '您的 FreeShift 登录验证码为：' + code + '。10 分钟内有效，请勿向他人透露。' });
  } catch {
    // Do not forward transport errors: they may contain credentials or message content.
    run('DELETE FROM auth_otp WHERE email = ? AND code_hash = ?', [email, codeHash]);
    throw new AppError(503, 'MAIL_UNAVAILABLE', '验证码发送失败，请稍后重试');
  }
}

export interface VerifyResult { token: string; role: AuthRole }

export function verifyCode(email: string, code: unknown, now: number): VerifyResult {
  assertAllowlisted(email);
  if (typeof code !== 'string' || !/^\d{6}$/.test(code)) throw new AppError(422, 'VALIDATION_ERROR', '验证码必须为六位数字');
  const result = transaction(() => {
    const otp = get<{ code_hash: string; salt: string; expires_at: number; attempts: number }>('SELECT * FROM auth_otp WHERE email = ?', [email]);
    if (!otp || otp.expires_at <= now || otp.attempts >= 5) return null;
    if (!timingSafeEqual(Buffer.from(otp.code_hash, 'hex'), Buffer.from(hash(otp.salt + code), 'hex'))) {
      run('UPDATE auth_otp SET attempts = attempts + 1 WHERE email = ?', [email]);
      return null;
    }
    const account = get<AccountRow>('SELECT * FROM auth_account WHERE email = ?', [email]);
    if (!account) return null;
    run('DELETE FROM auth_otp WHERE email = ?', [email]);
    run('UPDATE auth_account SET last_login_at = ? WHERE email = ?', [now, email]);
    run('DELETE FROM auth_session WHERE expires_at <= ?', [now]);
    const token = randomBytes(32).toString('base64url');
    run('INSERT INTO auth_session(token_hash, email, expires_at) VALUES (?, ?, ?)', [hash(token), email, now + SESSION_SECONDS * 1000]);
    return { token, role: account.role };
  });
  if (!result) throw new AppError(401, 'INVALID_CODE', '验证码无效或已过期，请重新获取');
  return result;
}

export interface SessionAccount { email: string; role: AuthRole }

/** 有效会话对应的账户（含角色）；会话存在但账户已删除时视为未登录。 */
export function sessionAccount(token: string | undefined, now: number): SessionAccount | null {
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const row = get<{ email: string; role: AuthRole | null }>(
    'SELECT a.email AS email, a.role AS role FROM auth_session s JOIN auth_account a ON a.email = s.email WHERE s.token_hash = ? AND s.expires_at > ?',
    [hash(token), now],
  );
  if (!row) return null;
  return { email: row.email, role: row.role === 'admin' ? 'admin' : 'member' };
}

export function sessionEmail(token: string | undefined, now: number): string | null {
  return sessionAccount(token, now)?.email ?? null;
}

export function sessionRole(token: string | undefined, now: number): AuthRole | null {
  return sessionAccount(token, now)?.role ?? null;
}

export function revokeSession(token: string | undefined): void {
  if (token) run('DELETE FROM auth_session WHERE token_hash = ?', [hash(token)]);
}
