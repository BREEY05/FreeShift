import type { MouseEvent } from 'react';
import type { BoardCell, TimeSlot, WeekInfo, Weekday } from '@freeshift/shared';
import { WEEKDAY_LABELS, WEEKDAY_ORDER, addDays } from '@freeshift/shared';
import { monthDayShortLabel } from '../../lib/format';
import { cellKey } from '../../lib/schedules';
import { GridCell } from './GridCell';

export interface AggregateGridProps {
  week: WeekInfo;
  slots: TimeSlot[];
  cells: BoardCell[];
  totalUsers: number;
  batchMode: boolean;
  selected: Set<string>;
  /** null 表示不筛选；否则仅显示集合内的格子（用于「全空闲 / 部分空闲」筛选） */
  visibleKeys: Set<string> | null;
  onOpenCell: (weekday: Weekday, slot: TimeSlot) => void;
  onCellPointerDown: (key: string, event: MouseEvent<HTMLButtonElement>) => void;
  onCellPointerEnter: (key: string) => void;
  onCellKeyboardToggle: (key: string) => void;
}

/** 时间段 × 星期 聚合表格；首列 sticky，窄屏横向滚动 */
export function AggregateGrid({
  week,
  slots,
  cells,
  totalUsers,
  batchMode,
  selected,
  visibleKeys,
  onOpenCell,
  onCellPointerDown,
  onCellPointerEnter,
  onCellKeyboardToggle,
}: AggregateGridProps) {
  const sortedSlots = [...slots].sort((a, b) => a.sortOrder - b.sortOrder);
  const cellMap = new Map<string, BoardCell>();
  for (const cell of cells) cellMap.set(cellKey(cell.weekday, cell.slotId), cell);

  return (
    <div className="min-w-[880px]">
      {/* 表头 */}
      <div className="mb-1.5 flex">
        <div className="sticky left-0 z-20 w-[116px] shrink-0 bg-surface pr-1.5">
          <div className="flex h-9 items-end px-2 pb-1 text-2xs font-medium text-subtle">时间段</div>
        </div>
        <div className="grid min-w-[744px] flex-1 grid-cols-7 gap-1.5">
          {WEEKDAY_ORDER.map((weekday) => (
            <div key={weekday} className="rounded-control bg-canvas px-1 py-1 text-center">
              <div className="text-xs font-medium text-ink">{WEEKDAY_LABELS[weekday]}</div>
              <div className="tabular text-2xs text-subtle">{monthDayShortLabel(addDays(week.startDate, weekday - 1))}</div>
            </div>
          ))}
        </div>
      </div>

      {/* 网格行 */}
      <div className="space-y-1.5">
        {sortedSlots.map((slot) => (
          <div key={slot.id} className="flex">
            <div className="sticky left-0 z-20 w-[116px] shrink-0 bg-surface pr-1.5">
              <div className="flex h-14 flex-col justify-center gap-0.5 rounded-control border border-line bg-surface px-2">
                <span className="truncate text-xs font-medium text-ink" title={slot.label}>
                  {slot.label}
                </span>
                <span className="tabular text-2xs text-subtle">
                  {slot.startTime ?? '--:--'}
                  {slot.endTime ? '–' + slot.endTime : ''}
                </span>
              </div>
            </div>
            <div className="grid min-w-[744px] flex-1 grid-cols-7 gap-1.5">
              {WEEKDAY_ORDER.map((weekday) => {
                const key = cellKey(weekday, slot.id);
                if (visibleKeys !== null && !visibleKeys.has(key)) {
                  return (
                    <div key={key} aria-hidden className="h-14 rounded-control border border-dashed border-line bg-canvas" />
                  );
                }
                return (
                  <GridCell
                    key={key}
                    weekday={weekday}
                    slot={slot}
                    cell={cellMap.get(key)}
                    totalUsers={totalUsers}
                    batchMode={batchMode}
                    selected={selected.has(key)}
                    onActivate={() => onOpenCell(weekday, slot)}
                    onPointerDown={(event) => onCellPointerDown(key, event)}
                    onPointerEnter={() => onCellPointerEnter(key)}
                    onKeyboardToggle={() => onCellKeyboardToggle(key)}
                  />
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
