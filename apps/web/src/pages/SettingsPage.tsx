import { AlertTriangle, Database, Settings as SettingsIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ApiError } from '../api/client';
import { DataTransferPanel } from '../components/pages/settings/DataTransferPanel';
import { RuntimeInfoPanel } from '../components/pages/settings/RuntimeInfoPanel';
import { SemesterForm } from '../components/pages/settings/SemesterForm';
import { Alert } from '../components/ui/Alert';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { EmptyState } from '../components/ui/EmptyState';
import { Skeleton } from '../components/ui/Skeleton';
import { useSemester } from '../hooks/useSemester';
import { getErrorMessage } from '../lib/errors';

/** 设置：学期表单、CSV 导入导出、运行信息与危险区说明 */
export default function SettingsPage() {
  const semesterQuery = useSemester();
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!statusMessage) return;
    const timer = window.setTimeout(() => setStatusMessage(null), 5000);
    return () => window.clearTimeout(timer);
  }, [statusMessage]);

  const overview = semesterQuery.data;
  const semesterMissing =
    semesterQuery.isError && semesterQuery.error instanceof ApiError && semesterQuery.error.status === 404;
  const currentWeek = overview?.weeks.find((week) => week.isCurrent)?.weekNo ?? 1;

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="text-base font-semibold tracking-tight text-ink">设置</h1>
            {overview ? <span className="text-2xs text-subtle">{overview.semester.name} · {overview.semester.totalWeeks} 周</span> : null}
          </div>
          <p className="mt-0.5 text-xs text-muted">配置学期周历、导入导出 CSV，并查看服务运行信息。</p>
        </div>
        <Button
          variant="secondary"
          iconLeft={<SettingsIcon className="h-4 w-4" aria-hidden />}
          onClick={() => void semesterQuery.refetch()}
          disabled={semesterQuery.isFetching}
        >
          刷新
        </Button>
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

      {semesterQuery.isPending ? (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-2">
            <Skeleton className="h-72 w-full" />
            <Skeleton className="h-40 w-full" />
          </div>
          <Skeleton className="h-64 w-full" />
        </div>
      ) : semesterMissing ? (
        <EmptyState
          icon={<Database className="h-5 w-5" aria-hidden />}
          title="尚未初始化学期"
          description="数据库中没有生效学期，学期表单需要已有学期才能保存。请通过初始化种子数据或恢复备份创建学期后刷新本页。"
          action={
            <Button variant="secondary" onClick={() => void semesterQuery.refetch()}>
              刷新
            </Button>
          }
        />
      ) : semesterQuery.isError || !overview ? (
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
      ) : (
        <>
          <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-2">
            <SemesterForm overview={overview} onSaved={setStatusMessage} />
            <RuntimeInfoPanel />
          </div>

          <DataTransferPanel totalWeeks={overview.semester.totalWeeks} currentWeek={currentWeek} onSaved={setStatusMessage} />

          <Card className="overflow-hidden border-red-200">
            <div className="flex items-center gap-2 border-b border-red-200 bg-red-50 px-4 py-3">
              <AlertTriangle className="h-4 w-4 text-danger" aria-hidden />
              <h2 className="text-xs font-semibold text-danger">危险区</h2>
            </div>
            <div className="space-y-3 px-4 py-3">
              <Alert tone="danger" title="重置数据需要服务器操作">
                为避免误操作，界面不提供一键清空或删库。重置或恢复数据请在服务器侧执行。
              </Alert>
              <ol className="list-decimal space-y-1.5 pl-4 text-2xs leading-5 text-muted">
                <li>停止 API 服务（如 docker compose stop api，或结束对应 Node 进程）。</li>
                <li>
                  备份并删除数据库文件：默认 <code className="rounded bg-canvas px-1 py-0.5 text-ink">data/freeshift.db</code>
                  （若存在 -wal / -shm 文件一并删除）。
                </li>
                <li>重新启动服务，迁移与种子数据会自动重建；也可用备份文件覆盖恢复。</li>
              </ol>
              <p className="text-2xs leading-5 text-subtle">
                删除数据库会清空全部学期、模板、成员与安排数据，且不可撤销；建议先导出 CSV 或在服务器上备份。
              </p>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
