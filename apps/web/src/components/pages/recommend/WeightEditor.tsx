import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RotateCcw, Save, SlidersHorizontal } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { FactorScores } from '@freeshift/shared';
import { DEFAULT_FACTOR_WEIGHTS, FACTOR_LABELS } from '@freeshift/shared';
import { fetchRecommendConfig, recommendKeys, saveRecommendConfig } from '../../../api/recommend';
import { cn } from '../../../lib/cn';
import { getErrorMessage } from '../../../lib/errors';
import { Alert } from '../../ui/Alert';
import { Button } from '../../ui/Button';
import { Card } from '../../ui/Card';
import { Input } from '../../ui/Input';
import { Skeleton } from '../../ui/Skeleton';

const FACTOR_ORDER: (keyof FactorScores)[] = ['freeRatio', 'continuity', 'history', 'friendliness', 'recentLoad'];

function toPercent(weights: FactorScores): FactorScores {
  const sum = FACTOR_ORDER.reduce((total, key) => total + Math.max(0, weights[key]), 0);
  if (sum <= 0) return { ...DEFAULT_FACTOR_WEIGHTS };
  const result = {} as FactorScores;
  for (const key of FACTOR_ORDER) result[key] = Math.round((Math.max(0, weights[key]) / sum) * 1000) / 10;
  return result;
}

export interface WeightEditorProps {
  onSaved: (message: string) => void;
}

/** 权重设置：5 个滑杆（自动归一化展示百分比），保存后即时重新推荐 */
export function WeightEditor({ onSaved }: WeightEditorProps) {
  const queryClient = useQueryClient();
  const configQuery = useQuery({ queryKey: recommendKeys.config(), queryFn: fetchRecommendConfig, staleTime: 60_000 });
  const [draft, setDraft] = useState<FactorScores | null>(null);
  const [historyWeeks, setHistoryWeeks] = useState(4);
  const [recentWindow, setRecentWindow] = useState(1);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  useEffect(() => {
    if (!configQuery.data || draft !== null) return;
    setDraft(toPercent(configQuery.data.weights));
    setHistoryWeeks(configQuery.data.historyWeeks);
    setRecentWindow(configQuery.data.recentWindow);
  }, [configQuery.data, draft]);

  const saveMutation = useMutation({
    mutationFn: (weights: FactorScores) =>
      saveRecommendConfig({ weights, historyWeeks, recentWindow }),
    onSuccess: (config) => {
      queryClient.setQueryData(recommendKeys.config(), config);
      setDraft(toPercent(config.weights));
      setHistoryWeeks(config.historyWeeks);
      setRecentWindow(config.recentWindow);
      void queryClient.invalidateQueries({ queryKey: ['recommend', 'scored'] });
      onSaved('权重已保存，已按新权重重新推荐');
    },
  });

  const weights = draft;
  const sum = weights ? FACTOR_ORDER.reduce((total, key) => total + Math.max(0, weights[key]), 0) : 0;
  const canSave = weights !== null && sum > 0;

  function updateWeight(key: keyof FactorScores, value: number) {
    if (!weights) return;
    const clamped = Math.min(100, Math.max(0, Number.isFinite(value) ? value : 0));
    setDraft({ ...weights, [key]: clamped });
    saveMutation.reset();
  }

  function resetToDefaults() {
    setDraft(toPercent(DEFAULT_FACTOR_WEIGHTS));
    setHistoryWeeks(4);
    setRecentWindow(1);
    saveMutation.mutate(DEFAULT_FACTOR_WEIGHTS);
  }

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
        <div className="flex items-center gap-2">
          <SlidersHorizontal className="h-4 w-4 text-brand" aria-hidden />
          <h2 className="text-xs font-semibold text-ink">权重设置</h2>
          <span className="text-2xs text-subtle">保存后立即生效</span>
        </div>
        <div className="flex items-center gap-1.5">
          <Button
            variant="ghost"
            size="sm"
            iconLeft={<RotateCcw className="h-3.5 w-3.5" aria-hidden />}
            disabled={saveMutation.isPending}
            onClick={resetToDefaults}
          >
            恢复默认
          </Button>
          <Button
            variant="primary"
            size="sm"
            iconLeft={<Save className="h-3.5 w-3.5" aria-hidden />}
            loading={saveMutation.isPending}
            disabled={!canSave}
            onClick={() => {
              if (!weights) return;
              saveMutation.mutate(weights);
            }}
          >
            保存权重
          </Button>
        </div>
      </div>

      <div className="px-4 py-3">
        {saveMutation.isError ? (
          <Alert tone="danger" className="mb-3">
            {getErrorMessage(saveMutation.error)}
          </Alert>
        ) : null}

        {configQuery.isPending ? (
          <div className="space-y-2.5">
            {Array.from({ length: 5 }).map((_, index) => (
              <Skeleton key={index} className="h-6 w-full" />
            ))}
          </div>
        ) : configQuery.isError ? (
          <Alert
            tone="danger"
            title="权重配置加载失败"
            action={
              <Button variant="secondary" size="sm" onClick={() => void configQuery.refetch()}>
                重试
              </Button>
            }
          >
            {getErrorMessage(configQuery.error)}
          </Alert>
        ) : weights ? (
          <div className="space-y-3">
            <div className="grid grid-cols-1 gap-x-6 gap-y-2.5 lg:grid-cols-2">
              {FACTOR_ORDER.map((key) => {
                const percent = sum > 0 ? Math.round((weights[key] / sum) * 100) : 0;
                return (
                  <div key={key} className="flex items-center gap-2.5">
                    <span className="w-[64px] shrink-0 text-2xs text-muted">{FACTOR_LABELS[key]}</span>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      step={1}
                      aria-label={FACTOR_LABELS[key] + '权重'}
                      value={weights[key]}
                      onChange={(event) => updateWeight(key, Number(event.target.value))}
                      className="h-1.5 flex-1 cursor-pointer accent-indigo-600"
                    />
                    <span className="tabular w-10 shrink-0 text-right text-2xs text-ink">{percent}%</span>
                  </div>
                );
              })}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-2xs leading-4 text-subtle">
                数值会自动归一化为百分比；权重全为 0 时无法保存。
              </p>
              <button
                type="button"
                onClick={() => setAdvancedOpen((prev) => !prev)}
                className={cn('text-2xs font-medium text-muted underline-offset-2 hover:text-ink hover:underline')}
              >
                {advancedOpen ? '收起高级参数' : '高级参数（历史 / 近期窗口）'}
              </button>
            </div>

            {advancedOpen ? (
              <div className="flex flex-wrap items-center gap-3 rounded-control border border-line bg-canvas px-3 py-2.5">
                <label className="flex items-center gap-1.5 text-2xs text-muted">
                  历史窗口
                  <Input
                    type="number"
                    min={0}
                    max={60}
                    value={historyWeeks}
                    onChange={(event) => {
                      setHistoryWeeks(Math.min(60, Math.max(0, Number(event.target.value) || 0)));
                      saveMutation.reset();
                    }}
                    className="h-7 w-16 px-2 text-xs tabular"
                    aria-label="历史窗口（周）"
                  />
                  周
                </label>
                <label className="flex items-center gap-1.5 text-2xs text-muted">
                  近期窗口
                  <Input
                    type="number"
                    min={0}
                    max={10}
                    value={recentWindow}
                    onChange={(event) => {
                      setRecentWindow(Math.min(10, Math.max(0, Number(event.target.value) || 0)));
                      saveMutation.reset();
                    }}
                    className="h-7 w-16 px-2 text-xs tabular"
                    aria-label="近期窗口（周）"
                  />
                  周（前后各 N 周）
                </label>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </Card>
  );
}
