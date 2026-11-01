import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowRight, CalendarDays, Check, Loader2, Mail, ShieldCheck, ShieldX } from 'lucide-react';
import { authApi, AuthRequestError, type AuthSession } from './api';

/** 未获授权：后端返回 403 NOT_AUTHORIZED，或任意 403 */
function isNotAuthorized(err: unknown): boolean {
  return err instanceof AuthRequestError && (err.code === 'NOT_AUTHORIZED' || err.status === 403);
}

/** 登录页：授权名单内的邮箱直接输入即可进入（契约 v3，无验证码步骤） */
export function LoginScreen({ onAuthenticated, notice }: { onAuthenticated: (session: AuthSession) => void; notice: string }) {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [deniedEmail, setDeniedEmail] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const mounted = useRef(true);
  const pending = useRef(false);

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { if (!busy) inputRef.current?.focus(); }, [busy]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const address = email.trim();
    if (!address) {
      setError('请输入邮箱地址');
      inputRef.current?.focus();
      return;
    }
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError('');
    setDeniedEmail('');
    try {
      const session = await authApi.login(address);
      if (!mounted.current) return;
      if (!session.enabled || !session.email) throw new Error('登录未完成，请重试。');
      onAuthenticated(session);
    } catch (err) {
      if (!mounted.current) return;
      if (isNotAuthorized(err)) {
        setDeniedEmail(address);
        setError('');
        return;
      }
      setError(err instanceof Error ? err.message : '登录失败，请重试。');
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  const denied = deniedEmail !== '';

  return (
    <main className="fs-auth-page">
      <div className="fs-auth-brand"><span className="fs-auth-mark"><CalendarDays size={23} aria-hidden /></span><span>FreeShift<small>空闲排班</small></span></div>
      <div className="fs-auth-layout">
        <section className="fs-auth-story" aria-label="FreeShift 空闲排班">
          <span className="fs-auth-eyebrow">LESS COORDINATION. MORE CONNECTION.</span>
          <h1>把时间对齐，<br />让协作发生。</h1>
          <p>每个人的空闲，都有交集。<br />让课表与安排清晰可见，找到属于团队的共同时间。</p>
          <div className="fs-auth-schedule" aria-hidden="true">
            <div className="fs-auth-schedule-title"><CalendarDays size={17} /><span>一周之间，自有默契</span><span className="fs-auth-live" /></div>
            <div className="fs-auth-grid">
              {['MON', 'TUE', 'WED', 'THU', 'FRI'].map(day => <span className="fs-auth-day" key={day}>{day}</span>)}
              {Array.from({ length: 20 }, (_, i) => <span key={i} className={'fs-auth-cell fs-auth-cell-' + (i % 7)}>{i === 12 && <><Check size={13} />共同空闲</>}</span>)}
            </div>
            <div className="fs-auth-schedule-footer"><span><i />空闲交集</span><span>给每一次相聚，留出时间</span></div>
          </div>
        </section>
        <section className="fs-auth-card" aria-labelledby="fs-auth-title">
          <span className="fs-auth-step">YOUR TIME, CONNECTED</span>
          <h2 id="fs-auth-title">{denied ? '尚未获得访问授权' : '欢迎来到 FreeShift'}</h2>
          <p className="fs-auth-intro">{denied ? '该邮箱还没有被加入团队访问名单，暂时无法登录。' : '使用已授权的邮箱即可进入，无需密码与验证码。'}</p>
          {notice && !denied && <p className="fs-auth-notice" role="status">{notice}</p>}
          {denied && <div className="fs-auth-denied" role="alert">
            <div className="fs-auth-denied-head"><ShieldX size={18} aria-hidden /><strong>尚未获得访问授权</strong></div>
            <p><code>{deniedEmail}</code> 尚未获得访问授权，请联系管理员将该邮箱加入名单后再试。</p>
            <p className="fs-auth-denied-hint">授权后无需注册，输入邮箱即可直接进入。</p>
          </div>}
          <form onSubmit={submit}>
            <label htmlFor="fs-auth-email">邮箱地址</label>
            <div className="fs-auth-input-wrap"><Mail size={18} aria-hidden /><input ref={inputRef} id="fs-auth-email" type="email" autoComplete="email" placeholder="输入你的邮箱地址" maxLength={254} required value={email} disabled={busy} onChange={event => { setEmail(event.target.value); setError(''); setDeniedEmail(''); }} /></div>
            {error && <p className="fs-auth-error" role="alert">{error}</p>}
            <button className="fs-auth-primary" type="submit" disabled={busy}>
              {busy ? <Loader2 size={18} className="animate-spin motion-reduce:animate-none" aria-hidden /> : <>进入 FreeShift<ArrowRight size={17} aria-hidden /></>}
            </button>
          </form>
          <div className="fs-auth-assurance"><ShieldCheck size={17} aria-hidden /><span>无需密码，在此设备保持登录 30 天</span></div>
          <p className="fs-auth-registration">仅限已获授权的团队成员登录。<br />如需加入，请联系团队管理员添加邮箱。</p>
        </section>
      </div>
      <footer className="fs-auth-footer"><span>FreeShift · 让时间自由流动</span><span>共同的时间，更好的协作</span></footer>
    </main>
  );
}
