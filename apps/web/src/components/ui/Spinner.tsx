import { cn } from '../../lib/cn';

export interface SpinnerProps {
  className?: string;
  label?: string;
}

/** 轻量加载指示器 */
export function Spinner({ className, label = '加载中' }: SpinnerProps) {
  return (
    <span
      role="status"
      aria-label={label}
      className={cn('inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent', className)}
    />
  );
}
