import { ArrowUpDown, ChevronDown, ChevronUp, Eye, Pencil, Power, Trash2 } from 'lucide-react';
import type { AppUser } from '@freeshift/shared';
import { userInitial, userSoftBackground } from '../../../lib/colors';
import { Badge } from '../../ui/Badge';
import { Button } from '../../ui/Button';

export interface MemberRowProps {
  user: AppUser;
  manage: boolean;
  busy: boolean;
  isFirst: boolean;
  isLast: boolean;
  onView: () => void;
  onEdit: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onToggleActive: () => void;
  onDelete: () => void;
}

/** 更新时间：2026/3/2（取本地日期即可） */
function updatedLabel(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('zh-CN');
}

/** 管理员成员列表行：头像 / 姓名 + 邮箱 / 我的表名称 / 最近状态；管理模式显示排序、启停、删除 */
export function MemberRow({ user, manage, busy, isFirst, isLast, onView, onEdit, onMoveUp, onMoveDown, onToggleActive, onDelete }: MemberRowProps) {
  return (
    <div className="flex flex-wrap items-center gap-3 px-3 py-2.5 transition-colors duration-150 hover:bg-canvas sm:px-4">
      <span
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold"
        style={{ backgroundColor: userSoftBackground(user.color), color: user.color }}
        aria-hidden
      >
        {userInitial(user.name)}
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className={user.isActive ? 'truncate text-sm font-medium text-ink' : 'truncate text-sm font-medium text-muted'}>
            {user.name}
          </span>
          {user.isActive ? <Badge tone="mint">启用</Badge> : <Badge tone="neutral">已停用</Badge>}
          {user.note ? <Badge tone="outline">{user.note}</Badge> : null}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-2xs text-subtle">
          <span className="truncate">{user.email ?? '无登录邮箱（历史成员）'}</span>
          <span aria-hidden>·</span>
          <span className="truncate">{user.templateName ? '我的表：' + user.templateName : '未设置我的表'}</span>
          <span aria-hidden>·</span>
          <span className="tabular">更新于 {updatedLabel(user.updatedAt)}</span>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1">
        <Button variant="ghost" size="sm" iconLeft={<Eye className="h-3.5 w-3.5" aria-hidden />} onClick={onView}>
          查看个人表
        </Button>
        {manage ? (
          <>
            <Button variant="ghost" size="sm" className="px-1.5" aria-label={'编辑 ' + user.name} disabled={busy} onClick={onEdit}>
              <Pencil className="h-3.5 w-3.5" aria-hidden />
            </Button>
            <Button variant="ghost" size="sm" className="px-1.5" aria-label={'上移 ' + user.name} disabled={busy || isFirst} onClick={onMoveUp}>
              <ChevronUp className="h-4 w-4" aria-hidden />
            </Button>
            <Button variant="ghost" size="sm" className="px-1.5" aria-label={'下移 ' + user.name} disabled={busy || isLast} onClick={onMoveDown}>
              <ChevronDown className="h-4 w-4" aria-hidden />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="px-1.5"
              aria-label={(user.isActive ? '停用 ' : '启用 ') + user.name}
              disabled={busy}
              onClick={onToggleActive}
            >
              <Power className="h-3.5 w-3.5" aria-hidden />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="px-1.5 text-danger hover:bg-red-50"
              aria-label={'彻底删除 ' + user.name}
              disabled={busy}
              onClick={onDelete}
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden />
            </Button>
          </>
        ) : null}
        {manage ? <ArrowUpDown className="ml-0.5 h-3.5 w-3.5 text-subtle" aria-hidden /> : null}
      </div>
    </div>
  );
}
