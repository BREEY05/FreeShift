import type { HTMLAttributes } from 'react';
import { cn } from '../../lib/cn';

export type BadgeTone = 'neutral' | 'brand' | 'mint' | 'amber' | 'danger' | 'outline';

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
}

const toneClasses: Record<BadgeTone, string> = {
  neutral: 'bg-canvas text-muted',
  brand: 'bg-brand-soft text-brand',
  mint: 'bg-emerald-50 text-mint',
  amber: 'bg-amber-50 text-amber',
  danger: 'bg-red-50 text-danger',
  outline: 'border border-line bg-surface text-muted',
};

export function Badge({ tone = 'neutral', className, ...props }: BadgeProps) {
  return (
    <span
      className={cn('inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-2xs font-medium leading-4', toneClasses[tone], className)}
      {...props}
    />
  );
}
