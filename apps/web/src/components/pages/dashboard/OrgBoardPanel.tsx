import { RefreshCw, Settings2, UserPlus, Users } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { AppUser, TimeSlot, WeekInfo, Weekday } from '@freeshift/shared';
import { useAggregateBoardWithin } from '../../../hooks/useAggregateBoard';
import { useWeekSchedules } from '../../../hooks/useBoard';
import { useSyncedMembers } from '../../../hooks/useSyncedMembers';
import { AggregateGrid } from '../../schedule/AggregateGrid';
import { CellDrawer } from '../../schedule/CellDrawer';
import { ScheduleSkeleton } from '../../schedule/ScheduleSkeleton';
import { Alert } from '../../ui/Alert';
import { Badge } from '../../ui/Badge';
import { Button } from '../../ui/Button';
import { Card } from '../../ui/Card';
import { EmptyState } from '../../ui/EmptyState';
import { Skeleton } from '../../ui/Skeleton';
import { AddMemberDialog } from './AddMemberDialog';
import { SyncMembersDialog } from './SyncMembersDialog';

export interface OrgBoardPanelProps {
  /** 当前展示的周（真实时间对应的当前周） */
  week: WeekInfo;
  /** 组织模板名，用于说明组织表的时间类型 */
  templateName: string | null;
  /** 组织管理者（创建者/组织管理员）才能配置成员 */
  canManage: boolean;
  /** 点成员：打开该成员的个人表 */
  onOpenMember: (user: AppUser) => void;
}

/**
 * 组织表：按组织模板自动汇总全部成员的空闲/占用。
 * 只读展示，配置入口在右上角（同步成员 / 添加成员 / 用户页）。
 */
export function OrgBoardPanel({ week, templateName, canManage, onOpenMember }: OrgBoardPanelProps) {
  const { syncedIds, userIds, setSyncedIds } = useSyncedMembers();
  const boardQuery = useAggregateBoardWithin(week.weekNo, userIds);
  const schedulesQuery = useWeekSchedules(week.weekNo);
  const [cell, setCell] = useState<{ weekday: Weekday; slot: TimeSlot } | null>(null);
  const [syncOpen, setSyncOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);

  const board = boardQuery.data;
  const users = board?.users ?? [];
  const usersById = useMemo(() => new Map(users.map((user) => [user.id, user])), [users]);
  const currentCell = cell ? board?.cells.find((item) => item.weekday === cell.weekday && item.slotId === cell.slot.id) : undefined;
  const freeUsers = (currentCell?.freeUserIds ?? []).map((id) => usersById.get(id)).filter((user): user is AppUser => user !== undefined);
  const occupiedUsers = (currentCell?.occupiedUserIds ?? [])
    .map((id) => usersById.get(id))
    .filter((user): user is AppUser => user !== undefined);

  const filteredCount = syncedIds === null ? users.length : userIds?.length ?? users.length;

  return (
    <div className="flex flex-col gap-3">
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="truncate text-sm font-medium text-ink">成员空闲总览</span>
            <Badge tone="brand">成员 {users.length} 人</Badge>
            {templateName ? <Badge tone="outline">组织模板：{templateName}</Badge> : null}
            {syncedIds !== null ? <Badge tone="amber">已筛选 {filteredCount} 人</Badge> : null}
            <span className="tabular text-2xs text-subtle">第 {board?.week.weekNo ?? week.weekNo} 周</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              aria-label="刷新组织表"
              onClick={() => void boardQuery.refetch()}
              disabled={boardQuery.isFetching}
            >
              <RefreshCw className={boardQuery.isFetching ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} aria-hidden />
            </Button>
            <Button variant="secondary" size="sm" iconLeft={<Users className="h-3.5 w-3.5" aria-hidden />} onClick={() => setSyncOpen(true)}>
              同步成员
            </Button>
            {canManage ? (
              <Button variant="primary" size="sm" iconLeft={<UserPlus className="h-3.5 w-3.5" aria-hidden />} onClick={() => setAddOpen(true)}>
                添加成员
              </Button>
            ) : null}
          </div>
        </div>

        {boardQuery.isPending ? (
          <div className="px-3 py-3 sm:px-4">
            <ScheduleSkeleton />
          </div>
        ) : boardQuery.isError ? (
          <div className="p-4">
            <Alert
              tone="danger"
              title="组织表加载失败"
              action={
                <Button variant="secondary" size="sm" onClick={() => void boardQuery.refetch()}>
                  重试
                </Button>
              }
            >
              组织表只对组织负责人开放，请确认你是当前组织的管理员。
            </Alert>
          </div>
        ) : !board || board.slots.length === 0 ? (
          <div className="p-4">
            <EmptyState
              compact
              icon={<Settings2 className="h-5 w-5" aria-hidden />}
              title="组织表还没有时间段"
              description="组织的时间类型在创建组织时确定；如需调整，请到「设置」启用同类型的组织模板。"
            />
          </div>
        ) : (
          <div className="overflow-x-auto px-3 py-3 sm:px-4">
            <AggregateGrid
              week={board.week}
              slots={board.slots}
              cells={board.cells}
              totalUsers={board.users.length}
              batchMode={false}
              selected={new Set<string>()}
              visibleKeys={null}
              onOpenCell={(weekday, slot) => setCell({ weekday, slot })}
              onCellPointerDown={() => undefined}
              onCellPointerEnter={() => undefined}
              onCellKeyboardToggle={() => undefined}
            />
            <p className="mt-2 text-2xs text-subtle">
              格子显示当月该时段的空闲人数；点击格子可查看谁有空、谁已被占用，点成员名字可看他的个人表。
            </p>
          </div>
        )}
      </Card>

      {cell && board && currentCell ? (
        <CellDrawer
          week={board.week}
          weekday={cell.weekday}
          slot={cell.slot}
          freeUsers={freeUsers}
          occupiedUsers={occupiedUsers}
          schedules={schedulesQuery.data}
          schedulesLoading={schedulesQuery.isPending}
          onClose={() => setCell(null)}
          onPickUser={(user) => {
            setCell(null);
            onOpenMember(user);
          }}
          onAddSchedule={() => undefined}
          hideAddSchedule
        />
      ) : null}

      <SyncMembersDialog
        open={syncOpen}
        users={users}
        initialIds={syncedIds}
        onClose={() => setSyncOpen(false)}
        onConfirm={(ids) => {
          setSyncedIds(ids);
          setSyncOpen(false);
        }}
      />

      {canManage ? (
        <AddMemberDialog open={addOpen} memberCount={users.length} onClose={() => setAddOpen(false)} />
      ) : null}
    </div>
  );
}
