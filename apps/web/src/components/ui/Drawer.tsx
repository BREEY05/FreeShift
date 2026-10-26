import { X } from 'lucide-react';
import { useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../../lib/cn';
import { Button } from './Button';
import { useOverlay } from './useOverlay';

export interface DrawerProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}

/** 右侧抽屉：Esc / 遮罩关闭，焦点陷阱，窄屏全宽 */
export function Drawer({ open, onClose, title, subtitle, children, footer, className }: DrawerProps) {
  const panelRef = useRef<HTMLElement>(null);
  const titleId = useId();
  useOverlay(open, onClose, panelRef);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 animate-fade-in bg-black/30" onClick={onClose} aria-hidden />
      <aside
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={cn(
          'absolute inset-y-0 right-0 flex w-full max-w-[420px] flex-col border-l border-line bg-surface shadow-lift animate-slide-in-right focus:outline-none',
          className,
        )}
      >
        <header className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0">
            <h2 id={titleId} className="text-sm font-semibold text-ink">
              {title}
            </h2>
            {subtitle ? <div className="mt-0.5 text-xs text-muted">{subtitle}</div> : null}
          </div>
          <Button variant="ghost" size="sm" aria-label="关闭" onClick={onClose} className="-mr-1 shrink-0 px-1.5">
            <X className="h-4 w-4" />
          </Button>
        </header>
        <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer ? <footer className="border-t border-line bg-canvas px-5 py-3">{footer}</footer> : null}
      </aside>
    </div>,
    document.body,
  );
}
