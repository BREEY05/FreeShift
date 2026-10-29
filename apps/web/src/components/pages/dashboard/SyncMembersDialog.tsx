import { Check, UserRoundCheck } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { AppUser } from '@freeshift/shared';
import { cn } from '../../../lib/cn';
import { Button } from '../../ui/Button';
import { Dialog } from '../../ui/Dialog';
import { EmptyState } from '../../ui/EmptyState';

export interface SyncMembersDialogProps {
  open: boolean;
  /** 可选的成员（当前组织内启用中的成员） */
  users: AppUser[];
  /** 当前已保存的同步选择；null 表示展示全部成员 */
  initialIds: number[] | null;
  onClose: () => void;
  /** 确认：传 null 表示取消同步（展示全部成员） */
  onConfirm: (ids: number[] | null) => void;
}

/** 同步成员：多选成员后只汇总所选成员的空闲，默认全选 */
export function SyncMembersDialog({ open, users, initialIds, onClose, onConfirm }: SyncMembersDialogProps) {
  const allIds = useMemo(() => users.map((user) => user.id), [users]);
  const [selectedIds, setSelectedIds] = useState<number[]>(allIds);

  useEffect(() => {
    if (!open) return;
    // 打开时：有保存的选择则用它（过滤掉已不存在/已停用的成员），否则默认全选
    const base = initialIds && initialIds.length > 0 ? initialIds.filter((id) => allIds.includes(id)) : allIds;
    setSelectedIds(base.length > 0 ? base : allIds);
  }, [open, initialIds, allIds]);

  const selectedSet = new Set(selectedIds);
  const allSelected = users.length > 0 && selectedIds.length === users.length;

  function toggle(id: number) {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]));
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="md"
      title="同步成员"
      description="选择要汇总空闲的成员，选择会保存在本机，下次打开看板自动沿用。"
      footer={
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-2xs text-subtle">已选 {selectedIds.length} / {users.length} 人</span>
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={onClose}>
              取消
            </Button>
            <Button
              variant="primary"
              iconLeft={<UserRoundCheck className="h-4 w-4" aria-hidden />}
              disabled={selectedIds.length === 0}
              onClick={() => {
                if (selectedIds.length === users.length) onConfirm(null);
                else onConfirm(selectedIds);
              }}
            >
              {selectedIds.length === users.length ? '汇总全部成员' : '同步所选成员'}
            </Button>
          </div>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setSelectedIds(allSelected ? [] : allIds)}
            disabled={users.length === 0}
          >
            {allSelected ? '清空' : '全选'}
          </Button>
          <button
            type="button"
            className="text-2xs text-muted underline-offset-2 hover:text-ink hover:underline"
            onClick={() => onConfirm(null)}
          >
            恢复为组织全部成员
          </button>
        </div>

        {users.length === 0 ? (
          <EmptyState compact icon={<UserRoundCheck className="h-5 w-5" aria-hidden />} title="暂无可同步的成员" description="先在「用户」页添加成员。" />
        ) : (
          <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
            {users.map((user) => {
              const active = selectedSet.has(user.id);
              return (
                <li key={user.id}>
                  <button
                    type="button"
                    aria-pressed={active}
                    onClick={() => toggle(user.id)}
                    className={cn(
                      'flex w-full items-center gap-2 rounded-control border px-2.5 py-2 text-left text-xs transition-colors duration-150',
                      active ? 'border-brand bg-brand-soft text-brand' : 'border-line bg-surface text-ink hover:bg-canvas',
                    )}
                  >
                    <span
                      className={cn(
                        'flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border',
                        active ? 'border-brand bg-brand text-white' : 'border-line bg-surface text-transparent',
                      )}
                      aria-hidden
                    >
                      <Check className="h-3 w-3" />
                    </span>
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: user.color }} aria-hidden />
                    <span className="min-w-0 flex-1 truncate font-medium">{user.name}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Dialog>
  );
}
