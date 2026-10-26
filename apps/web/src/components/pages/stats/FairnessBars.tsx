import type { FairnessReport } from '@freeshift/shared';
import { useMemo } from 'react';
import { Badge } from '../../ui/Badge';

export interface FairnessBarsProps {
  report: FairnessReport;
}

/** 每人占用横向条形图（纯 div/CSS），按占用分钟降序 */
export function FairnessBars({ report }: FairnessBarsProps) {
  const rows = useMemo(
    () => report.users.slice().sort((left, right) => right.occupiedMinutes - left.occupiedMinutes),
    [report.users],
  );
  const totalMinutes = rows.reduce((sum, user) => sum + user.occupiedMinutes, 0);
  const maxMinutes = Math.max(...rows.map((user) => user.occupiedMinutes), 1);

  return (
    <div className="scrollbar-thin overflow-x-auto">
      <table className="w-full min-w-[640px] border-collapse text-xs">
        <thead>
          <tr className="bg-canvas text-left text-2xs font-medium text-muted">
            <th scope="col" className="px-4 py-2">
              成员
            </th>
            <th scope="col" className="w-[140px] px-3 py-2">
              相对占比
            </th>
            <th scope="col" className="w-[72px] px-3 py-2 text-right">
              占用格数
            </th>
            <th scope="col" className="w-[88px] px-3 py-2 text-right">
              占用分钟
            </th>
            <th scope="col" className="w-[116px] px-3 py-2 text-right">
              最大连续占用
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((user) => {
            const share = totalMinutes > 0 ? Math.round((user.occupiedMinutes / totalMinutes) * 100) : 0;
            const width = Math.max(2, Math.round((user.occupiedMinutes / maxMinutes) * 100));
            return (
              <tr key={user.userId} className="hover:bg-canvas">
                <td className="px-4 py-2.5">
                  <span className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: user.color }} aria-hidden />
                    <span className="truncate text-xs font-medium text-ink">{user.name}</span>
                  </span>
                </td>
                <td className="px-3 py-2.5">
                  <div className="flex items-center gap-2">
                    <span className="relative h-2 flex-1 overflow-hidden rounded-full bg-canvas">
                      <span
                        className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-150"
                        style={{ width: width + '%', backgroundColor: user.color }}
                      />
                    </span>
                    <span className="tabular w-8 shrink-0 text-right text-2xs text-subtle">{share}%</span>
                  </div>
                </td>
                <td className="tabular px-3 py-2.5 text-right text-ink">{user.occupiedCells}</td>
                <td className="tabular px-3 py-2.5 text-right text-ink">{user.occupiedMinutes}</td>
                <td className="px-3 py-2.5 text-right">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="tabular text-ink">{user.maxContiguousMinutes}</span>
                    {user.maxContiguousMinutes > 300 ? <Badge tone="amber">偏长</Badge> : null}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
