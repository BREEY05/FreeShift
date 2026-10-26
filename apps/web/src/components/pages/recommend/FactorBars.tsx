import type { FactorScores } from '@freeshift/shared';
import { FACTOR_LABELS } from '@freeshift/shared';

const FACTOR_ORDER: (keyof FactorScores)[] = ['freeRatio', 'continuity', 'history', 'friendliness', 'recentLoad'];

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

export interface FactorBarsProps {
  factors: FactorScores;
  weights?: FactorScores;
}

/** 五因子归一化条形图（纯 CSS） */
export function FactorBars({ factors, weights }: FactorBarsProps) {
  const weightSum = weights
    ? FACTOR_ORDER.reduce((sum, key) => sum + Math.max(0, weights[key] ?? 0), 0)
    : 0;

  return (
    <div className="grid grid-cols-1 gap-x-3 gap-y-1 sm:grid-cols-2 xl:grid-cols-5">
      {FACTOR_ORDER.map((key) => {
        const value = clamp01(factors[key] ?? 0);
        const weightPercent = weights && weightSum > 0 ? Math.round((Math.max(0, weights[key]) / weightSum) * 100) : null;
        return (
          <div
            key={key}
            className="flex items-center gap-1.5"
            title={FACTOR_LABELS[key] + ' ' + value.toFixed(2) + (weightPercent !== null ? ' · 权重 ' + weightPercent + '%' : '')}
          >
            <span className="w-[56px] shrink-0 text-2xs text-muted">{FACTOR_LABELS[key]}</span>
            <span className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-canvas">
              <span
                className="absolute inset-y-0 left-0 rounded-full bg-brand transition-[width] duration-150"
                style={{ width: Math.round(value * 100) + '%' }}
              />
            </span>
            <span className="tabular w-7 shrink-0 text-right text-2xs text-subtle">{value.toFixed(2)}</span>
          </div>
        );
      })}
    </div>
  );
}
