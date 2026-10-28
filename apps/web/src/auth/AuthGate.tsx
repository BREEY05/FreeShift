import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { CalendarDays, Loader2, LogOut } from 'lucide-react';
import { authApi, type AuthSession } from './api';
import { LoginScreen } from './LoginScreen';
import { SessionProvider, roleLabel } from './session';
import './auth.css';

const SIGNED_OUT: AuthSession = { enabled: true, email: null, role: null };

export function AuthGate({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [session, setSession] = useState<AuthSession | null>(null);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [loggingOut, setLoggingOut] = useState(false);
  const revision = useRef(0);
  const logoutPending = useRef(false);

  useEffect(() => {
    const expire = () => {
      revision.current += 1;
      setSession(SIGNED_OUT);
      setChecking(false);
      setError('');
      setNotice('登录已过期，请重新验证邮箱。');
      queryClient.clear();
    };
    window.addEventListener('freeshift:unauthorized', expire);
    return () => window.removeEventListener('freeshift:unauthorized', expire);
  }, [queryClient]);

  useEffect(() => {
    const controller = new AbortController();
    const currentRevision = revision.current;
    setChecking(true);
    setError('');
    authApi.session(controller.signal).then(result => {
      if (!controller.signal.aborted && revision.current === currentRevision) setSession(result);
    }).catch(err => {
      if (!controller.signal.aborted && revision.current === currentRevision) setError(err instanceof Error ? err.message : '无法检查登录状态，请重试。');
    }).finally(() => {
      if (!controller.signal.aborted && revision.current === currentRevision) setChecking(false);
    });
    return () => controller.abort();
  }, [attempt]);

  async function logout() {
    if (logoutPending.current) return;
    logoutPending.current = true;
    setLoggingOut(true);
    setError('');
    try {
      await authApi.logout();
      revision.current += 1;
      setSession(SIGNED_OUT);
      setNotice('你已安全退出。再次登录时，请验证邮箱。');
      queryClient.clear();
    } catch (err) {
      setError(err instanceof Error ? err.message : '退出失败，请重试。');
    } finally {
      logoutPending.current = false;
      setLoggingOut(false);
    }
  }

  if (checking || (!session && error)) return (
    <main className="fs-auth-status">
      <span className="fs-auth-mark"><CalendarDays size={25} aria-hidden /></span>
      <h1>FreeShift</h1>
      {checking ? <p role="status"><Loader2 size={17} className="animate-spin motion-reduce:animate-none" aria-hidden />正在确认登录状态…</p> : <><p role="alert">{error}</p><button className="fs-auth-primary" onClick={() => setAttempt(value => value + 1)}>重新连接</button></>}
    </main>
  );
  if (!session || (session.enabled && !session.email)) return <LoginScreen notice={notice} onAuthenticated={result => { revision.current += 1; queryClient.clear(); setError(''); setNotice(''); setSession(result); }} />;

  const current = session;
  const isAdmin = current.enabled && current.role === 'admin';
  return (
    <SessionProvider value={{ session: current, isAdmin }}>
      {current.enabled && <div className="fs-auth-account" aria-label="当前账户"><span className="fs-auth-account-dot" /><span className="fs-auth-account-email" title={current.email || undefined}>{current.email}</span><span className={'fs-auth-account-role' + (isAdmin ? ' is-admin' : '')}>{roleLabel(current.role)}</span><button onClick={() => void logout()} disabled={loggingOut}><LogOut size={13} aria-hidden />{loggingOut ? '正在退出…' : '退出登录'}</button>{error && <span role="alert" className="fs-auth-account-error">{error}</span>}</div>}
      {children}
    </SessionProvider>
  );
}

/** 登录页与状态页复用同一套反馈样式 */
export type { AuthSession };
