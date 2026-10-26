import type { AppUser } from '@freeshift/shared';
import { cn } from '../../lib/cn';
import { userInitial, userSoftBackground } from '../../lib/colors';

export function UserDot({ color, className }: { color?: string; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn('inline-block h-2.5 w-2.5 shrink-0 rounded-full', className)}
      style={{ backgroundColor: color ?? 'var(--fs-subtle)' }}
    />
  );
}

export function UserAvatar({ user, className }: { user: Pick<AppUser, 'name' | 'color'>; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn('inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold', className)}
      style={{ backgroundColor: userSoftBackground(user.color), color: user.color }}
    >
      {userInitial(user.name)}
    </span>
  );
}

export function UserChip({ user, className }: { user: Pick<AppUser, 'name' | 'color'>; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-md border border-line bg-surface px-1.5 py-1 text-xs text-ink',
        className,
      )}
    >
      <UserDot color={user.color} />
      <span className="truncate">{user.name}</span>
    </span>
  );
}
