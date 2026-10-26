import { ArrowUpRight, Clock3, Plus, Users } from 'lucide-react';
import type { AppUser, Schedule, TimeSlot, WeekInfo, Weekday } from '@freeshift/shared';
import { WEEKDAY_LABELS, addDays } from '@freeshift/shared';
import { monthDayLabel, scheduleRangeLabel } from '../../lib/format';
import { findCellSchedule } from '../../lib/schedules';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Drawer } from '../ui/Drawer';
import { Skeleton } from '../ui/Skeleton';
import { UserDot } from './UserChip';

export interface CellDrawerProps {
  week: WeekInfo;
  weekday: Weekday;
  slot: TimeSlot;
  freeUsers: AppUser[];
  occupiedUsers: AppUser[];
  schedules: Schedule[] | undefined;
  schedulesLoading: boolean;
  onClose: () => void;
  onPickUser: (user: AppUser) => void;
  onAddSchedule: () => void;
}

/** 右侧抽屉：格子详情 + 空闲/占用名单（数据来自聚合结果，不再发请求） */
export function CellDrawer({
  week,
  weekday,
  slot,
  freeUsers,
  occupiedUsers,
  schedules,
  schedulesLoading,
  onClose,
  onPickUser,
  onAddSchedule,
}: CellDrawerProps) {
  const dateIso = addDays(week.startDate, weekday - 1);
  const total = freeUsers.length + occupiedUsers.length;

  return (
    <Drawer
      open
      onClose={onClose}
      title={
        <span>
          {WEEKDAY_LABELS[weekday]} · {slot.label}
        </span>
      }
      subtitle={
        <span className="tabular">
          {monthDayLabel(dateIso)} · 第 {week.weekNo} 周 · {week.parity === 'odd' ? '单周' : '双周'}
        </span>
      }
      footer={
        <div className="flex items-center justify-between gap-2">
          <Button variant="ghost" onClick={onClose}>
            关闭
          </Button>
          <Button variant="primary" iconLeft={<Plus className="h-4 w-4" aria-hidden />} onClick={onAddSchedule}>
            添加安排
          </Button>
        </div>
      }
    >
      <div className="space-y-5">
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-control border border-line bg-surface px-3 py-2.5">
            <div className="flex items-center gap-1 text-2xs text-subtle">
              <Users className="h-3.5 w-3.5" aria-hidden />
              空闲
            </div>
            <div className="tabular mt-1 text-lg font-semibold text-mint">{freeUsers.length}</div>
            <div className="text-2xs text-subtle">共 {total} 人</div>
          </div>
          <div className="rounded-control border border-line bg-surface px-3 py-2.5">
            <div className="flex items-center gap-1 text-2xs text-subtle">
              <Clock3 className="h-3.5 w-3.5" aria-hidden />
              已占用
            </div>
            <div className="tabular mt-1 text-lg font-semibold text-ink">{occupiedUsers.length}</div>
            <div className="tabular text-2xs text-subtle">
              {slot.startTime ?? '--:--'}
              {slot.endTime ? '–' + slot.endTime : ''}
            </div>
          </div>
        </div>

        <section>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-xs font-medium text-ink">空闲成员</h3>
            <span className="tabular text-2xs text-subtle">{freeUsers.length} 人</span>
          </div>
          {freeUsers.length === 0 ? (
            <p className="rounded-control border border-dashed border-line bg-canvas px-3 py-3 text-xs text-muted">
              该时段已全员占用，可点击下方按钮添加安排或更换时间。
            </p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {freeUsers.map((user) => (
                <button
                  key={user.id}
                  type="button"
                  onClick={() => onPickUser(user)}
                  title={'查看 ' + user.name + ' 的个人视图'}
                  className="group inline-flex max-w-full items-center gap-1.5 rounded-md border border-line bg-surface px-2 py-1.5 text-xs text-ink transition-colors duration-150 hover:border-brand hover:bg-brand-soft hover:text-brand"
                >
                  <UserDot color={user.color} />
                  <span className="truncate">{user.name}</span>
                  <ArrowUpRight className="h-3 w-3 text-subtle opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />
                </button>
              ))}
            </div>
          )}
        </section>

        <section>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-xs font-medium text-ink">已占用成员</h3>
            <span className="tabular text-2xs text-subtle">{occupiedUsers.length} 人</span>
          </div>
          {schedulesLoading && occupiedUsers.length > 0 ? (
            <div className="space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : occupiedUsers.length === 0 ? (
            <p className="rounded-control border border-dashed border-line bg-canvas px-3 py-3 text-xs text-muted">
              该时段没有成员被占用。
            </p>
          ) : (
            <ul className="space-y-1.5">
              {occupiedUsers.map((user) => {
                const schedule = findCellSchedule(schedules, week, weekday, slot.id, user.id);
                return (
                  <li key={user.id} className="flex items-start gap-2 rounded-control border border-line bg-surface px-2.5 py-2">
                    <UserDot color={user.color} className="mt-1" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-xs font-medium text-ink">{user.name}</span>
                        {schedule ? (
                          <Badge tone="outline" className="shrink-0">
                            {scheduleRangeLabel(schedule.startWeek, schedule.endWeek, schedule.parity)}
                          </Badge>
                        ) : null}
                      </div>
                      <p className="mt-0.5 truncate text-2xs text-muted" title={schedule?.note || undefined}>
                        {schedule?.note || (schedulesLoading ? '备注读取中…' : '未填写备注')}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </Drawer>
  );
}
