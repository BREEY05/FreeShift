import { useQuery } from '@tanstack/react-query';
import { CalendarRange, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import type { FreeBlock, Weekday } from '@freeshift/shared';
import { WEEKDAY_LABELS, WEEKDAY_ORDER } from '@freeshift/shared';
import { fetchCommonFree, recommendKeys } from '../../../api/recommend';
import { getErrorMessage } from '../../../lib/errors';
import { Alert } from '../../ui/Alert';
import { Badge } from '../../ui/Badge';
import { Button } from '../../ui/Button';
import { Card } from '../../ui/Card';
import { EmptyState } from '../../ui/EmptyState';
import { Select } from '../../ui/Input';
import { SegmentedControl } from '../../ui/SegmentedControl';
import { Skeleton } from '../../ui/Skeleton';

export interface CommonFreePanelProps {
  week: number | undefined;
  userIds: number[];
}

function minutesOf(time: string | null): number {
  if (!time) return Number.MAX_SAFE_INTEGER;
  const [hours, minutes] = time.split(':');
  return Number(hours) * 60 + Number(minutes);
}

/** 算法 1：所选成员共同空闲的连续块，按星期分组 */
export function CommonFreePanel({ week, userIds }: CommonFreePanelProps) {
  const [topK, setTopK] = useState(10);
  const [strictAdjacent, setStrictAdjacent] = useState(true);

  const query = useQuery({
    queryKey: recommendKeys.commonFree(week, userIds, topK, strictAdjacent),
    queryFn: () =>
      fetchCommonFree({
        week,
        userIds,
        topK,
        requireTimeAdjacent: strictAdjacent,
      }),
    staleTime: 30_000,
  });

  const blocks = query.data ?? [];
  const groups = WEEKDAY_ORDER.map((weekday: Weekday) => ({
    weekday,
    blocks: blocks
      .filter((block) => block.weekday === weekday)
      .sort((left, right) => minutesOf(left.startTime) - minutesOf(right.startTime)),
  })).filter((group) => group.blocks.length > 0);

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
        <div className="flex items-center gap-2">
          <CalendarRange className="h-4 w-4 text-brand" aria-hidden />
          <h2 className="text-xs font-semibold text-ink">共同空闲块</h2>
          <span className="text-2xs text-subtle">所选成员都没有占用的连续时段</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1.5 text-2xs text-muted">
            显示
            <span className="w-20">
              <Select
                aria-label="共同空闲结果数量"
                value={String(topK)}
                onChange={(event) => setTopK(Number(event.target.value))}
                className="h-8 text-xs"
              >
                {[5, 10, 20, 50].map((value) => (
                  <option key={value} value={value}>
                    前 {value} 块
                  </option>
                ))}
              </Select>
            </span>
          </label>
          <SegmentedControl<'strict' | 'loose'>
            size="sm"
            ariaLabel="相邻判定"
            value={strictAdjacent ? 'strict' : 'loose'}
            onChange={(value) => setStrictAdjacent(value === 'strict')}
            options={[
              { value: 'strict', label: '时间连续' },
              { value: 'loose', label: '仅顺序相邻' },
            ]}
          />
          <Button
            variant="ghost"
            size="sm"
            aria-label="刷新共同空闲"
            disabled={query.isFetching}
            onClick={() => void query.refetch()}
          >
            <RefreshCw className={query.isFetching ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} aria-hidden />
          </Button>
        </div>
      </div>
      <div className="border-b border-line px-4 py-2 text-2xs text-subtle">
        「时间连续」允许 ≤20 分钟课间间隔；「仅顺序相邻」忽略时间间隔，合并所有相邻格子。
      </div>

      {query.isPending ? (
        <div className="space-y-3 px-4 py-4">
          {Array.from({ length: 3 }).map((_, index) => (
            <Skeleton key={index} className="h-16 w-full" />
          ))}
        </div>
      ) : query.isError ? (
        <div className="px-4 py-3">
          <Alert
            tone="danger"
            title="共同空闲计算失败"
            action={
              <Button variant="secondary" size="sm" onClick={() => void query.refetch()}>
                重试
              </Button>
            }
          >
            {getErrorMessage(query.error)}
          </Alert>
        </div>
      ) : groups.length === 0 ? (
        <div className="p-4">
          <EmptyState
            icon={<CalendarRange className="h-5 w-5" aria-hidden />}
            title="所选成员没有共同空闲"
            description="换一个周次、减少参与成员，或先完善成员的占用登记。也可以放宽「仅顺序相邻」以合并相邻格子。"
          />
        </div>
      ) : (
        <div className="divide-y divide-line">
          <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-2xs text-subtle">
            <span>共 {blocks.length} 个空闲块（每块可能包含多个连续时间段）</span>
            <span>按块长度优先排序</span>
          </div>
          {groups.map((group) => (
            <div key={group.weekday} className="px-4 py-3">
              <div className="mb-2 flex items-center gap-2">
                <h3 className="text-xs font-semibold text-ink">{WEEKDAY_LABELS[group.weekday]}</h3>
                <Badge tone="neutral">{group.blocks.length} 块</Badge>
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {group.blocks.map((block: FreeBlock) => (
                  <div key={group.weekday + '-' + block.slotIds.join('-')} className="rounded-control border border-line bg-canvas px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="tabular text-xs font-medium text-ink">
                        {block.startTime ?? '—'} – {block.endTime ?? '—'}
                      </span>
                      <Badge tone="mint">{block.length} 格</Badge>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-1.5 text-2xs text-muted">
                      <span className="tabular">{block.durationMin} 分钟</span>
                      <span aria-hidden>·</span>
                      <span className="truncate">{block.labels.join(' / ')}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}