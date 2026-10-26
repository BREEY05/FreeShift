import { ChevronDown, ChevronUp, GripVertical, Pencil, Trash2, UserCheck, UserX } from 'lucide-react';
import type { DragEvent } from 'react';
import type { AppUser } from '@freeshift/shared';
import { cn } from '../../../lib/cn';
import { userInitial, userSoftBackground } from '../../../lib/colors';
import { Badge } from '../../ui/Badge';
import { Button } from '../../ui/Button';

export interface UserRowProps {
  user: AppUser;
  isFirst: boolean;
  isLast: boolean;
  busy: boolean;
  dragging: boolean;
  dragOver: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onEdit: () => void;
  onToggleActive: () => void;
  onDelete: () => void;
  onDragStart: (event: DragEvent<HTMLDivElement>) => void;
  onDragOver: (event: DragEvent<HTMLDivElement>) => void;
  onDrop: (event: DragEvent<HTMLDivElement>) => void;
  onDragEnd: () => void;
}

/** 成员列表行：颜色块 + 姓名/备注 + 状态 + 排序 / 编辑 / 启停 / 删除 */
export function UserRow({
  user,
  isFirst,
  isLast,
  busy,
  dragging,
  dragOver,
  onMoveUp,
  onMoveDown,
  onEdit,
  onToggleActive,
  onDelete,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
}: UserRowProps) {
  return (
    <div
      draggable={!busy}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      className={cn(
        'flex items-center gap-3 px-3 py-2.5 transition-colors duration-150 sm:px-4',
        dragging ? 'opacity-40' : '',
        dragOver ? 'bg-brand-soft' : 'hover:bg-canvas',
      )}
    >
      <span className="hidden shrink-0 cursor-grab text-subtle sm:flex" title="拖动排序">
        <GripVertical className="h-4 w-4" aria-hidden />
      </span>

      <span
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold"
        style={{ backgroundColor: userSoftBackground(user.color), color: user.color }}
        aria-hidden
      >
        {userInitial(user.name)}
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className={cn('truncate text-sm font-medium', user.isActive ? 'text-ink' : 'text-muted')}>{user.name}</span>
          {user.isActive ? <Badge tone="mint">启用</Badge> : <Badge tone="neutral">已停用</Badge>}
        </div>
        <div className="truncate text-2xs text-subtle">{user.note || '暂无备注'}</div>
      </div>

      <div className="flex shrink-0 items-center gap-0.5">
        <div className="mr-1 flex items-center gap-0.5">
          <Button
            variant="ghost"
            size="sm"
            aria-label={'上移 ' + user.name}
            className="px-1.5"
            disabled={busy || isFirst}
            onClick={onMoveUp}
          >
            <ChevronUp className="h-4 w-4" aria-hidden />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            aria-label={'下移 ' + user.name}
            className="px-1.5"
            disabled={busy || isLast}
            onClick={onMoveDown}
          >
            <ChevronDown className="h-4 w-4" aria-hidden />
          </Button>
        </div>
        <Button variant="ghost" size="sm" aria-label={'编辑 ' + user.name} className="px-1.5" disabled={busy} onClick={onEdit}>
          <Pencil className="h-3.5 w-3.5" aria-hidden />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="px-1.5"
          aria-label={(user.isActive ? '停用 ' : '启用 ') + user.name}
          disabled={busy}
          onClick={onToggleActive}
          iconLeft={
            user.isActive ? (
              <UserX className="h-3.5 w-3.5" aria-hidden />
            ) : (
              <UserCheck className="h-3.5 w-3.5" aria-hidden />
            )
          }
        >
          <span className="hidden sm:inline">{user.isActive ? '停用' : '启用'}</span>
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
      </div>
    </div>
  );
}
