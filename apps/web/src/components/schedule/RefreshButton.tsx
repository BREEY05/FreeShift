import { RefreshCw } from 'lucide-react';
import { useIsFetching, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { cn } from '../../lib/cn';
import { Button } from '../ui/Button';
import { Tooltip } from '../ui/Tooltip';

export interface RefreshButtonProps {
  className?: string;
}

/** 刷新按钮：invalidate 学期 / 成员 / 看板 / 安排相关查询 */
export function RefreshButton({ className }: RefreshButtonProps) {
  const queryClient = useQueryClient();
  const fetching = useIsFetching();
  const [refreshing, setRefreshing] = useState(false);

  function handleRefresh() {
    if (refreshing) return;
    setRefreshing(true);
    void Promise.all([
      queryClient.invalidateQueries({ queryKey: ['semester'] }),
      queryClient.invalidateQueries({ queryKey: ['users'] }),
      queryClient.invalidateQueries({ queryKey: ['board'] }),
      queryClient.invalidateQueries({ queryKey: ['schedules'] }),
    ]).finally(() => setRefreshing(false));
  }

  return (
    <Tooltip label="刷新数据">
      <Button
        variant="secondary"
        aria-label="刷新数据"
        onClick={handleRefresh}
        className={cn('px-2.5', className)}
        disabled={refreshing}
      >
        <RefreshCw className={cn('h-4 w-4', (refreshing || fetching > 0) && 'animate-spin')} aria-hidden />
      </Button>
    </Tooltip>
  );
}
