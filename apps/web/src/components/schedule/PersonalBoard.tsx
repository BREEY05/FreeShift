import { ArrowLeft, Pencil, Plus } from 'lucide-react';
import type { PersonalBoard as PersonalBoardData, TimeSlot, Weekday } from '@freeshift/shared';
import { WEEKDAY_LABELS, WEEKDAY_ORDER, addDays } from '@freeshift/shared';
import { cn } from '../../lib/cn';
import { monthDayShortLabel } from '../../lib/format';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { UserAvatar } from './UserChip';

export interface PersonalBoardProps {
  board: PersonalBoardData;
  onEdit: (scheduleId: number) => void;
  onCreate: (weekday: Weekday, slotId: number) => void;
  onBack: () => void;
}

/** 个人视图：品牌色浅底表示已占用（带备注），空白格表示空闲 */
export function PersonalBoard({ board, onEdit, onCreate, onBack }: PersonalBoardProps) {
  const sortedSlots: TimeSlot[] = [...board.slots].sort((a, b) => a.sortOrder - b.sortOrder);
  const cellMap = new Map<string, { weekday: Weekday; slotId: number; scheduleId: number | null; note: string }>();
  for (const cell of board.cells) cellMap.set(cell.weekday + ':' + cell.slotId, cell);

  const occupiedCount = board.cells.filter((cell) => cell.scheduleId !== null).length;
  const freeCount = board.cells.length - occupiedCount;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2.5">
          <UserAvatar user={board.user} />
          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-ink">{board.user.name}</div>
            <div className="truncate text-2xs text-muted">{board.user.note || '个人安排视图'}</div>
          </div>
          <Badge tone="brand">占用 {occupiedCount} 格</Badge>
          <Badge tone="neutral">空闲 {freeCount} 格</Badge>
        </div>
        <Button variant="ghost" size="sm" iconLeft={<ArrowLeft className="h-4 w-4" aria-hidden />} onClick={onBack}>
          返回聚合
        </Button>
      </div>

      <div className="scrollbar-thin overflow-x-auto px-3 py-3 sm:px-4">
        <div className="min-w-[880px]">
          <div className="mb-1.5 flex">
            <div className="sticky left-0 z-20 w-[116px] shrink-0 bg-surface pr-1.5">
              <div className="flex h-9 items-end px-2 pb-1 text-2xs font-medium text-subtle">时间段</div>
            </div>
            <div className="grid min-w-[744px] flex-1 grid-cols-7 gap-1.5">
              {WEEKDAY_ORDER.map((weekday) => (
                <div key={weekday} className="rounded-control bg-canvas px-1 py-1 text-center">
                  <div className="text-xs font-medium text-ink">{WEEKDAY_LABELS[weekday]}</div>
                  <div className="tabular text-2xs text-subtle">
                    {monthDayShortLabel(addDays(board.week.startDate, weekday - 1))}
                  </div>
                </div>
              ))}
            </div>
          </div>

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
                    const cell = cellMap.get(weekday + ':' + slot.id);
                    const scheduleId = cell?.scheduleId ?? null;
                    const occupied = scheduleId !== null;
                    return (
                      <button
                        key={weekday + ':' + slot.id}
                        type="button"
                        onClick={() => {
                          if (scheduleId !== null) onEdit(scheduleId);
                          else onCreate(weekday, slot.id);
                        }}
                        aria-label={
                          WEEKDAY_LABELS[weekday] +
                          ' ' +
                          slot.label +
                          (occupied ? ' 已占用' + (cell?.note ? '，备注 ' + cell.note : '') + '，点击编辑' : ' 空闲，点击添加安排')
                        }
                        className={cn(
                          'group relative flex h-14 w-full flex-col items-center justify-center rounded-control border px-1.5 text-center transition-colors duration-150',
                          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2',
                          occupied
                            ? 'cursor-pointer border-[#C7D2FE] bg-brand-soft text-brand hover:bg-indigo-100'
                            : 'cursor-pointer border-line bg-surface text-subtle hover:border-brand hover:bg-indigo-50 hover:text-brand',
                        )}
                      >
                        {occupied ? (
                          <>
                            <span className="line-clamp-2 text-2xs font-medium leading-4">{cell?.note || '已占用'}</span>
                            <Pencil
                              className="absolute right-1.5 top-1.5 h-3 w-3 opacity-0 transition-opacity duration-150 group-hover:opacity-100"
                              aria-hidden
                            />
                          </>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-2xs">
                            <Plus className="h-3 w-3 opacity-0 transition-opacity duration-150 group-hover:opacity-100" aria-hidden />
                            空闲
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-line px-4 py-2 text-2xs text-muted">
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-3 w-3 rounded-[4px] border border-[#C7D2FE] bg-brand-soft" aria-hidden />
          已占用（品牌色）
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-3 w-3 rounded-[4px] border border-line bg-surface" aria-hidden />
          空闲
        </span>
        <span className="text-subtle">点击已占用格编辑/删除，点击空闲格新增安排</span>
      </div>
    </div>
  );
}
