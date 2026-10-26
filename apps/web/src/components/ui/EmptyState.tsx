import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';

export interface EmptyStateProps {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  compact?: boolean;
  className?: string;
}

export function EmptyState({ icon, title, description, action, compact = false, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-2 rounded-card border border-dashed border-line bg-surface px-6 text-center',
        compact ? 'py-6' : 'py-12',
        className,
      )}
    >
      {icon ? <div className="rounded-full bg-canvas p-2.5 text-subtle">{icon}</div> : null}
      <div className="text-sm font-medium text-ink">{title}</div>
      {description ? <p className="max-w-md text-xs leading-5 text-muted">{description}</p> : null}
      {action ? <div className="mt-1.5">{action}</div> : null}
    </div>
  );
}
