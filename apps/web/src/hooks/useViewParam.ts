import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';

export type DashboardView = 'aggregate' | 'personal';

export interface ViewParam {
  view: DashboardView;
  userId: number | null;
  setView: (view: DashboardView) => void;
  setUserId: (userId: number | null) => void;
}

/** 视图/选中用户与 URL 同步：?view=personal&user=3 */
export function useViewParam(): ViewParam {
  const [searchParams, setSearchParams] = useSearchParams();
  const view: DashboardView = searchParams.get('view') === 'personal' ? 'personal' : 'aggregate';
  const rawUserId = Number(searchParams.get('user'));
  const userId = Number.isInteger(rawUserId) && rawUserId > 0 ? rawUserId : null;

  const update = useCallback(
    (patch: Record<string, string | null>) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const [key, value] of Object.entries(patch)) {
            if (value === null) next.delete(key);
            else next.set(key, value);
          }
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const setView = useCallback(
    (nextView: DashboardView) => {
      update({ view: nextView === 'personal' ? 'personal' : null });
    },
    [update],
  );

  const setUserId = useCallback(
    (id: number | null) => {
      update({ user: id === null ? null : String(id) });
    },
    [update],
  );

  return { view, userId, setView, setUserId };
}
