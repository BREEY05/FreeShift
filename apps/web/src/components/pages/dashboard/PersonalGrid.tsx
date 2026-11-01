import { Pencil, Plus } from 'lucide-react';
import type { PersonalBoard, TimeSlot, Weekday } from '@freeshift/shared';
import { WEEKDAY_LABELS, WEEKDAY_ORDER, addDays } from '@freeshift/shared';
import { cn } from '../../../lib/cn';
import { monthDayShortLabel } from '../../../lib/format';

export interface PersonalGridProps {
  board: PersonalBoard;
  /** 只读模式（管理员查看成员个人表） */
  readOnly?: boolean;
  onEdit: (scheduleId: number, weekday: Weekday, slotId: number) => void;
  onCreate: (weekday: Weekday, slotId: number) => void;
}

/** 纯个人表网格：周次 × 星期 × 时间段；点击空闲格新增、点击已占用格编辑 */
export function PersonalGrid({ board, readOnly = false, onEdit, onCreate }: PersonalGridProps) {
  const sortedSlots: TimeSlot[] = [...board.slots].sort((a, b) => a.sortOrder - b.sortOrder);
  const cellMap = new Map<string, { weekday: Weekday; slotId: number; scheduleId: number | null; note: string }>();
  for (const cell of board.cells) cellMap.set(cell.weekday + ':' + cell.slotId, cell);

  return (
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
                  <span className="truncate text-xs font-medium text-ink" title={slot.label}>{slot.label}</span>
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
                  const description =
                    WEEKDAY_LABELS[weekday] +
                    ' ' +
                    slot.label +
                    (occupied ? ' 已占用' + (cell?.note ? '，备注 ' + cell.note : '') : ' 空闲') +
                    (occupied ? '，点击编辑' : '，点击添加安排');
                  return (
                    <button
                      key={weekday + ':' + slot.id}
                      type="button"
                      disabled={readOnly}
                      onClick={() => {
                        if (readOnly) return;
                        if (scheduleId !== null) onEdit(scheduleId, weekday, slot.id);
                        else onCreate(weekday, slot.id);
                      }}
                      aria-label={description}
                      title={readOnly ? description : undefined}
                      className={cn(
                        'group relative flex h-14 w-full flex-col items-center justify-center rounded-control border px-1.5 text-center transition-colors duration-150',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2',
                        readOnly ? 'cursor-default' : 'cursor-pointer',
                        occupied
                          ? 'border-[#C7D2FE] bg-brand-soft text-brand' + (readOnly ? '' : ' hover:bg-indigo-100')
                          : 'border-line bg-surface text-subtle' + (readOnly ? '' : ' hover:border-brand hover:bg-indigo-50 hover:text-brand'),
                      )}
                    >
                      {occupied ? (
                        <>
                          <span className="line-clamp-2 text-2xs font-medium leading-4">{cell?.note || '已占用'}</span>
                          {readOnly ? null : (
                            <Pencil className="absolute right-1.5 top-1.5 h-3 w-3 opacity-0 transition-opacity duration-150 group-hover:opacity-100" aria-hidden />
                          )}
                        </>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-2xs">
                          {readOnly ? null : <Plus className="h-3 w-3 opacity-0 transition-opacity duration-150 group-hover:opacity-100" aria-hidden />}
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
  );
}
