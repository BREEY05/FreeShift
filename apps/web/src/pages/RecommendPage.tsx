import { useQuery } from '@tanstack/react-query';
import { CalendarDays, Sparkles, Users as UsersIcon } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApiError } from '../api/client';
import { fetchUsers, userKeys } from '../api/users';
import { AlternativesPanel } from '../components/pages/recommend/AlternativesPanel';
import { CommonFreePanel } from '../components/pages/recommend/CommonFreePanel';
import { ScoredPanel } from '../components/pages/recommend/ScoredPanel';
import { UserMultiSelect } from '../components/pages/recommend/UserMultiSelect';
import { Alert } from '../components/ui/Alert';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { EmptyState } from '../components/ui/EmptyState';
import { Select } from '../components/ui/Input';
import { SegmentedControl } from '../components/ui/SegmentedControl';
import { Skeleton } from '../components/ui/Skeleton';
import { useSemester } from '../hooks/useSemester';
import { weekDateLabel, weekLabel } from '@freeshift/shared';
import { getErrorMessage } from '../lib/errors';

type RecommendTab = 'common' | 'scored' | 'alternatives';

const TAB_OPTIONS: { value: RecommendTab; label: string }[] = [
  { value: 'common', label: '共同空闲' },
  { value: 'scored', label: '加权推荐' },
  { value: 'alternatives', label: '冲突替代' },
];

/** 智能推荐：共同空闲 / 加权推荐 / 冲突替代 + 权重设置 */
export default function RecommendPage() {
  const navigate = useNavigate();
  const semesterQuery = useSemester();
  const usersQuery = useQuery({
    queryKey: userKeys.list(false),
    queryFn: () => fetchUsers(false),
    staleTime: 60_000,
  });

  const users = usersQuery.data ?? [];
  const weeks = semesterQuery.data?.weeks ?? [];
  const currentWeek = weeks.find((week) => week.isCurrent)?.weekNo ?? 1;

  const [tab, setTab] = useState<RecommendTab>('common');
  const [week, setWeek] = useState<number | null>(null);
  const [selectedIds, setSelectedIds] = useState<number[] | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!statusMessage) return;
    const timer = window.setTimeout(() => setStatusMessage(null), 5000);
    return () => window.clearTimeout(timer);
  }, [statusMessage]);

  // 默认选中全部启用成员；清空后按全部启用成员计算
  useEffect(() => {
    if (selectedIds === null && usersQuery.isSuccess) setSelectedIds(users.map((user) => user.id));
  }, [selectedIds, usersQuery.isSuccess, users]);

  useEffect(() => {
    if (week === null && semesterQuery.isSuccess) setWeek(currentWeek);
  }, [week, semesterQuery.isSuccess, currentWeek]);

  const effectiveWeek = week ?? currentWeek;
  const effectiveUserIds = useMemo(() => selectedIds ?? users.map((user) => user.id), [selectedIds, users]);
  const weekInfo = weeks.find((item) => item.weekNo === effectiveWeek);

  const semesterMissing =
    semesterQuery.isError && semesterQuery.error instanceof ApiError && semesterQuery.error.status === 404;

  if (semesterQuery.isPending || usersQuery.isPending) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-8 w-56" />
        <Card className="p-4">
          <Skeleton className="h-5 w-24" />
          <div className="mt-3 flex flex-wrap gap-2">
            {Array.from({ length: 5 }).map((_, index) => (
              <Skeleton key={index} className="h-8 w-24 rounded-full" />
            ))}
          </div>
        </Card>
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (semesterMissing) {
    return (
      <EmptyState
        icon={<CalendarDays className="h-5 w-5" aria-hidden />}
        title="尚未配置学期"
        description="推荐依赖学期周次与当前时间段模板，请先在「设置」中完成学期配置。"
        action={
          <Button variant="primary" onClick={() => navigate('/settings')}>
            前往设置
          </Button>
        }
      />
    );
  }

  if (semesterQuery.isError) {
    return (
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
    );
  }

  if (usersQuery.isError) {
    return (
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
    );
  }

  const semester = semesterQuery.data;

  if (!semester || users.length === 0) {
    return (
      <EmptyState
        icon={<UsersIcon className="h-5 w-5" aria-hidden />}
        title="还没有可推荐的成员"
        description="推荐需要至少一位启用成员与其占用数据。先到「用户」页添加成员，并在看板中登记占用。"
        action={
          <Button variant="primary" onClick={() => navigate('/users')}>
            去添加成员
          </Button>
        }
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-base font-semibold tracking-tight text-ink">智能推荐</h1>
            <Badge tone="brand">第 {effectiveWeek} 周 · {weekInfo?.parity === 'odd' ? '单周' : '双周'}</Badge>
          </div>
          <p className="mt-0.5 text-xs text-muted">
            选择参与成员与周次，查看共同空闲、按权重排序的候选时段，或为冲突格子寻找替代时段。
          </p>
        </div>
        <SegmentedControl<RecommendTab>
          ariaLabel="推荐视图"
          value={tab}
          onChange={setTab}
          options={TAB_OPTIONS}
        />
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

      <Card className="px-4 py-3">
        <div className="flex flex-col gap-3">
          <UserMultiSelect users={users} selectedIds={effectiveUserIds} onChange={setSelectedIds} />
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-2.5">
            <div className="flex items-center gap-2">
              <span className="text-2xs text-muted">周次</span>
              <div className="w-44">
                <Select
                  aria-label="选择周次"
                  value={String(effectiveWeek)}
                  onChange={(event) => setWeek(Number(event.target.value))}
                  className="h-8 text-xs"
                >
                  {weeks.map((item) => (
                    <option key={item.weekNo} value={item.weekNo}>
                      {weekLabel(item)}
                    </option>
                  ))}
                </Select>
              </div>
              {weekInfo ? <span className="text-2xs text-subtle">{weekDateLabel(weekInfo)}</span> : null}
            </div>
            <Button variant="ghost" size="sm" onClick={() => setWeek(currentWeek)} disabled={effectiveWeek === currentWeek}>
              回到本周
            </Button>
          </div>
        </div>
      </Card>

      {tab === 'common' ? (
        <CommonFreePanel week={effectiveWeek} userIds={effectiveUserIds} />
      ) : tab === 'scored' ? (
        <ScoredPanel week={effectiveWeek} userIds={effectiveUserIds} onNotice={setStatusMessage} />
      ) : (
        <AlternativesPanel semester={semester} users={users} />
      )}

      <p className="flex items-center gap-1.5 px-1 text-2xs text-subtle">
        <Sparkles className="h-3.5 w-3.5" aria-hidden />
        推荐结果基于当前学期的占用数据实时计算；修改权重或登记新占用后会自动刷新。
      </p>
    </div>
  );
}
