import type { ReactNode } from 'react';
import { Lock } from 'lucide-react';
import { Link, Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './components/layout/AppShell';
import { AuthGate } from './auth/AuthGate';
import { useSession } from './auth/session';
import { Button } from './components/ui/Button';
import { EmptyState } from './components/ui/EmptyState';
import AccessPage from './pages/AccessPage';
import DashboardPage from './pages/DashboardPage';
import OrgPage from './pages/OrgPage';
import RecommendPage from './pages/RecommendPage';
import SettingsPage from './pages/SettingsPage';
import StatsPage from './pages/StatsPage';
import TemplatesPage from './pages/TemplatesPage';
import UsersPage from './pages/UsersPage';

/** 仅管理员路由（/recommend /stats /access）：非管理员就地显示无权限提示，不闪空白 */
function AdminRoute({ children }: { children: ReactNode }) {
  const { isAdmin } = useSession();
  if (isAdmin) return <>{children}</>;
  return (
    <EmptyState
      icon={<Lock className="h-5 w-5" aria-hidden />}
      title="仅管理员可见"
      description="推荐、统计与访问授权面向平台管理员；普通成员可以在总览维护自己的个人表，在时间段页管理自己的表。"
      action={
        <Link to="/">
          <Button variant="primary">返回总览</Button>
        </Link>
      }
    />
  );
}

/** 路由表：/ 个人表总览，其余页面由 app shell 包裹，未知路径回总览；推荐/统计/访问授权仅管理员 */
export default function App() {
  return (
    <AuthGate>
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/users" element={<UsersPage />} />
        <Route path="/slots" element={<TemplatesPage />} />
        <Route path="/templates" element={<Navigate to="/slots" replace />} />
        <Route path="/recommend" element={<AdminRoute><RecommendPage /></AdminRoute>} />
        <Route path="/stats" element={<AdminRoute><StatsPage /></AdminRoute>} />
        <Route path="/org" element={<OrgPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/access" element={<AdminRoute><AccessPage /></AdminRoute>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
    </AuthGate>
  );
}
