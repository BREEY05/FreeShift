import { useQuery } from '@tanstack/react-query';
import { BarChart3, Info, RefreshCw, Scale, Users as UsersIcon } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApiError } from '../api/client';
import { fetchFairness, statsKeys } from '../api/stats';
import { FairnessBars } from '../components/pages/stats/FairnessBars';
import { Alert } from '../components/ui/Alert';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { EmptyState } from '../components/ui/EmptyState';
import { Select } from '../components/ui/Input';
import { Skeleton } from '../components/ui/Skeleton';
import { useSemester } from '../hooks/useSemester';
import { getErrorMessage } from '../lib/errors';

interface WeekRange {
  from: number;
  to: number;
}

/** 公平性统计：基尼系数 / 方差 / 人均占用 + 每人横向条形图 */
export default function StatsPage() {
  const navigate = useNavigate();
  const semesterQuery = useSemester();
  const totalWeeks = semesterQuery.data?.semester.totalWeeks ?? 0;
  const [range, setRange] = useState<WeekRange | null>(null);

  useEffect(() => {
    if (totalWeeks > 0 && range === null) setRange({ from: 1, to: totalWeeks });
  }, [totalWeeks, range]);

  const fairnessQuery = useQuery({
    queryKey: statsKeys.fairness(range?.from, range?.to),
    queryFn: () => fetchFairness(range?.from, range?.to),
    enabled: range !== null,
    staleTime: 30_000,
  });

  const report = fairnessQuery.data;
  const semesterMissing =
    semesterQuery.isError && semesterQuery.error instanceof ApiError && semesterQuery.error.status === 404;

  const totalMinutes = report ? report.users.reduce((sum, user) => sum + user.occupiedMinutes, 0) : 0;

  function updateFrom(from: number) {
    setRange((prev) => {
      const base = prev ?? { from: 1, to: totalWeeks };
      return { from, to: Math.max(from, base.to) };
    });
  }

  function updateTo(to: number) {
    setRange((prev) => {
      const base = prev ?? { from: 1, to: totalWeeks };
      return { from: Math.min(to, base.from), to };
    });
  }

  const weeks = Array.from({ length: Math.max(totalWeeks, 1) }, (_, index) => index + 1);

  if (semesterQuery.isPending) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-8 w-56" />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <Skeleton key={index} className="h-24 w-full" />
          ))}
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (semesterMissing) {
    return (
      <EmptyState
        icon={<BarChart3 className="h-5 w-5" aria-hidden />}
        title="尚未配置学期"
        description="公平性统计需要学期的周次范围，请先在「设置」中完成学期配置。"
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

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-base font-semibold tracking-tight text-ink">公平性统计</h1>
            {report ? <Badge tone="neutral">{report.users.length} 位成员</Badge> : null}
            {range ? <Badge tone="brand">第 {range.from}–{range.to} 周</Badge> : null}
          </div>
          <p className="mt-0.5 text-xs text-muted">
            按占用分钟衡量分配是否均衡：基尼系数越接近 0 越均衡；连续占用过长会单独提示。
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-2xs text-muted">周次区间</span>
          <div className="w-24">
            <Select aria-label="起始周" value={String(range?.from ?? 1)} onChange={(event) => updateFrom(Number(event.target.value))} className="h-8 text-xs">
              {weeks.map((week) => (
                <option key={week} value={week}>
                  第 {week} 周
                </option>
              ))}
            </Select>
          </div>
          <span className="text-2xs text-subtle">至</span>
          <div className="w-24">
            <Select aria-label="结束周" value={String(range?.to ?? totalWeeks)} onChange={(event) => updateTo(Number(event.target.value))} className="h-8 text-xs">
              {weeks.map((week) => (
                <option key={week} value={week}>
                  第 {week} 周
                </option>
              ))}
            </Select>
          </div>
          <Button
            variant="ghost"
            size="sm"
            disabled={!range || (range.from === 1 && range.to === totalWeeks)}
            onClick={() => setRange({ from: 1, to: totalWeeks })}
          >
            全学期
          </Button>
          <Button
            variant="secondary"
            size="sm"
            aria-label="刷新统计"
            iconLeft={<RefreshCw className={fairnessQuery.isFetching ? 'h-3.5 w-3.5 animate-spin' : 'h-3.5 w-3.5'} aria-hidden />}
            onClick={() => void fairnessQuery.refetch()}
            disabled={fairnessQuery.isFetching}
          >
            刷新
          </Button>
        </div>
      </header>

      {fairnessQuery.isError ? (
        <Alert
          tone="danger"
          title="统计加载失败"
          action={
            <Button variant="secondary" size="sm" onClick={() => void fairnessQuery.refetch()}>
              重试
            </Button>
          }
        >
          {getErrorMessage(fairnessQuery.error)}
        </Alert>
      ) : !report ? (
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {Array.from({ length: 3 }).map((_, index) => (
              <Skeleton key={index} className="h-24 w-full" />
            ))}
          </div>
          <Skeleton className="h-64 w-full" />
        </div>
      ) : report.users.length === 0 ? (
        <EmptyState
          icon={<UsersIcon className="h-5 w-5" aria-hidden />}
          title="没有可统计的成员"
          description="先到「用户」页添加启用成员，并在看板中登记占用后，这里会显示每人的占用分布。"
          action={
            <Button variant="primary" onClick={() => navigate('/users')}>
              去添加成员
            </Button>
          }
        />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <MetricCard
              icon={<Scale className="h-4 w-4" aria-hidden />}
              label="基尼系数"
              value={report.gini.toFixed(3)}
              hint={report.gini > 0.25 ? '大于 0.25，分配偏不均衡' : '越接近 0 越均衡'}
              tone={report.gini > 0.25 ? 'warning' : 'normal'}
            />
            <MetricCard
              icon={<BarChart3 className="h-4 w-4" aria-hidden />}
              label="方差"
              value={report.variance.toFixed(0)}
              hint="占用分钟数的离散程度（分钟²）"
            />
            <MetricCard
              icon={<Info className="h-4 w-4" aria-hidden />}
              label="人均占用"
              value={report.mean.toFixed(0) + ' 分钟'}
              hint={'约 ' + (report.mean / 60).toFixed(1) + ' 小时 / 人 · 合计 ' + totalMinutes + ' 分钟'}
            />
          </div>

          {report.hints.length > 0 ? (
            <div className="space-y-2">
              {report.hints.map((hint) => (
                <Alert key={hint} tone="warning" title="均衡提示">
                  {hint}
                </Alert>
              ))}
            </div>
          ) : report.users.length < 3 ? (
            <Alert tone="info" title="样本较少，不做均衡性判定">
              当前只有 {report.users.length} 位启用成员。基尼系数与提示规则需要至少 3 人参考，数据仅供观察。
            </Alert>
          ) : totalMinutes === 0 ? (
            <Alert tone="info" title="所选区间内没有占用记录">
              调整周次区间，或到看板为成员登记占用后再查看统计。
            </Alert>
          ) : (
            <Alert tone="success" title="未发现明显不均衡">
              基尼系数未超过 0.25，也没有成员单日连续占用超过 300 分钟。
            </Alert>
          )}

          <Card className="overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2.5">
              <h2 className="text-xs font-semibold text-ink">每人占用分布</h2>
              <span className="text-2xs text-subtle">条形长度按占用分钟数相对最大值；右侧为占总量比例</span>
            </div>
            <FairnessBars report={report} />
            <div className="border-t border-line bg-canvas px-4 py-2">
              <p className="text-2xs leading-5 text-subtle">
                「最大连续占用」按同一周、同一天的相邻时间段合并计算；超过 300 分钟会标记为偏长。
              </p>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}

interface MetricCardProps {
  icon: ReactNode;
  label: string;
  value: string;
  hint: string;
  tone?: 'normal' | 'warning';
}

function MetricCard({ icon, label, value, hint, tone = 'normal' }: MetricCardProps) {
  return (
    <Card className="px-4 py-3">
      <div className="flex items-center gap-1.5 text-2xs text-muted">
        <span className={tone === 'warning' ? 'text-amber' : 'text-brand'}>{icon}</span>
        <span>{label}</span>
      </div>
      <div className={'tabular mt-1 text-xl font-semibold tracking-tight ' + (tone === 'warning' ? 'text-amber' : 'text-ink')}>
        {value}
      </div>
      <div className="mt-0.5 text-2xs text-subtle">{hint}</div>
    </Card>
  );
}