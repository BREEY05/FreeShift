import { AlertTriangle } from 'lucide-react';
import type { ConflictDetail } from '@freeshift/shared';
import { WEEKDAY_LABELS } from '@freeshift/shared';
import { cn } from '../../lib/cn';
import { scheduleRangeLabel } from '../../lib/format';

export interface ConflictBannerProps {
  conflicts: ConflictDetail[];
  title?: string;
  className?: string;
}

export function conflictKey(conflict: ConflictDetail, index: number): string {
  return conflict.weekNo + '-' + conflict.weekday + '-' + conflict.slotId + '-' + index;
}

/** 409 冲突明细展示（对话框/批量条内使用） */
export function ConflictBanner({ conflicts, title, className }: ConflictBannerProps) {
  if (conflicts.length === 0) return null;
  return (
    <div
      role="alert"
      className={cn('rounded-control border border-amber-200 bg-amber-50 px-3 py-2 text-amber', className)}
    >
      <div className="flex items-center gap-1.5 text-xs font-medium">
        <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden />
        <span>{title ?? '发现 ' + conflicts.length + ' 处冲突'}</span>
      </div>
      <ul className="scrollbar-thin mt-1.5 max-h-36 space-y-1 overflow-y-auto pr-1">
        {conflicts.map((conflict, index) => (
          <li key={conflictKey(conflict, index)} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-2xs">
            <span className="font-medium tabular">
              第 {conflict.weekNo} 周 · {WEEKDAY_LABELS[conflict.weekday]} · {conflict.slotLabel}
            </span>
            <span className="text-muted">
              已有安排 {scheduleRangeLabel(conflict.startWeek, conflict.endWeek, conflict.parity)}
              {conflict.note ? ' · ' + conflict.note : ''}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
