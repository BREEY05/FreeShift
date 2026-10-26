import { ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import type { WeekInfo } from '@freeshift/shared';
import { WEEK_PARITY_LABELS } from '@freeshift/shared';
import { cn } from '../../lib/cn';
import { formatWeekSpan } from '../../lib/format';
import { Badge } from '../ui/Badge';

export interface WeekSwitcherProps {
  week: WeekInfo | undefined;
  weeks: WeekInfo[] | undefined;
  onChange: (weekNo: number) => void;
  disabled?: boolean;
}

/** 周次切换：‹ 第 N 周 › + 下拉 + 单双周徽标 + 日期范围 */
export function WeekSwitcher({ week, weeks, onChange, disabled = false }: WeekSwitcherProps) {
  const options = weeks && weeks.length > 0 ? weeks : week ? [week] : [];
  const interactive = week !== undefined && !disabled;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="inline-flex items-center rounded-control border border-line bg-surface">
        <button
          type="button"
          aria-label="上一周"
          disabled={!week || !interactive || week.weekNo <= 1}
          onClick={() => week && onChange(week.weekNo - 1)}
          className="flex h-9 w-8 items-center justify-center rounded-l-control text-muted transition-colors duration-150 hover:bg-canvas hover:text-ink disabled:pointer-events-none disabled:opacity-40"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden />
        </button>
        <div className="relative">
          <select
            aria-label="选择周次"
            disabled={!interactive || options.length === 0}
            value={week?.weekNo ?? ''}
            onChange={(event) => onChange(Number(event.target.value))}
            className="h-9 appearance-none bg-transparent pl-1.5 pr-7 text-sm font-medium text-ink focus:outline-none disabled:cursor-not-allowed"
          >
            {options.length === 0 ? <option value="">第 -- 周</option> : null}
            {options.map((item) => (
              <option key={item.weekNo} value={item.weekNo}>
                第 {item.weekNo} 周
              </option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-subtle" aria-hidden />
        </div>
        <button
          type="button"
          aria-label="下一周"
          disabled={!week || !interactive || (weeks ? week.weekNo >= weeks.length : true)}
          onClick={() => week && onChange(week.weekNo + 1)}
          className="flex h-9 w-8 items-center justify-center rounded-r-control text-muted transition-colors duration-150 hover:bg-canvas hover:text-ink disabled:pointer-events-none disabled:opacity-40"
        >
          <ChevronRight className="h-4 w-4" aria-hidden />
        </button>
      </div>

      {week ? (
        <>
          <Badge tone={week.parity === 'odd' ? 'brand' : 'amber'}>{WEEK_PARITY_LABELS[week.parity]}</Badge>
          {week.isCurrent ? <Badge tone="mint">本周</Badge> : null}
          <span className={cn('tabular text-xs text-muted')}>{formatWeekSpan(week.startDate, week.endDate)}</span>
        </>
      ) : (
        <span className="text-xs text-subtle">周次加载中…</span>
      )}
    </div>
  );
}
