import { HEAT_TIERS } from '../../lib/colors';

/** 空闲热度图例 */
export function GridLegend() {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-2xs text-muted">
      <span className="font-medium text-subtle">空闲热度</span>
      {HEAT_TIERS.map((tier) => (
        <span key={tier.label} className="inline-flex items-center gap-1">
          <span
            className="inline-block h-3 w-3 rounded-[4px] border"
            style={{ backgroundColor: tier.background, borderColor: tier.border }}
            aria-hidden
          />
          <span className="tabular">{tier.label}</span>
        </span>
      ))}
    </div>
  );
}
