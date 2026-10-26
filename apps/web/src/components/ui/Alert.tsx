import { AlertTriangle, CheckCircle2, Info } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';

export type AlertTone = 'danger' | 'warning' | 'info' | 'success';

export interface AlertProps {
  tone?: AlertTone;
  title?: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}

const toneClasses: Record<AlertTone, string> = {
  danger: 'border-red-200 bg-red-50 text-danger',
  warning: 'border-amber-200 bg-amber-50 text-amber',
  info: 'border-line bg-canvas text-muted',
  success: 'border-emerald-200 bg-emerald-50 text-mint',
};

const toneIcons: Record<AlertTone, ReactNode> = {
  danger: <AlertTriangle className="h-4 w-4" aria-hidden />,
  warning: <AlertTriangle className="h-4 w-4" aria-hidden />,
  info: <Info className="h-4 w-4" aria-hidden />,
  success: <CheckCircle2 className="h-4 w-4" aria-hidden />,
};

export function Alert({ tone = 'danger', title, children, action, className }: AlertProps) {
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      className={cn('flex items-start gap-2.5 rounded-control border px-3 py-2.5 text-xs', toneClasses[tone], className)}
    >
      <span className="mt-0.5 shrink-0">{toneIcons[tone]}</span>
      <div className="min-w-0 flex-1">
        {title ? <div className="font-medium">{title}</div> : null}
        {children ? <div className={cn('text-2xs leading-5', title ? 'mt-0.5' : '')}>{children}</div> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
