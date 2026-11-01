import { CalendarClock, Pencil, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { Weekday } from '@freeshift/shared';
import { useSemester } from '../../../hooks/useSemester';
import { useMemberBoard } from '../../../hooks/useUsers';
import { Alert } from '../../ui/Alert';
import { Badge } from '../../ui/Badge';
import { Button } from '../../ui/Button';
import { Card } from '../../ui/Card';
import { EmptyState } from '../../ui/EmptyState';
import { ScheduleFormDialog } from '../../schedule/ScheduleFormDialog';
import { ScheduleSkeleton } from '../../schedule/ScheduleSkeleton';
import { Skeleton } from '../../ui/Skeleton';
import { UserAvatar } from '../../schedule/UserChip';
import { OrgRequiredNotice } from '../../layout/OrgRequiredNotice';
import { PersonalGrid } from './PersonalGrid';

type FormState =
  | { mode: 'create'; weekday: Weekday; slotId: number }
  | { mode: 'edit'; scheduleId: number; weekday: Weekday; slotId: number };

export interface PersonalBoardPanelProps {
  userId: number;
  /** null = 由服务端取当前周 */
  week: number | null;
  /** 默认只读；总览页传 true 可点击录入/编辑 */
  editable?: boolean;
  onSaved?: (message: string) => void;
}

/** 个人表面板：取 /board/user/:id（个人 slots），渲染网格并处理新增/编辑安排 */
export function PersonalBoardPanel({ userId, week, editable = false, onSaved }: PersonalBoardPanelProps) {
  const boardQuery = useMemberBoard(userId, week);
  const semesterQuery = useSemester();
  const [form, setForm] = useState<FormState | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const board = boardQuery.data;
  const totalWeeks = board?.semester.totalWeeks ?? semesterQuery.data?.semester.totalWeeks ?? 1;
  const weeks = semesterQuery.data?.weeks ?? [];

  function handleSaved(message: string) {
    setForm(null);
    setStatus(message);
    onSaved?.(message);
    window.setTimeout(() => setStatus((prev) => (prev === message ? null : prev)), 5000);
  }

  if (boardQuery.isPending) {
    return (
      <Card className="overflow-hidden">
        <div className="border-b border-line px-4 py-3">
          <Skeleton className="h-4 w-40" />
        </div>
        <div className="px-3 py-3 sm:px-4">
          <ScheduleSkeleton />
        </div>
      </Card>
    );
  }

  if (boardQuery.isError || !board) {
    return <OrgRequiredNotice error={boardQuery.error} title="个人表加载失败" />;
  }

  const sortedSlots = [...board.slots].sort((a, b) => a.sortOrder - b.sortOrder);
  const occupiedCount = board.cells.filter((cell) => cell.scheduleId !== null).length;
  const freeCount = board.cells.length - occupiedCount;

  return (
    <div className="flex flex-col gap-3">
      {status ? <Alert tone="success">{status}</Alert> : null}

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
          <div className="flex min-w-0 flex-wrap items-center gap-2.5">
            <UserAvatar user={board.user} />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="truncate text-sm font-medium text-ink">{board.user.name}</span>
                {board.user.email ? <span className="truncate text-2xs text-subtle">{board.user.email}</span> : null}
              </div>
              <div className="truncate text-2xs text-muted">{board.user.note || '个人安排'}</div>
            </div>
            <Badge tone="brand">占用 {occupiedCount} 格</Badge>
            <Badge tone="neutral">空闲 {freeCount} 格</Badge>
            {board.user.templateName ? <Badge tone="outline">我的表：{board.user.templateName}</Badge> : null}
          </div>
          <div className="flex items-center gap-2">
            <span className="tabular text-2xs text-subtle">第 {board.week.weekNo} 周</span>
            <Button
              variant="ghost"
              size="sm"
              aria-label="刷新个人表"
              onClick={() => void boardQuery.refetch()}
              disabled={boardQuery.isFetching}
            >
              <RefreshCw className={boardQuery.isFetching ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} aria-hidden />
            </Button>
          </div>
        </div>

        {sortedSlots.length === 0 ? (
          <div className="p-4">
            <EmptyState
              compact
              icon={<CalendarClock className="h-5 w-5" aria-hidden />}
              title="你的个人表还没有时间段"
              description="在「时间段」页选择一个同类型模板作为我的表，或新建一张自己的表。"
              action={
                <Link to="/slots">
                  <Button variant="primary">去时间段页</Button>
                </Link>
              }
            />
          </div>
        ) : (
          <>
            <PersonalGrid
              board={board}
              readOnly={!editable}
              onEdit={(scheduleId, weekday, slotId) => setForm({ mode: 'edit', scheduleId, weekday, slotId })}
              onCreate={(weekday, slotId) => setForm({ mode: 'create', weekday, slotId })}
            />
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-line px-4 py-2 text-2xs text-muted">
              <span className="inline-flex items-center gap-1">
                <span className="inline-block h-3 w-3 rounded-[4px] border border-[#C7D2FE] bg-brand-soft" aria-hidden />
                已占用
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="inline-block h-3 w-3 rounded-[4px] border border-line bg-surface" aria-hidden />
                空闲
              </span>
              <span className="inline-flex items-center gap-1 text-subtle">
                <Pencil className="h-3 w-3" aria-hidden />
                {editable ? '点击已占用格编辑/删除，点击空闲格新增安排' : '仅查看：该成员的个人安排'}
              </span>
            </div>
          </>
        )}
      </Card>

      {form ? (
        <ScheduleFormDialog
          mode={form.mode}
          scheduleId={form.mode === 'edit' ? form.scheduleId : undefined}
          defaultWeekday={form.weekday}
          defaultSlotId={form.slotId}
          defaultUserId={board.user.id}
          defaultStartWeek={board.week.weekNo}
          users={[board.user]}
          slots={sortedSlots}
          weeks={weeks}
          totalWeeks={totalWeeks}
          onClose={() => setForm(null)}
          onSaved={handleSaved}
        />
      ) : null}
    </div>
  );
}
