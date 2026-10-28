import { Mail, ShieldCheck, Trash2, UserRound, UserRoundCheck } from 'lucide-react';
import type { AuthRole } from '../../../auth/api';
import type { AccessAccount } from '../../../api/authAccounts';
import { cn } from '../../../lib/cn';
import { Badge } from '../../ui/Badge';
import { Button } from '../../ui/Button';
import { Tooltip } from '../../ui/Tooltip';
import { emailInitial, formatEpochDateTime, formatRelative } from './format';

export interface AccountRowProps {
  account: AccessAccount;
  /** 是否为当前登录账户（自我修改被后端禁止） */
  isSelf: boolean;
  /** 是否为唯一管理员（最后一个管理员不能被降级或移除） */
  isLastAdmin: boolean;
  busy: boolean;
  pendingRole: AuthRole | null;
  onSetRole: (role: AuthRole) => void;
  onRemove: () => void;
}

const SELF_HINT = '无法修改自己的访问权限，请让其他管理员操作';
const LAST_ADMIN_HINT = '至少需要保留一位管理员';

/** 授权账户行：头像 + 邮箱 + 角色 + 时间 + 角色切换 / 移除 */
export function AccountRow({ account, isSelf, isLastAdmin, busy, pendingRole, onSetRole, onRemove }: AccountRowProps) {
  const isAdmin = account.role === 'admin';
  const roleLocked = isSelf || (isAdmin && isLastAdmin);
  const lockHint = isSelf ? SELF_HINT : LAST_ADMIN_HINT;
  const nextRole: AuthRole = isAdmin ? 'member' : 'admin';
  const lastLogin = formatEpochDateTime(account.lastLoginAt);
  const lastLoginRelative = formatRelative(account.lastLoginAt);
  const createdAt = formatEpochDateTime(account.createdAt);

  const roleButton = (
    <Button
      variant="secondary"
      size="sm"
      className="shrink-0"
      disabled={busy || roleLocked}
      loading={pendingRole === nextRole}
      aria-label={(isAdmin ? '设为成员 ' : '设为管理员 ') + account.email}
      iconLeft={isAdmin ? <UserRound className="h-3.5 w-3.5" aria-hidden /> : <ShieldCheck className="h-3.5 w-3.5" aria-hidden />}
      onClick={() => onSetRole(nextRole)}
    >
      <span className="hidden sm:inline">{isAdmin ? '设为成员' : '设为管理员'}</span>
    </Button>
  );

  const removeButton = (
    <Button
      variant="ghost"
      size="sm"
      className="px-1.5 text-danger hover:bg-red-50"
      disabled={busy || roleLocked}
      aria-label={'移除授权 ' + account.email}
      onClick={onRemove}
    >
      <Trash2 className="h-3.5 w-3.5" aria-hidden />
    </Button>
  );

  return (
    <div
      className={cn(
        'group flex items-center gap-3 px-3 py-2.5 transition-colors duration-150 sm:px-4',
        isSelf ? 'bg-brand-soft/40' : 'hover:bg-canvas',
      )}
    >
      <span
        className={cn(
          'flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold',
          isAdmin ? 'bg-brand text-white' : 'bg-canvas text-muted',
        )}
        aria-hidden
      >
        {emailInitial(account.email)}
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="truncate text-sm font-medium text-ink" title={account.email}>{account.email}</span>
          {isAdmin ? <Badge tone="brand" className="shrink-0"><ShieldCheck className="h-3 w-3" aria-hidden />管理员</Badge> : <Badge tone="neutral" className="shrink-0">成员</Badge>}
          {isSelf ? <Badge tone="mint" className="shrink-0">当前登录</Badge> : null}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-2xs text-subtle">
          <span className="inline-flex items-center gap-1" title={createdAt}>
            <Mail className="h-3 w-3" aria-hidden />首次授权 {createdAt}
          </span>
          <span
            className="inline-flex items-center gap-1"
            title={account.lastLoginAt ? lastLogin : '尚未登录'}
          >
            <UserRoundCheck className="h-3 w-3" aria-hidden />最近登录 {lastLogin}
            {lastLoginRelative ? <span className="text-subtle/80">（{lastLoginRelative}）</span> : null}
          </span>
        </div>
        {roleLocked ? (
          <p className="mt-0.5 text-2xs text-amber">{lockHint}</p>
        ) : null}
      </div>

      <div className="flex shrink-0 items-center gap-1">
        {roleLocked ? (
          <>
            <Tooltip label={lockHint}><span className="inline-flex cursor-not-allowed">{roleButton}</span></Tooltip>
            <Tooltip label={lockHint}><span className="inline-flex cursor-not-allowed">{removeButton}</span></Tooltip>
          </>
        ) : (
          <>
            {roleButton}
            {removeButton}
          </>
        )}
      </div>
    </div>
  );
}
