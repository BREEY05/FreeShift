import { Skeleton } from '../ui/Skeleton';

export interface ScheduleSkeletonProps {
  rows?: number;
}

/** 聚合/个人网格加载占位，宽度与真实表格一致避免跳动 */
export function ScheduleSkeleton({ rows = 5 }: ScheduleSkeletonProps) {
  return (
    <div className="min-w-[880px]" aria-hidden>
      <div className="mb-1.5 flex">
        <Skeleton className="mr-1.5 h-9 w-[110px]" />
        <div className="grid min-w-[744px] flex-1 grid-cols-7 gap-1.5">
          {Array.from({ length: 7 }).map((_, index) => (
            <Skeleton key={index} className="h-9" />
          ))}
        </div>
      </div>
      <div className="space-y-1.5">
        {Array.from({ length: rows }).map((_, rowIndex) => (
          <div key={rowIndex} className="flex">
            <Skeleton className="mr-1.5 h-14 w-[110px]" />
            <div className="grid min-w-[744px] flex-1 grid-cols-7 gap-1.5">
              {Array.from({ length: 7 }).map((_, columnIndex) => (
                <Skeleton key={columnIndex} className="h-14" />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
