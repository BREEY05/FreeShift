import { Check } from 'lucide-react';
import type { KeyboardEvent, MouseEvent } from 'react';
import type { BoardCell, TimeSlot, Weekday } from '@freeshift/shared';
import { WEEKDAY_LABELS } from '@freeshift/shared';
import { cn } from '../../lib/cn';
import { heatTierOf } from '../../lib/colors';

export interface GridCellProps {
  weekday: Weekday;
  slot: TimeSlot;
  cell: BoardCell | undefined;
  totalUsers: number;
  batchMode?: boolean;
  selected?: boolean;
  onActivate: () => void;
  onPointerDown?: (event: MouseEvent<HTMLButtonElement>) => void;
  onPointerEnter?: () => void;
  onKeyboardToggle?: () => void;
  disabled?: boolean;
}

/** 聚合网格格子：只显示空闲人数 + 热度底色 */
export function GridCell({
  weekday,
  slot,
  cell,
  totalUsers,
  batchMode = false,
  selected = false,
  onActivate,
  onPointerDown,
  onPointerEnter,
  onKeyboardToggle,
  disabled = false,
}: GridCellProps) {
  const freeCount = cell?.freeCount ?? 0;
  const total = cell?.totalUsers ?? totalUsers;
  const tier = heatTierOf(freeCount, total);

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (!batchMode) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onKeyboardToggle?.();
    }
  }

  return (
    <button
      type="button"
      disabled={disabled}
      aria-pressed={batchMode ? selected : undefined}
      aria-label={
        WEEKDAY_LABELS[weekday] + ' ' + slot.label + ' 空闲 ' + freeCount + ' 人' + (batchMode ? '，点击切换选中' : '，点击查看详情')
      }
      onMouseDown={onPointerDown}
      onMouseEnter={onPointerEnter}
      onClick={batchMode ? undefined : onActivate}
      onKeyDown={handleKeyDown}
      className={cn(
        'group relative flex h-14 w-full select-none flex-col items-center justify-center rounded-control border text-center transition-[filter,box-shadow] duration-150',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2',
        batchMode ? 'cursor-crosshair' : 'cursor-pointer hover:brightness-95',
        selected && 'ring-2 ring-brand ring-offset-1 ring-offset-surface',
        disabled && 'cursor-default opacity-60',
      )}
      style={{
        backgroundColor: tier.background,
        borderColor: selected ? 'var(--fs-brand)' : tier.border,
        color: tier.text,
      }}
    >
      <span className="tabular text-xs font-medium">空闲 {freeCount} 人</span>
      {selected ? (
        <span className="absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded-full bg-brand text-white">
          <Check className="h-2.5 w-2.5" aria-hidden />
        </span>
      ) : null}
    </button>
  );
}
