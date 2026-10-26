import { useQuery } from '@tanstack/react-query';
import { RefreshCw, Server } from 'lucide-react';
import { fetchMetaInfo } from '../../../api/export';
import { getErrorMessage } from '../../../lib/errors';
import { Alert } from '../../ui/Alert';
import { Button } from '../../ui/Button';
import { Card } from '../../ui/Card';
import { Skeleton } from '../../ui/Skeleton';

/** 运行信息：GET /meta 的版本 / 数据库 / 时区 */
export function RuntimeInfoPanel() {
  const query = useQuery({ queryKey: ['meta'], queryFn: fetchMetaInfo, staleTime: 300_000, retry: 1 });

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
        <div className="flex items-center gap-2">
          <Server className="h-4 w-4 text-brand" aria-hidden />
          <h2 className="text-xs font-semibold text-ink">运行信息</h2>
        </div>
        <Button
          variant="ghost"
          size="sm"
          aria-label="刷新运行信息"
          disabled={query.isFetching}
          onClick={() => void query.refetch()}
        >
          <RefreshCw className={query.isFetching ? 'h-3.5 w-3.5 animate-spin' : 'h-3.5 w-3.5'} aria-hidden />
        </Button>
      </div>

      <div className="px-4 py-3">
        {query.isPending ? (
          <div className="space-y-2">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        ) : query.isError ? (
          <Alert
            tone="danger"
            title="运行信息加载失败"
            action={
              <Button variant="secondary" size="sm" onClick={() => void query.refetch()}>
                重试
              </Button>
            }
          >
            {getErrorMessage(query.error)}
          </Alert>
        ) : (
          <dl className="grid grid-cols-1 gap-x-4 gap-y-2 text-xs sm:grid-cols-3">
            <div>
              <dt className="text-2xs text-subtle">版本</dt>
              <dd className="tabular mt-0.5 font-medium text-ink">{query.data.version}</dd>
            </div>
            <div>
              <dt className="text-2xs text-subtle">数据库</dt>
              <dd className="mt-0.5 font-medium text-ink">{query.data.db}</dd>
            </div>
            <div>
              <dt className="text-2xs text-subtle">时区</dt>
              <dd className="mt-0.5 font-medium text-ink">{query.data.timezone}</dd>
            </div>
            <div className="sm:col-span-3">
              <dt className="text-2xs text-subtle">接口前缀</dt>
              <dd className="mt-0.5 font-medium text-ink">/api/v1</dd>
            </div>
          </dl>
        )}
        <p className="mt-2 text-2xs leading-4 text-subtle">
          周次由服务端按上述时区计算；「本周」以服务器时间为准，切换周次会写入地址栏。
        </p>
      </div>
    </Card>
  );
}
