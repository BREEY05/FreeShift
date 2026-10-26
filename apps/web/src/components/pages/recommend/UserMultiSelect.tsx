import type { AppUser } from '@freeshift/shared';
import { Check } from 'lucide-react';
import { cn } from '../../../lib/cn';
import { Badge } from '../../ui/Badge';
import { Button } from '../../ui/Button';

export interface UserMultiSelectProps {
  users: AppUser[];
  selectedIds: number[];
  onChange: (ids: number[]) => void;
  disabled?: boolean;
}

/** 成员多选 chips：色点 + 姓名，支持全选/清空 */
export function UserMultiSelect({ users, selectedIds, onChange, disabled = false }: UserMultiSelectProps) {
  const selected = new Set(selectedIds);
  const allSelected = users.length > 0 && selectedIds.length === users.length;

  function toggle(id: number) {
    if (selected.has(id)) onChange(selectedIds.filter((item) => item !== id));
    else onChange([...selectedIds, id]);
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-medium text-muted">参与成员</span>
          <Badge tone="neutral">
            {selectedIds.length} / {users.length}
          </Badge>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" disabled={disabled || allSelected} onClick={() => onChange(users.map((user) => user.id))}>
            全选
          </Button>
          <Button variant="ghost" size="sm" disabled={disabled || selectedIds.length === 0} onClick={() => onChange([])}>
            清空
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {users.map((user) => {
          const active = selected.has(user.id);
          return (
            <button
              key={user.id}
              type="button"
              aria-pressed={active}
              disabled={disabled}
              onClick={() => toggle(user.id)}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors duration-150',
                active
                  ? 'border-brand bg-brand-soft font-medium text-brand'
                  : 'border-line bg-surface text-muted hover:border-subtle hover:text-ink',
              )}
            >
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: user.color }} aria-hidden />
              <span className="max-w-[120px] truncate">{user.name}</span>
              {active ? <Check className="h-3 w-3" aria-hidden /> : null}
            </button>
          );
        })}
      </div>

      <p className="text-2xs leading-4 text-subtle">
        {selectedIds.length === 0 ? '未勾选任何成员：按全部启用成员计算。' : '只统计所选成员在这些格子的空闲情况。'}
      </p>
    </div>
  );
}
