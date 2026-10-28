import { createContext, useContext } from 'react';
import type { AuthRole, AuthSession } from './api';

/** 离线模式（enabled:false）时 email 与 role 均为 null */
export const OFFLINE_SESSION: AuthSession = { enabled: false, email: null, role: null };

export interface SessionContextValue {
  session: AuthSession;
  /** 是否为管理员（离线模式恒为 false，不展示访问授权入口） */
  isAdmin: boolean;
}

const SessionContext = createContext<SessionContextValue>({ session: OFFLINE_SESSION, isAdmin: false });

export const SessionProvider = SessionContext.Provider;

export function useSession(): SessionContextValue {
  return useContext(SessionContext);
}

export function isAdminRole(role: AuthRole | null | undefined): boolean {
  return role === 'admin';
}

export function roleLabel(role: AuthRole | null | undefined): string {
  if (role === 'admin') return '管理员';
  if (role === 'member') return '成员';
  return '未登录';
}
