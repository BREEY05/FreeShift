import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';

export interface WeekParam {
  /** null 表示 URL 未指定周次，由服务端取当前周 */
  week: number | null;
  setWeek: (weekNo: number) => void;
}

/**
 * 周次与 URL query 双向同步：?week=3
 * 刷新页面后保持；未指定时由服务端决定当前周。
 */
export function useWeekParam(totalWeeks?: number): WeekParam {
  const [searchParams, setSearchParams] = useSearchParams();
  const raw = searchParams.get('week');
  const parsed = raw === null || raw.trim() === '' ? NaN : Number(raw);
  const inRange = Number.isInteger(parsed) && parsed >= 1 && (totalWeeks === undefined || parsed <= totalWeeks);
  const week = inRange ? parsed : null;

  const setWeek = useCallback(
    (weekNo: number) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set('week', String(weekNo));
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  return { week, setWeek };
}
