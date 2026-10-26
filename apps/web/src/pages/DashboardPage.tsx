import { CalendarClock, Filter, LayoutGrid, MousePointer2, Plus, Settings, User as UserIcon, Users } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import type { AppUser, TimeSlot, Weekday } from '@freeshift/shared';
import { ApiError } from '../api/client';
import { useAggregateBoard, usePersonalBoard, useWeekSchedules } from '../hooks/useBoard';
import { useSemester } from '../hooks/useSemester';
import { useUsers } from '../hooks/useUsers';
import { useViewParam, type DashboardView } from '../hooks/useViewParam';
import { useWeekParam } from '../hooks/useWeek';
import { getErrorMessage } from '../lib/errors';
import { cellKey, groupBatchCells } from '../lib/schedules';
import { AggregateGrid } from '../components/schedule/AggregateGrid';
import { BatchSelectBar } from '../components/schedule/BatchSelectBar';
import { CellDrawer } from '../components/schedule/CellDrawer';
import { GridLegend } from '../components/schedule/GridLegend';
import { PersonalBoard } from '../components/schedule/PersonalBoard';
import { RefreshButton } from '../components/schedule/RefreshButton';
import { ScheduleFormDialog } from '../components/schedule/ScheduleFormDialog';
import { ScheduleSkeleton } from '../components/schedule/ScheduleSkeleton';
import { WeekSwitcher } from '../components/schedule/WeekSwitcher';
import { Alert } from '../components/ui/Alert';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { EmptyState } from '../components/ui/EmptyState';
import { Select } from '../components/ui/Input';
import { SegmentedControl } from '../components/ui/SegmentedControl';
import { Skeleton } from '../components/ui/Skeleton';

type FormDialogState =
  | { mode: 'create'; weekday?: Weekday; slotId?: number; userId?: number; startWeek?: number }
  | { mode: 'edit'; scheduleId: number };

interface DrawerState {
  weekday: Weekday;
  slotId: number;
}

/** 聚合格子筛选：全部 / 全空闲 / 部分空闲 */
type CellFilter = 'all' | 'full_free' | 'partial';

/** 主看板：聚合/个人视图、周次同步、抽屉、批选录入 */
export default function DashboardPage() {
  const navigate = useNavigate();
  const semesterQuery = useSemester();
  const usersQuery = useUsers();
  const { week: weekParam, setWeek } = useWeekParam(semesterQuery.data?.semester.totalWeeks);
  const { view, userId, setView, setUserId } = useViewParam();

  const aggregateQuery = useAggregateBoard(weekParam);
  const board = aggregateQuery.data;
  const semester = semesterQuery.data?.semester;
  const semesterWeeks = semesterQuery.data?.weeks ?? [];

  const activeUsers: AppUser[] = usersQuery.data ?? [];
  const effectiveUserId = userId ?? activeUsers[0]?.id ?? null;
  const personalQuery = usePersonalBoard(view === 'personal' ? effectiveUserId : null, weekParam);

  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [drawerCell, setDrawerCell] = useState<DrawerState | null>(null);
  const [formDialog, setFormDialog] = useState<FormDialogState | null>(null);
  const [batchMode, setBatchMode] = useState(false);
  const [cellFilter, setCellFilter] = useState<CellFilter>('all');
  const [selected, setSelected] = useState<Set<string>>(() => new Set<string>());
  const dragRef = useRef<{ active: boolean; mode: 'add' | 'remove' } | null>(null);

  const boardWeek = board?.week;
  const currentWeek = semesterWeeks.find((week) => week.isCurrent)?.weekNo ?? 1;
  const displayWeek =
    boardWeek ??
    (weekParam !== null ? semesterWeeks.find((week) => week.weekNo === weekParam) : undefined) ??
    semesterWeeks.find((week) => week.isCurrent) ??
    semesterWeeks[0];
  const weekNo = boardWeek?.weekNo ?? displayWeek?.weekNo ?? null;

  const schedulesQuery = useWeekSchedules(drawerCell ? weekNo : null);

  const selectedCells = useMemo(() => groupBatchCells(selected), [selected]);
  const selectedCount = selected.size;

  /** null = 不筛选；否则为需要展示的格子键集合（客户端过滤，不改后端） */
  const visibleKeys = useMemo(() => {
    if (!board || cellFilter === 'all') return null;
    const keys = new Set<string>();
    for (const cell of board.cells) {
      if (cellFilter === 'full_free' && cell.totalUsers > 0 && cell.freeCount === cell.totalUsers) {
        keys.add(cellKey(cell.weekday, cell.slotId));
      } else if (cellFilter === 'partial' && cell.freeCount > 0 && cell.freeCount < cell.totalUsers) {
        keys.add(cellKey(cell.weekday, cell.slotId));
      }
    }
    return keys;
  }, [board, cellFilter]);
  const matchedCount = visibleKeys === null ? (board?.cells.length ?? 0) : visibleKeys.size;

  const drawerData = useMemo(() => {
    if (!drawerCell || !board) return null;
    const slot = board.slots.find((item) => item.id === drawerCell.slotId);
    if (!slot) return null;
    const cell = board.cells.find((item) => item.weekday === drawerCell.weekday && item.slotId === drawerCell.slotId);
    const userMap = new Map<number, AppUser>();
    for (const user of board.users) userMap.set(user.id, user);
    const pick = (ids: number[] | undefined) =>
      (ids ?? [])
        .map((id) => userMap.get(id))
        .filter((user): user is AppUser => user !== undefined);
    return {
      week: board.week,
      weekday: drawerCell.weekday,
      slot,
      freeUsers: pick(cell?.freeUserIds),
      occupiedUsers: pick(cell?.occupiedUserIds),
    };
  }, [drawerCell, board]);

  useEffect(() => {
    if (!statusMessage) return;
    const timer = window.setTimeout(() => setStatusMessage(null), 6000);
    return () => window.clearTimeout(timer);
  }, [statusMessage]);

  useEffect(() => {
    setDrawerCell(null);
  }, [weekNo]);

  useEffect(() => {
    function endDrag() {
      dragRef.current = null;
    }
    window.addEventListener('mouseup', endDrag);
    window.addEventListener('blur', endDrag);
    return () => {
      window.removeEventListener('mouseup', endDrag);
      window.removeEventListener('blur', endDrag);
    };
  }, []);

  useEffect(() => {
    if (!batchMode) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setBatchMode(false);
        setSelected(new Set<string>());
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [batchMode]);

  const exitBatchMode = useCallback(() => {
    setBatchMode(false);
    setSelected(new Set<string>());
  }, []);

  function handleViewChange(next: DashboardView) {
    if (next === 'personal') {
      exitBatchMode();
      setDrawerCell(null);
    }
    setView(next);
  }

  function handleBatchToggle() {
    // 个人视图点批选：自动切回聚合并进入批选，避免两个视图互相干扰
    if (view === 'personal') {
      setView('aggregate');
      setCellFilter('all');
      setDrawerCell(null);
      setSelected(new Set<string>());
      setBatchMode(true);
      return;
    }
    if (batchMode) {
      exitBatchMode();
      return;
    }
    // 批选时清掉筛选，保证所有格子都可选
    setDrawerCell(null);
    setCellFilter('all');
    setBatchMode(true);
  }

  function handleFilterChange(next: CellFilter) {
    setCellFilter(next);
    setSelected(new Set<string>());
    setDrawerCell(null);
  }

  function handleCellActivate(weekday: Weekday, slot: TimeSlot) {
    if (batchMode) return;
    setDrawerCell({ weekday, slotId: slot.id });
  }

  const handleCellPointerDown = useCallback(
    (key: string, event: MouseEvent<HTMLButtonElement>) => {
      if (!batchMode) return;
      event.preventDefault();
      const willSelect = !selected.has(key);
      dragRef.current = { active: true, mode: willSelect ? 'add' : 'remove' };
      setSelected((prev) => {
        const next = new Set(prev);
        if (willSelect) next.add(key);
        else next.delete(key);
        return next;
      });
    },
    [batchMode, selected],
  );

  const handleCellPointerEnter = useCallback(
    (key: string) => {
      const drag = dragRef.current;
      if (!batchMode || !drag?.active) return;
      setSelected((prev) => {
        const next = new Set(prev);
        if (drag.mode === 'add') next.add(key);
        else next.delete(key);
        return next;
      });
    },
    [batchMode],
  );

  const handleCellKeyboardToggle = useCallback((key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  function handleDrawerPickUser(user: AppUser) {
    setDrawerCell(null);
    setUserId(user.id);
    setView('personal');
  }

  function handleDrawerAddSchedule() {
    if (!drawerCell) return;
    setFormDialog({
      mode: 'create',
      weekday: drawerCell.weekday,
      slotId: drawerCell.slotId,
      // 优先预填该格子的第一位空闲成员，避免默认选中已占用的人
      userId: drawerData?.freeUsers[0]?.id ?? effectiveUserId ?? undefined,
      startWeek: weekNo ?? currentWeek,
    });
    setDrawerCell(null);
  }

  function handleDialogSaved(message: string) {
    setFormDialog(null);
    setStatusMessage(message);
  }

  function handleBatchSaved(message: string) {
    setStatusMessage(message);
    exitBatchMode();
  }

  const corePending = semesterQuery.isPending || usersQuery.isPending;
  const aggregateError = aggregateQuery.isError;
  const usersEmpty = usersQuery.isSuccess && activeUsers.length === 0;
  const semesterMissing =
    semesterQuery.isError && semesterQuery.error instanceof ApiError && semesterQuery.error.status === 404;

  const formTotalWeeks = semester?.totalWeeks ?? semesterWeeks.length;

  return (
    <div className={'flex flex-col gap-4' + (batchMode ? ' pb-64 sm:pb-48' : '')}>
      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-base font-semibold tracking-tight text-ink">{semester?.name ?? '总览'}</h1>
              {semester ? <Badge tone="neutral">{semester.totalWeeks} 周</Badge> : null}
              {semester && !semester.isActive ? <Badge tone="amber">未启用</Badge> : null}
            </div>
            <p className="mt-0.5 text-xs text-muted">按「周次 × 星期 × 时间段」查看空闲人数，点击格子查看名单并登记安排。</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <RefreshButton />
            <SegmentedControl<DashboardView>
              ariaLabel="视图切换"
              value={view}
              onChange={handleViewChange}
              options={[
                {
                  value: 'aggregate',
                  label: (
                    <span className="inline-flex items-center gap-1">
                      <LayoutGrid className="h-3.5 w-3.5" aria-hidden />
                      聚合
                    </span>
                  ),
                },
                {
                  value: 'personal',
                  label: (
                    <span className="inline-flex items-center gap-1">
                      <UserIcon className="h-3.5 w-3.5" aria-hidden />
                      个人
                    </span>
                  ),
                },
              ]}
            />
            <Button
              variant={view === 'aggregate' && batchMode ? 'soft' : 'secondary'}
              iconLeft={<MousePointer2 className="h-4 w-4" aria-hidden />}
              onClick={handleBatchToggle}
              title={view === 'personal' ? '切换到聚合视图并进入批选' : undefined}
            >
              {view === 'aggregate' && batchMode ? '退出批选' : '批选'}
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <WeekSwitcher week={displayWeek} weeks={semesterWeeks} onChange={setWeek} disabled={corePending} />
            {view === 'aggregate' ? (
              <SegmentedControl<CellFilter>
                size="sm"
                ariaLabel="空闲筛选"
                value={cellFilter}
                onChange={handleFilterChange}
                disabled={batchMode}
                options={[
                  { value: 'all', label: '全部' },
                  { value: 'full_free', label: '全空闲' },
                  { value: 'partial', label: '部分空闲' },
                ]}
              />
            ) : null}
          </div>
          {view === 'personal' ? (
            <div className="flex items-center gap-1.5">
              <span className="text-2xs text-subtle">成员</span>
              <div className="w-36">
                <Select
                  aria-label="选择成员"
                  value={effectiveUserId === null ? '' : String(effectiveUserId)}
                  onChange={(event) => setUserId(Number(event.target.value) || null)}
                  disabled={activeUsers.length === 0}
                >
                  {activeUsers.length === 0 ? <option value="">暂无成员</option> : null}
                  {activeUsers.map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.name}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
          ) : null}
        </div>
      </header>

      {statusMessage ? (
        <Alert
          tone="success"
          action={
            <Button variant="ghost" size="sm" onClick={() => setStatusMessage(null)}>
              关闭
            </Button>
          }
        >
          {statusMessage}
        </Alert>
      ) : null}

      {corePending ? (
        <Card className="overflow-hidden">
          <div className="border-b border-line px-4 py-3">
            <Skeleton className="h-4 w-40" />
          </div>
          <div className="scrollbar-thin overflow-x-auto px-3 py-3 sm:px-4">
            <ScheduleSkeleton />
          </div>
        </Card>
      ) : usersQuery.isError ? (
        <Alert
          tone="danger"
          title="成员列表加载失败"
          action={
            <Button variant="secondary" size="sm" onClick={() => void usersQuery.refetch()}>
              重试
            </Button>
          }
        >
          {getErrorMessage(usersQuery.error)}
        </Alert>
      ) : usersEmpty ? (
        <EmptyState
          icon={<Users className="h-5 w-5" aria-hidden />}
          title="还没有成员"
          description="先在「用户」页添加成员并设置颜色，之后即可登记占用、查看聚合空闲。"
          action={
            <Button variant="primary" iconLeft={<Plus className="h-4 w-4" aria-hidden />} onClick={() => navigate('/users')}>
              去添加成员
            </Button>
          }
        />
      ) : semesterMissing ? (
        <EmptyState
          icon={<Settings className="h-5 w-5" aria-hidden />}
          title="尚未配置学期"
          description="需要在「设置」中创建学期、设置第 1 周与总周数，并选择一个时间段模板。"
          action={
            <Button variant="primary" onClick={() => navigate('/settings')}>
              前往设置
            </Button>
          }
        />
      ) : semesterQuery.isError ? (
        <Alert
          tone="danger"
          title="学期信息加载失败"
          action={
            <Button variant="secondary" size="sm" onClick={() => void semesterQuery.refetch()}>
              重试
            </Button>
          }
        >
          {getErrorMessage(semesterQuery.error)}
        </Alert>
      ) : aggregateError ? (
        <Alert
          tone="danger"
          title="看板数据加载失败"
          action={
            <Button variant="secondary" size="sm" onClick={() => void aggregateQuery.refetch()}>
              重试
            </Button>
          }
        >
          {getErrorMessage(aggregateQuery.error)}
        </Alert>
      ) : view === 'aggregate' ? (
        <Card className="overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2.5">
            <div className="text-xs text-muted">
              {batchMode ? '批选模式：点击或按住拖动选择格子，底部操作条统一保存。' : '点击格子查看空闲/占用成员与备注。'}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-2xs text-subtle lg:hidden">左右滑动查看完整表格</span>
              <span className="tabular text-2xs text-subtle">
                {board ? board.slots.length + ' 个时间段 · ' + board.users.length + ' 位成员' : ''}
                {board && cellFilter !== 'all' ? ' · 命中 ' + matchedCount + ' 格' : ''}
              </span>
            </div>
          </div>
          {board && board.slots.length === 0 ? (
            <div className="p-4">
              <EmptyState
                icon={<CalendarClock className="h-5 w-5" aria-hidden />}
                title="当前模板还没有时间段"
                description="到「时间段」页为当前模板添加节次后，聚合表格会自动出现。"
                action={
                  <Button variant="primary" onClick={() => navigate('/slots')}>
                    去配置时间段
                  </Button>
                }
              />
            </div>
          ) : board && visibleKeys !== null && matchedCount === 0 ? (
            <div className="p-4">
              <EmptyState
                compact
                icon={<Filter className="h-5 w-5" aria-hidden />}
                title="当前筛选下没有符合条件的格子"
                description={
                  cellFilter === 'full_free'
                    ? '这一周没有全员空闲的时段，试试「全部」或「部分空闲」。'
                    : '这一周没有「有占用也有空闲」的时段，试试「全部」或「全空闲」。'
                }
                action={
                  <Button variant="secondary" onClick={() => handleFilterChange('all')}>
                    查看全部格子
                  </Button>
                }
              />
            </div>
          ) : board ? (
            <>
              <div className="scrollbar-thin overflow-x-auto px-3 py-3 sm:px-4">
                <AggregateGrid
                  week={board.week}
                  slots={board.slots}
                  cells={board.cells}
                  totalUsers={board.users.length}
                  batchMode={batchMode}
                  selected={selected}
                  visibleKeys={visibleKeys}
                  onOpenCell={handleCellActivate}
                  onCellPointerDown={handleCellPointerDown}
                  onCellPointerEnter={handleCellPointerEnter}
                  onCellKeyboardToggle={handleCellKeyboardToggle}
                />
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-4 py-2">
                <GridLegend />
                <span className="text-2xs text-subtle">窄屏可左右滑动表格，首列固定</span>
              </div>
            </>
          ) : (
            <div className="p-4">
              <ScheduleSkeleton />
            </div>
          )}
        </Card>
      ) : personalQuery.isPending ? (
        <Card className="overflow-hidden">
          <div className="border-b border-line px-4 py-3">
            <Skeleton className="h-4 w-40" />
          </div>
          <div className="scrollbar-thin overflow-x-auto px-3 py-3 sm:px-4">
            <ScheduleSkeleton />
          </div>
        </Card>
      ) : personalQuery.isError ? (
        <Alert
          tone="danger"
          title="个人安排加载失败"
          action={
            <Button variant="secondary" size="sm" onClick={() => void personalQuery.refetch()}>
              重试
            </Button>
          }
        >
          {getErrorMessage(personalQuery.error)}
        </Alert>
      ) : personalQuery.data ? (
        <Card className="overflow-hidden">
          <PersonalBoard
            board={personalQuery.data}
            onBack={() => handleViewChange('aggregate')}
            onEdit={(scheduleId) => setFormDialog({ mode: 'edit', scheduleId })}
            onCreate={(weekday, slotId) =>
              setFormDialog({
                mode: 'create',
                weekday,
                slotId,
                userId: personalQuery.data.user.id,
                startWeek: weekNo ?? currentWeek,
              })
            }
          />
        </Card>
      ) : null}

      {drawerData ? (
        <CellDrawer
          week={drawerData.week}
          weekday={drawerData.weekday}
          slot={drawerData.slot}
          freeUsers={drawerData.freeUsers}
          occupiedUsers={drawerData.occupiedUsers}
          schedules={schedulesQuery.data}
          schedulesLoading={schedulesQuery.isPending}
          onClose={() => setDrawerCell(null)}
          onPickUser={handleDrawerPickUser}
          onAddSchedule={handleDrawerAddSchedule}
        />
      ) : null}

      {formDialog ? (
        <ScheduleFormDialog
          mode={formDialog.mode}
          scheduleId={formDialog.mode === 'edit' ? formDialog.scheduleId : undefined}
          defaultWeekday={formDialog.mode === 'create' ? formDialog.weekday : undefined}
          defaultSlotId={formDialog.mode === 'create' ? formDialog.slotId : undefined}
          defaultUserId={formDialog.mode === 'create' ? formDialog.userId : undefined}
          defaultStartWeek={formDialog.mode === 'create' ? formDialog.startWeek : undefined}
          users={activeUsers}
          slots={board?.slots ?? []}
          weeks={semesterWeeks}
          totalWeeks={formTotalWeeks}
          onClose={() => setFormDialog(null)}
          onSaved={handleDialogSaved}
        />
      ) : null}

      {batchMode && view === 'aggregate' ? (
        <BatchSelectBar
          cells={selectedCells}
          selectedCount={selectedCount}
          users={activeUsers}
          weeks={semesterWeeks}
          currentWeekNo={weekNo ?? currentWeek}
          defaultUserId={effectiveUserId ?? undefined}
          onExit={exitBatchMode}
          onClear={() => setSelected(new Set<string>())}
          onSaved={handleBatchSaved}
        />
      ) : null}
    </div>
  );
}
