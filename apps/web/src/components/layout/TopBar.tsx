import { CalendarDays } from 'lucide-react';
import { NavLink } from 'react-router-dom';
import { cn } from '../../lib/cn';
import { NAV_ITEMS } from './navItems';

/** 窄屏顶部栏：图标导航；≥1024px 由 SideNav 承担 */
export function TopBar() {
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-surface lg:hidden">
      <div className="flex h-14 items-center justify-between gap-2 px-4 sm:px-6">
        <NavLink to="/" className="flex min-w-0 items-center gap-2" aria-label="FreeShift 总览">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[9px] bg-brand text-white">
            <CalendarDays className="h-4 w-4" aria-hidden />
          </span>
          <span className="hidden truncate text-sm font-semibold tracking-tight text-ink min-[350px]:inline">FreeShift</span>
        </NavLink>
        <nav aria-label="主导航" className="flex shrink-0 items-center gap-0.5">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              aria-label={item.label}
              title={item.label}
              className={({ isActive }) =>
                cn(
                  'flex h-9 w-9 items-center justify-center rounded-control transition-colors duration-150',
                  isActive ? 'bg-brand-soft text-brand' : 'text-muted hover:bg-canvas hover:text-ink',
                )
              }
            >
              <item.icon className="h-[18px] w-[18px]" aria-hidden />
            </NavLink>
          ))}
        </nav>
      </div>
    </header>
  );
}
