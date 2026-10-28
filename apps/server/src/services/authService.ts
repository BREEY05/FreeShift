import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { createRequire } from 'node:module';
import { get, run, transaction } from '../db/index.ts';
import { AppError } from '../lib/errors.ts';

export interface AuthMail { to: string; subject: string; text: string }
export type AuthSender = (message: AuthMail) => Promise<unknown>;
export const SESSION_SECONDS = 30 * 24 * 60 * 60;
const OTP_MS = 600_000;
const hash = (value: string): string => createHash('sha256').update(value).digest('hex');

export function normalizeEmail(value: unknown): string {
  if (typeof value !== 'string' || value.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())) {
    throw new AppError(422, 'VALIDATION_ERROR', '请输入有效的邮箱地址');
  }
  return value.trim().toLowerCase();
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

export function verifyCode(email: string, code: unknown, now: number): string {
  if (typeof code !== 'string' || !/^\d{6}$/.test(code)) throw new AppError(422, 'VALIDATION_ERROR', '验证码必须为六位数字');
  const result = transaction(() => {
    const otp = get<{ code_hash: string; salt: string; expires_at: number; attempts: number }>('SELECT * FROM auth_otp WHERE email = ?', [email]);
    if (!otp || otp.expires_at <= now || otp.attempts >= 5) return null;
    if (!timingSafeEqual(Buffer.from(otp.code_hash, 'hex'), Buffer.from(hash(otp.salt + code), 'hex'))) {
      run('UPDATE auth_otp SET attempts = attempts + 1 WHERE email = ?', [email]);
      return null;
    }
    run('DELETE FROM auth_otp WHERE email = ?', [email]);
    run('INSERT INTO auth_account(email, created_at) VALUES (?, ?) ON CONFLICT(email) DO NOTHING', [email, now]);
    run('DELETE FROM auth_session WHERE expires_at <= ?', [now]);
    const token = randomBytes(32).toString('base64url');
    run('INSERT INTO auth_session(token_hash, email, expires_at) VALUES (?, ?, ?)', [hash(token), email, now + SESSION_SECONDS * 1000]);
    return token;
  });
  if (!result) throw new AppError(401, 'INVALID_CODE', '验证码无效或已过期，请重新获取');
  return result;
}

export function sessionEmail(token: string | undefined, now: number): string | null {
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  return get<{ email: string }>('SELECT email FROM auth_session WHERE token_hash = ? AND expires_at > ?', [hash(token), now])?.email ?? null;
}

export function revokeSession(token: string | undefined): void {
  if (token) run('DELETE FROM auth_session WHERE token_hash = ?', [hash(token)]);
}
