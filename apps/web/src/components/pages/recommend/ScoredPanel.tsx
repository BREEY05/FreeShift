import { useQuery } from '@tanstack/react-query';
import { Filter, RefreshCw, Sparkles } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { DayPart, FactorScores, ScoredCell, ScoredInput, Weekday } from '@freeshift/shared';
import { DAY_PART_LABELS, WEEKDAY_LABELS, WEEKDAY_ORDER } from '@freeshift/shared';
import { fetchRecommendConfig, fetchScoredCells, recommendKeys } from '../../../api/recommend';
import { cn } from '../../../lib/cn';
import { getErrorMessage } from '../../../lib/errors';
import { Alert } from '../../ui/Alert';
import { Badge } from '../../ui/Badge';
import { Button } from '../../ui/Button';
import { Card } from '../../ui/Card';
import { EmptyState } from '../../ui/EmptyState';
import { Select } from '../../ui/Input';
import { Skeleton } from '../../ui/Skeleton';
import { FactorBars } from './FactorBars';
import { WeightEditor } from './WeightEditor';

export interface ScoredPanelProps {
  week: number | undefined;
  userIds: number[];
  onNotice: (message: string) => void;
}

function useDebouncedNumber(value: number, delay: number): number {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

function toggleInList<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}

/** 算法 2：多因子加权推荐 + 筛选 + 权重设置 */
export function ScoredPanel({ week, userIds, onNotice }: ScoredPanelProps) {
  const [dayParts, setDayParts] = useState<DayPart[]>([]);
  const [weekdays, setWeekdays] = useState<Weekday[]>([]);
  const [allFreeOnly, setAllFreeOnly] = useState(false);
  const [minFreeRatio, setMinFreeRatio] = useState(0);
  const [topK, setTopK] = useState(20);
  const debouncedRatio = useDebouncedNumber(minFreeRatio, 350);

  const filters = useMemo<ScoredInput['filters']>(() => {
    const next: ScoredInput['filters'] = {};
    if (dayParts.length > 0) next.dayParts = dayParts;
    if (weekdays.length > 0) next.weekdays = weekdays;
    if (allFreeOnly) next.allFreeOnly = true;
    if (debouncedRatio > 0) next.minFreeRatio = debouncedRatio / 100;
    return next;
  }, [dayParts, weekdays, allFreeOnly, debouncedRatio]);

  const configQuery = useQuery({ queryKey: recommendKeys.config(), queryFn: fetchRecommendConfig, staleTime: 60_000 });

  const query = useQuery({
    queryKey: recommendKeys.scored(week, userIds, filters, topK),
    queryFn: () =>
      fetchScoredCells({
        week,
        userIds: userIds.length > 0 ? userIds : undefined,
        filters,
        topK,
      }),
    staleTime: 30_000,
  });

  const cells = query.data ?? [];
  const hasFilters = dayParts.length > 0 || weekdays.length > 0 || allFreeOnly || minFreeRatio > 0;

  function clearFilters() {
    setDayParts([]);
    setWeekdays([]);
    setAllFreeOnly(false);
    setMinFreeRatio(0);
  }

  return (
    <div className="flex flex-col gap-4">
      <WeightEditor onSaved={onNotice} />

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-brand" aria-hidden />
            <h2 className="text-xs font-semibold text-ink">筛选</h2>
            {hasFilters ? <Badge tone="brand">已筛选</Badge> : <span className="text-2xs text-subtle">默认不过滤</span>}
          </div>
          <div className="flex items-center gap-1.5">
            <Button variant="ghost" size="sm" onClick={clearFilters} disabled={!hasFilters}>
              清空筛选
            </Button>
            <label className="flex items-center gap-1.5 text-2xs text-muted">
              显示
              <span className="w-20">
                <Select
                  aria-label="推荐结果数量"
                  value={String(topK)}
                  onChange={(event) => setTopK(Number(event.target.value))}
                  className="h-8 text-xs"
                >
                  {[5, 10, 20, 50].map((value) => (
                    <option key={value} value={value}>
                      前 {value} 个
                    </option>
                  ))}
                </Select>
              </span>
            </label>
          </div>
        </div>

        <div className="space-y-3 px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-2xs text-muted">星期</span>
            {WEEKDAY_ORDER.map((weekday) => {
              const active = weekdays.includes(weekday);
              return (
                <button
                  key={weekday}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setWeekdays((prev) => toggleInList(prev, weekday))}
                  className={cn(
                    'h-7 rounded-control border px-2 text-2xs font-medium transition-colors duration-150',
                    active ? 'border-brand bg-brand-soft text-brand' : 'border-line bg-surface text-muted hover:text-ink',
                  )}
                >
                  {WEEKDAY_LABELS[weekday]}
                </button>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-2xs text-muted">时段</span>
            {(Object.keys(DAY_PART_LABELS) as DayPart[]).map((part) => {
              const active = dayParts.includes(part);
              return (
                <button
                  key={part}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setDayParts((prev) => toggleInList(prev, part))}
                  className={cn(
                    'h-7 rounded-control border px-2 text-2xs font-medium transition-colors duration-150',
                    active ? 'border-brand bg-brand-soft text-brand' : 'border-line bg-surface text-muted hover:text-ink',
                  )}
                >
                  {DAY_PART_LABELS[part]}
                </button>
              );
            })}
            <label className="ml-1 inline-flex items-center gap-1.5 text-2xs text-muted">
              <input
                type="checkbox"
                checked={allFreeOnly}
                onChange={(event) => setAllFreeOnly(event.target.checked)}
                className="h-3.5 w-3.5 cursor-pointer accent-indigo-600"
              />
              仅全员空闲
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="w-16 shrink-0 text-2xs text-muted">最少空闲</span>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={minFreeRatio}
              aria-label="最少空闲比例"
              onChange={(event) => setMinFreeRatio(Number(event.target.value))}
              className="h-1.5 w-40 cursor-pointer accent-indigo-600"
            />
            <span className="tabular text-2xs text-ink">{minFreeRatio}%</span>
            <span className="text-2xs text-subtle">（0 表示不限）</span>
          </div>
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-brand" aria-hidden />
            <h2 className="text-xs font-semibold text-ink">推荐结果</h2>
            <span className="text-2xs text-subtle">按综合得分从高到低</span>
          </div>
          <div className="flex items-center gap-2">
            {!query.isPending && !query.isError ? (
              <span className="tabular text-2xs text-subtle">共 {cells.length} 个候选</span>
            ) : null}
            <Button
              variant="ghost"
              size="sm"
              aria-label="刷新推荐"
              disabled={query.isFetching}
              onClick={() => void query.refetch()}
            >
              <RefreshCw className={query.isFetching ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} aria-hidden />
            </Button>
          </div>
        </div>

        {query.isPending ? (
          <div className="space-y-3 px-4 py-4">
            {Array.from({ length: 3 }).map((_, index) => (
              <Skeleton key={index} className="h-24 w-full" />
            ))}
          </div>
        ) : query.isError ? (
          <div className="px-4 py-3">
            <Alert
              tone="danger"
              title="推荐计算失败"
              action={
                <Button variant="secondary" size="sm" onClick={() => void query.refetch()}>
                  重试
                </Button>
              }
            >
              {getErrorMessage(query.error)}
            </Alert>
          </div>
        ) : cells.length === 0 ? (
          <div className="p-4">
            <EmptyState
              icon={<Sparkles className="h-5 w-5" aria-hidden />}
              title="没有符合条件的候选时段"
              description="筛选取交集后为空：试试放宽「仅全员空闲」或最少空闲比例，清空星期/时段筛选，或切换周次。"
              action={
                hasFilters ? (
                  <Button variant="secondary" onClick={clearFilters}>
                    清空筛选
                  </Button>
                ) : undefined
              }
            />
          </div>
        ) : (
          <ol className="divide-y divide-line">
            {cells.map((cell: ScoredCell, index: number) => {
              const allFree = cell.freeCount === cell.totalUsers;
              return (
                <li key={cell.weekday + '-' + cell.slotId} className="px-4 py-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="flex min-w-0 items-start gap-2.5">
                      <span
                        className={cn(
                          'tabular flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-2xs font-semibold',
                          index < 3 ? 'bg-brand text-white' : 'bg-canvas text-muted',
                        )}
                        aria-label={'排名 ' + (index + 1)}
                      >
                        {index + 1}
                      </span>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-sm font-medium text-ink">
                            {WEEKDAY_LABELS[cell.weekday]} · {cell.slotLabel}
                          </span>
                          {allFree ? <Badge tone="mint">全员空闲</Badge> : <Badge tone="neutral">空闲 {cell.freeCount}/{cell.totalUsers}</Badge>}
                        </div>
                        <div className="tabular mt-0.5 text-2xs text-muted">
                          {cell.startTime ?? '—'} – {cell.endTime ?? '—'} · 连续 {cell.blockLength} 格
                        </div>
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="tabular text-sm font-semibold text-brand">{Math.round(cell.score * 100)}</div>
                      <div className="text-2xs text-subtle">综合得分</div>
                    </div>
                  </div>

                  <div className="mt-2">
                    <FactorBars factors={cell.factors as FactorScores} weights={configQuery.data?.weights} />
                  </div>

                  {cell.reasons.length > 0 ? (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {cell.reasons.map((reason) => (
                        <Badge key={reason} tone="brand">
                          {reason}
                        </Badge>
                      ))}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ol>
        )}
      </Card>
    </div>
  );
}
