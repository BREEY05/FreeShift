import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowRight, CalendarDays, Check, Loader2, Mail, ShieldCheck } from 'lucide-react';
import { authApi, AuthRequestError, type AuthSession } from './api';

export function LoginScreen({ onAuthenticated, notice }: { onAuthenticated: (session: AuthSession) => void; notice: string }) {
  const [email, setEmail] = useState('');
  const [sentEmail, setSentEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState<'send' | 'verify' | null>(null);
  const [error, setError] = useState('');
  const [deadline, setDeadline] = useState(0);
  const [remaining, setRemaining] = useState(0);
  const [expiresIn, setExpiresIn] = useState(600);
  const codeInput = useRef<HTMLInputElement>(null);
  const mounted = useRef(true);
  const pending = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    const update = () => setRemaining(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)));
    update();
    if (!deadline) return;
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [deadline]);
  useEffect(() => { if (sentEmail && !busy) codeInput.current?.focus(); }, [sentEmail, busy]);

  async function sendCode() {
    if (pending.current || remaining > 0) return;
    pending.current = true;
    setBusy('send');
    setError('');
    try {
      const address = (sentEmail || email).trim();
      const result = await authApi.sendCode(address);
      if (!mounted.current) return;
      setSentEmail(address);
      setCode('');
      setExpiresIn(result.expiresIn);
      setDeadline(Date.now() + result.retryAfter * 1000);
      codeInput.current?.focus();
    } catch (err) {
      if (!mounted.current) return;
      setError(err instanceof Error ? err.message : '验证码发送失败，请重试。');
      if (err instanceof AuthRequestError && err.retryAfter > 0) setDeadline(Date.now() + err.retryAfter * 1000);
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(null);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!sentEmail) { await sendCode(); return; }
    if (pending.current) return;
    pending.current = true;
    setBusy('verify');
    setError('');
    try {
      const session = await authApi.verify(sentEmail, code);
      if (mounted.current) {
        if (!session.enabled || !session.email) throw new Error('验证未完成，请重新获取验证码。');
        onAuthenticated(session);
      }
    } catch (err) {
      if (mounted.current) setError(err instanceof Error ? err.message : '验证失败，请重试。');
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(null);
    }
  }

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
          <h2 id="fs-auth-title">{sentEmail ? '查看你的邮箱' : '欢迎来到 FreeShift'}</h2>
          <p className="fs-auth-intro">{sentEmail ? '输入邮件中的 6 位验证码，继续你的排班。' : '使用邮箱登录，开始安排更从容的一周。'}</p>
          {notice && <p className="fs-auth-notice" role="status">{notice}</p>}
          <form onSubmit={submit}>
            <label htmlFor="fs-auth-email">邮箱地址</label>
            <div className="fs-auth-input-wrap"><Mail size={18} aria-hidden /><input id="fs-auth-email" type="email" autoComplete="email" placeholder="输入你的邮箱地址" maxLength={254} required value={sentEmail || email} disabled={!!sentEmail || !!busy} onChange={event => { setEmail(event.target.value); setError(''); }} /></div>
            {sentEmail && <>
              <div className="fs-auth-code-label"><label htmlFor="fs-auth-code">邮箱验证码</label><button type="button" disabled={!!busy} onClick={() => { setSentEmail(''); setCode(''); setError(''); }}>更换邮箱</button></div>
              <input ref={codeInput} className="fs-auth-code" id="fs-auth-code" type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" minLength={6} maxLength={6} required placeholder="6 位数字" value={code} disabled={!!busy} onChange={event => { setCode(event.target.value.replace(/[^0-9]/g, '')); setError(''); }} aria-describedby="fs-auth-code-help" />
              <p id="fs-auth-code-help" className="fs-auth-help">验证码已发送，有效期 {Math.ceil(expiresIn / 60)} 分钟。未收到时，请检查垃圾邮件。</p>
            </>}
            {error && <p className="fs-auth-error" role="alert">{error}</p>}
            <button className="fs-auth-primary" type="submit" disabled={!!busy || (!sentEmail && remaining > 0)}>{busy ? <Loader2 size={18} className="animate-spin motion-reduce:animate-none" aria-hidden /> : <>{sentEmail ? '验证并进入' : remaining > 0 ? remaining + ' 秒后可重新发送' : '获取邮箱验证码'}<ArrowRight size={17} aria-hidden /></>}</button>
            {sentEmail && <button className="fs-auth-resend" type="button" disabled={!!busy || remaining > 0} onClick={() => void sendCode()}>{remaining > 0 ? remaining + ' 秒后可重新发送' : '重新发送验证码'}</button>}
          </form>
          <div className="fs-auth-assurance"><ShieldCheck size={17} aria-hidden /><span>无需密码，在此设备保持登录 30 天</span></div>
          <p className="fs-auth-registration">首次验证邮箱将自动创建账户。<br />所有账户共同使用当前团队的排班工作区。</p>
        </section>
      </div>
      <footer className="fs-auth-footer"><span>FreeShift · 让时间自由流动</span><span>共同的时间，更好的协作</span></footer>
    </main>
  );
}
