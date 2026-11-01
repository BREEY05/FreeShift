import { CalendarClock, CalendarDays, LayoutGrid, Settings, UserRound, Users } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import type { AppUser } from '@freeshift/shared';
import { todayIso } from '@freeshift/shared';
import type { ApiError } from '../api/client';
import { useSession } from '../auth/session';
import { useOrg } from '../hooks/useOrg';
import { useSemester } from '../hooks/useSemester';
import { useMyProfile } from '../hooks/useUsers';
import { useWeekParam } from '../hooks/useWeek';
import { OrgRequiredNotice, isNoOrgError, isPendingApprovalError } from '../components/layout/OrgRequiredNotice';
import { OrgBoardPanel } from '../components/pages/dashboard/OrgBoardPanel';
import { PersonalBoardPanel } from '../components/pages/dashboard/PersonalBoardPanel';
import { MemberBoardDialog } from '../components/pages/users/MemberBoardDialog';
import { RefreshButton } from '../components/schedule/RefreshButton';
import { ScheduleSkeleton } from '../components/schedule/ScheduleSkeleton';
import { WeekSwitcher } from '../components/schedule/WeekSwitcher';
import { Alert } from '../components/ui/Alert';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { EmptyState } from '../components/ui/EmptyState';
import { SegmentedControl } from '../components/ui/SegmentedControl';
import { Skeleton } from '../components/ui/Skeleton';
import { getErrorMessage } from '../lib/errors';

type BoardView = 'org' | 'mine';

/**
 * 总览：
 * - 组织负责人可用右上角分段控件在「组织表 / 个人表」之间切换；
 * - 组织表按组织模板自动汇总全部成员，个人表维护自己的安排；
 * - 默认周次永远跟随真实日期（当前周），学期外时停在最近的边界周并提示。
 */
export default function DashboardPage() {
  const navigate = useNavigate();
  const { session, isAdmin } = useSession();
  const semesterQuery = useSemester();
  const profileQuery = useMyProfile();
  const orgQuery = useOrg();
  const [searchParams, setSearchParams] = useSearchParams();
  const [selectedUser, setSelectedUser] = useState<AppUser | null>(null);

  const semester = semesterQuery.data?.semester;
  const weeks = semesterQuery.data?.weeks ?? [];
  const { week: weekParam, setWeek } = useWeekParam(semester?.totalWeeks);

  const org = orgQuery.data?.org;
  const canViewOrg = !session.enabled || isAdmin || Boolean(session.email && org && org.ownerEmail === session.email);
  const canManageOrg = !session.enabled || isAdmin || Boolean(session.email && org && org.ownerEmail === session.email);
  const rawView = searchParams.get('view');
  const view: BoardView = canViewOrg && rawView !== 'mine' ? 'org' : 'mine';

  function setView(next: BoardView) {
    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev);
        params.set('view', next);
        return params;
      },
      { replace: true },
    );
  }

  // 真实时间的当前周；学期尚未开始/已结束时退回到最近的边界周
  const today = todayIso();
  const currentWeek = weeks.find((item) => item.isCurrent);
  const boundaryWeek = weeks.find((item) => item.startDate > today) ?? weeks[weeks.length - 1];
  const defaultWeek = currentWeek ?? boundaryWeek;
  const displayWeek = (weekParam !== null ? weeks.find((item) => item.weekNo === weekParam) : undefined) ?? defaultWeek;

  const orgUnavailable =
    isNoOrgError(semesterQuery.error) ||
    isPendingApprovalError(semesterQuery.error) ||
    isNoOrgError(profileQuery.error) ||
    isPendingApprovalError(profileQuery.error);
  const semesterMissing = semesterQuery.isError && (semesterQuery.error as ApiError).status === 404 && !orgUnavailable;
  const loading = semesterQuery.isPending || profileQuery.isPending;
  const offSemester = semester !== undefined && currentWeek === undefined && weeks.length > 0;

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-base font-semibold tracking-tight text-ink">
                {view === 'org' ? '组织表' : '我的个人表'}
              </h1>
              {semester ? <Badge tone="neutral">{semester.name}</Badge> : null}
              {semester ? <Badge tone="outline">{semester.totalWeeks} 周</Badge> : null}
              {semester && !semester.isActive ? <Badge tone="amber">未启用</Badge> : null}
              {view === 'org' && org ? <Badge tone="brand">{org.name}</Badge> : null}
            </div>
            <p className="mt-0.5 text-xs text-muted">
              {view === 'org'
                ? '按组织确定的时间类型自动汇总全部成员的安排；右上角可添加成员、筛选成员，点成员可查看他的个人表。'
                : '按「周次 × 星期 × 时间段」维护自己的安排；点击格子即可录入或编辑。想换时间类型，请到「时间段」页管理我的表。'}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {canViewOrg ? (
              <SegmentedControl<BoardView>
                ariaLabel="切换组织表或个人表"
                value={view}
                onChange={setView}
                options={[
                  { value: 'org', label: '组织表' },
                  { value: 'mine', label: '个人表' },
                ]}
              />
            ) : null}
            {displayWeek && !displayWeek.isCurrent ? (
              <Button
                variant="secondary"
                size="sm"
                iconLeft={<CalendarDays className="h-3.5 w-3.5" aria-hidden />}
                onClick={() => {
                  if (defaultWeek) setWeek(defaultWeek.weekNo);
                }}
              >
                回到本周
              </Button>
            ) : null}
            <RefreshButton />
            {view === 'org' ? (
              canManageOrg ? (
                <Link to="/users">
                  <Button variant="secondary" iconLeft={<Users className="h-4 w-4" aria-hidden />}>
                    管理成员
                  </Button>
                </Link>
              ) : null
            ) : (
              <>
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
              </>
            )}
          </div>
        </div>

        {!semesterMissing && weeks.length > 0 ? (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <WeekSwitcher week={displayWeek} weeks={weeks} onChange={setWeek} disabled={loading} />
            {view === 'org' ? (
              <span className="text-2xs text-subtle">
                {org?.templateName ? '组织模板：' + org.templateName : '组织表默认使用组织模板'}
              </span>
            ) : profileQuery.data?.user.templateName ? (
              <span className="text-2xs text-subtle">当前个人表：{profileQuery.data.user.templateName}</span>
            ) : null}
          </div>
        ) : null}
      </header>

      {offSemester && displayWeek ? (
        <Alert tone="warning" title={'当前日期不在学期范围内，默认展示第 ' + displayWeek.weekNo + ' 周'}>
          {canManageOrg ? '如需按真实时间显示当前周，请到「设置」调整学期开始日期。' : '请联系组织管理员更新学期开始日期。'}
        </Alert>
      ) : null}

      {view === 'org' ? (
        loading && !displayWeek ? (
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
        ) : displayWeek ? (
          <OrgBoardPanel
            week={displayWeek}
            templateName={org?.templateName ?? null}
            canManage={canManageOrg}
            onOpenMember={setSelectedUser}
          />
        ) : (
          <EmptyState
            icon={<LayoutGrid className="h-5 w-5" aria-hidden />}
            title="周次尚未生成"
            description="学期配置完成后，组织表会按周次自动生成。"
            action={
              <Button variant="primary" onClick={() => navigate('/settings')}>
                前往设置
              </Button>
            }
          />
        )
      ) : orgUnavailable ? (
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
        <PersonalBoardPanel userId={profileQuery.data.user.id} week={displayWeek?.weekNo ?? null} editable />
      )}

      {selectedUser ? <MemberBoardDialog user={selectedUser} onClose={() => setSelectedUser(null)} /> : null}
    </div>
  );
}
