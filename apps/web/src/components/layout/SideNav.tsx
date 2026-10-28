import { CalendarDays } from 'lucide-react';
import { NavLink } from 'react-router-dom';
import { roleLabel, useSession } from '../../auth/session';
import { cn } from '../../lib/cn';
import { visibleNavItems } from './navItems';

export function SideNav() {
  const { session, isAdmin } = useSession();
  const items = visibleNavItems(isAdmin);
  const showAccount = session.enabled && session.email !== null;
  return (
    <aside className="sticky top-0 hidden h-screen w-[232px] shrink-0 flex-col border-r border-line bg-surface lg:flex">
      <div className="flex h-16 items-center gap-2.5 px-5">
        <span className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-brand text-white">
          <CalendarDays className="h-[18px] w-[18px]" aria-hidden />
        </span>
        <span className="flex flex-col leading-tight">
          <span className="text-sm font-semibold tracking-tight text-ink">FreeShift</span>
          <span className="text-2xs text-subtle">空闲排班</span>
        </span>
      </div>

      <nav aria-label="主导航" className="flex flex-1 flex-col gap-0.5 px-3 py-2">
        {items.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              cn(
                'flex h-10 items-center gap-2.5 rounded-control px-3 text-sm transition-colors duration-150',
                isActive ? 'bg-brand-soft font-medium text-brand' : 'text-muted hover:bg-canvas hover:text-ink',
              )
            }
          >
            <item.icon className="h-4 w-4 shrink-0" aria-hidden />
            <span className="truncate">{item.label}</span>
            {item.adminOnly ? <span className="ml-auto text-[10px] font-medium text-subtle">管理员</span> : null}
          </NavLink>
        ))}
      </nav>

      {showAccount ? (
        <div className="mx-3 mb-2 rounded-control border border-line bg-canvas px-3 py-2">
          <p className="truncate text-2xs font-medium text-ink" title={session.email || undefined}>{session.email}</p>
          <p className="mt-0.5 flex items-center gap-1 text-[10px] text-subtle">
            <span className={cn('h-1.5 w-1.5 rounded-full', isAdmin ? 'bg-brand' : 'bg-mint')} aria-hidden />
            {roleLabel(session.role)}
          </p>
        </div>
      ) : null}

      <div className="border-t border-line px-5 py-4">
        <p className="text-2xs leading-4 text-subtle">周次由服务端按 Asia/Shanghai 计算，切换周次会保存在地址栏。</p>
      </div>
    </aside>
  );
}
