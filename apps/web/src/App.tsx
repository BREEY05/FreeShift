import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './components/layout/AppShell';
import { AuthGate } from './auth/AuthGate';
import DashboardPage from './pages/DashboardPage';
import RecommendPage from './pages/RecommendPage';
import SettingsPage from './pages/SettingsPage';
import StatsPage from './pages/StatsPage';
import TemplatesPage from './pages/TemplatesPage';
import UsersPage from './pages/UsersPage';

/** 路由表：/ 主看板，其余页面由 app shell 包裹，未知路径回主看板 */
export default function App() {
  return (
    <AuthGate>
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/users" element={<UsersPage />} />
        <Route path="/slots" element={<TemplatesPage />} />
        <Route path="/templates" element={<Navigate to="/slots" replace />} />
        <Route path="/recommend" element={<RecommendPage />} />
        <Route path="/stats" element={<StatsPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
    </AuthGate>
  );
}
