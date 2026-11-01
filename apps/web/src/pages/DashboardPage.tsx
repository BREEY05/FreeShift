import { CalendarClock, Settings, UserRound } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import type { ApiError } from '../api/client';
import { useSemester } from '../hooks/useSemester';
import { useMyProfile } from '../hooks/useUsers';
import { useWeekParam } from '../hooks/useWeek';
import { OrgRequiredNotice, isNoOrgError, isPendingApprovalError } from '../components/layout/OrgRequiredNotice';
import { PersonalBoardPanel } from '../components/pages/dashboard/PersonalBoardPanel';
import { RefreshButton } from '../components/schedule/RefreshButton';
import { ScheduleSkeleton } from '../components/schedule/ScheduleSkeleton';
import { WeekSwitcher } from '../components/schedule/WeekSwitcher';
import { Alert } from '../components/ui/Alert';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { EmptyState } from '../components/ui/EmptyState';
import { Skeleton } from '../components/ui/Skeleton';
import { getErrorMessage } from '../lib/errors';

/** 总览：只看自己的个人表（周次 × 星期 × 时间段），点格子录入/编辑自己的安排 */
export default function DashboardPage() {
  const navigate = useNavigate();
  const semesterQuery = useSemester();
  const profileQuery = useMyProfile();
  const semester = semesterQuery.data?.semester;
  const weeks = semesterQuery.data?.weeks ?? [];
  const { week: weekParam, setWeek } = useWeekParam(semester?.totalWeeks);

  const currentWeek = weeks.find((item) => item.isCurrent) ?? weeks[weeks.length - 1] ?? weeks[0];
  const displayWeek =
    (weekParam !== null ? weeks.find((item) => item.weekNo === weekParam) : undefined) ?? currentWeek;

  const orgUnavailable = isNoOrgError(semesterQuery.error) || isPendingApprovalError(semesterQuery.error) || isNoOrgError(profileQuery.error) || isPendingApprovalError(profileQuery.error);
  const semesterMissing =
    semesterQuery.isError && (semesterQuery.error as ApiError).status === 404 && !orgUnavailable;
  const loading = semesterQuery.isPending || profileQuery.isPending;

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-base font-semibold tracking-tight text-ink">我的个人表</h1>
              {semester ? <Badge tone="neutral">{semester.name}</Badge> : null}
              {semester ? <Badge tone="outline">{semester.totalWeeks} 周</Badge> : null}
              {semester && !semester.isActive ? <Badge tone="amber">未启用</Badge> : null}
            </div>
            <p className="mt-0.5 text-xs text-muted">
              按「周次 × 星期 × 时间段」维护自己的安排；点击格子即可录入或编辑。想换时间类型，请到「时间段」页管理我的表。
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <RefreshButton />
            <Link to="/users">
              <Button variant="secondary" iconLeft={<UserRound className="h-4 w-4" aria-hidden />}>
                我的资料
              </Button>
            </Link>
            <Link to="/slots">
              <Button variant="primary" iconLeft={<CalendarClock className="h-4 w-4" aria-hidden />}>
                管理我的表
              </Button>
            </Link>
          </div>
        </div>

        {!semesterMissing && weeks.length > 0 ? (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <WeekSwitcher week={displayWeek} weeks={weeks} onChange={setWeek} disabled={loading} />
            {profileQuery.data?.user.templateName ? (
              <span className="text-2xs text-subtle">当前个人表：{profileQuery.data.user.templateName}</span>
            ) : null}
          </div>
        ) : null}
      </header>

      {orgUnavailable ? (
        <OrgRequiredNotice error={semesterQuery.error ?? profileQuery.error} title="个人表暂不可用" />
      ) : loading ? (
        <Card className="overflow-hidden">
          <div className="border-b border-line px-4 py-3">
            <Skeleton className="h-4 w-40" />
          </div>
          <div className="px-3 py-3 sm:px-4">
            <ScheduleSkeleton />
          </div>
        </Card>
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
      ) : profileQuery.isError || !profileQuery.data ? (
        <OrgRequiredNotice error={profileQuery.error} title="个人表加载失败" />
      ) : (
        <PersonalBoardPanel
          userId={profileQuery.data.user.id}
          week={displayWeek?.weekNo ?? null}
          editable
        />
      )}
    </div>
  );
}
