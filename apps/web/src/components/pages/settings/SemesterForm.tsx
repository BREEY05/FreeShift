import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CalendarDays, Save } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import type { SemesterInput, SemesterOverview, WeekParity } from '@freeshift/shared';
import { buildWeeks, weekParityOf } from '@freeshift/shared';
import { api } from '../../../api/client';
import { getErrorMessage, getFieldErrors } from '../../../lib/errors';
import { formatWeekSpan } from '../../../lib/format';
import { Alert } from '../../ui/Alert';
import { Button } from '../../ui/Button';
import { Card } from '../../ui/Card';
import { Field, Input } from '../../ui/Input';
import { SegmentedControl } from '../../ui/SegmentedControl';

export interface SemesterFormProps {
  overview: SemesterOverview;
  onSaved: (message: string) => void;
}

interface FormState {
  name: string;
  startDate: string;
  totalWeeks: string;
  week1Parity: WeekParity;
}

function toForm(overview: SemesterOverview): FormState {
  return {
    name: overview.semester.name,
    startDate: overview.semester.startDate,
    totalWeeks: String(overview.semester.totalWeeks),
    week1Parity: overview.semester.week1Parity,
  };
}

function signature(form: FormState): string {
  return JSON.stringify([form.name.trim(), form.startDate, form.totalWeeks.trim(), form.week1Parity]);
}

function saveSemester(input: SemesterInput): Promise<SemesterOverview> {
  return api.put<SemesterOverview>('/semester', input);
}

/** 学期设置：名称 / 开始日期 / 总周次 / 第 1 周单双周 */
export function SemesterForm({ overview, onSaved }: SemesterFormProps) {
  const queryClient = useQueryClient();
  const formId = useId();
  const [form, setForm] = useState<FormState>(() => toForm(overview));
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [baseline, setBaseline] = useState(() => signature(toForm(overview)));

  useEffect(() => {
    const next = signature(toForm(overview));
    if (next !== baseline) {
      setBaseline(next);
      setForm(toForm(overview));
    }
  }, [overview, baseline]);

  const dirty = signature(form) !== baseline;

  const mutation = useMutation({
    mutationFn: saveSemester,
    onSuccess: async (next) => {
      queryClient.setQueryData(['semester'], next);
      setBaseline(signature(toForm(next)));
      setForm(toForm(next));
      setFieldErrors({});
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['semester'] }),
        queryClient.invalidateQueries({ queryKey: ['board'] }),
        queryClient.invalidateQueries({ queryKey: ['schedules'] }),
        queryClient.invalidateQueries({ queryKey: ['stats'] }),
        queryClient.invalidateQueries({ queryKey: ['recommend'] }),
      ]);
      onSaved('学期设置已保存');
    },
    onError: (error) => setFieldErrors(getFieldErrors(error)),
  });

  function patchForm(patch: Partial<FormState>) {
    setForm((prev) => ({ ...prev, ...patch }));
    setFieldErrors({});
    mutation.reset();
  }

  function handleSubmit() {
    const errors: Record<string, string> = {};
    const name = form.name.trim();
    const totalWeeks = Number(form.totalWeeks);
    if (!name) errors.name = '请输入学期名称';
    else if (name.length > 80) errors.name = '学期名称不能超过 80 个字符';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(form.startDate)) errors.startDate = '请选择开始日期';
    if (!Number.isInteger(totalWeeks) || totalWeeks < 1 || totalWeeks > 60) errors.totalWeeks = '总周次需在 1–60 之间';
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;
    mutation.mutate({
      name,
      startDate: form.startDate,
      totalWeeks,
      week1Parity: form.week1Parity,
    });
  }

  const weeksPreview = (() => {
    const totalWeeks = Number(form.totalWeeks);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(form.startDate)) return null;
    if (!Number.isInteger(totalWeeks) || totalWeeks < 1 || totalWeeks > 60) return null;
    try {
      return buildWeeks({ startDate: form.startDate, totalWeeks, week1Parity: form.week1Parity });
    } catch {
      return null;
    }
  })();

  const currentWeek = weeksPreview?.find((week) => week.isCurrent) ?? null;
  const firstWeek = weeksPreview?.[0] ?? null;
  const lastWeek = weeksPreview && weeksPreview.length > 0 ? weeksPreview[weeksPreview.length - 1] : null;

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
        <div className="flex items-center gap-2">
          <CalendarDays className="h-4 w-4 text-brand" aria-hidden />
          <h2 className="text-xs font-semibold text-ink">学期设置</h2>
          {dirty ? <span className="text-2xs font-medium text-amber">有未保存修改</span> : null}
        </div>
        <div className="flex items-center gap-1.5">
          {dirty ? (
            <Button variant="ghost" size="sm" onClick={() => setForm(toForm(overview))} disabled={mutation.isPending}>
              还原
            </Button>
          ) : null}
          <Button
            variant="primary"
            size="sm"
            iconLeft={<Save className="h-3.5 w-3.5" aria-hidden />}
            loading={mutation.isPending}
            disabled={!dirty}
            onClick={handleSubmit}
          >
            保存学期
          </Button>
        </div>
      </div>

      <div className="space-y-3.5 px-4 py-3">
        {mutation.isError ? <Alert tone="danger" title="保存失败">{getErrorMessage(mutation.error)}</Alert> : null}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="学期名称" required htmlFor={formId + '-name'} error={fieldErrors.name} className="sm:col-span-2">
            <Input
              id={formId + '-name'}
              value={form.name}
              maxLength={80}
              placeholder="如：2026 春季学期"
              onChange={(event) => patchForm({ name: event.target.value })}
              disabled={mutation.isPending}
            />
          </Field>

          <Field label="开始日期（第 1 周周一）" required htmlFor={formId + '-start'} error={fieldErrors.startDate}>
            <Input
              id={formId + '-start'}
              type="date"
              value={form.startDate}
              onChange={(event) => patchForm({ startDate: event.target.value })}
              disabled={mutation.isPending}
            />
          </Field>

          <Field label="总周次" required htmlFor={formId + '-weeks'} error={fieldErrors.totalWeeks} hint="1–60 周">
            <Input
              id={formId + '-weeks'}
              type="number"
              min={1}
              max={60}
              value={form.totalWeeks}
              onChange={(event) => patchForm({ totalWeeks: event.target.value })}
              disabled={mutation.isPending}
              className="tabular"
            />
          </Field>

          <Field label="第 1 周" hint="决定单双周的起点">
            <SegmentedControl<WeekParity>
              ariaLabel="第 1 周单双周"
              value={form.week1Parity}
              onChange={(value) => patchForm({ week1Parity: value })}
              options={[
                { value: 'odd', label: '单周' },
                { value: 'even', label: '双周' },
              ]}
            />
          </Field>

          <div className="flex items-end pb-1.5">
            <p className="text-2xs leading-4 text-subtle">
              {firstWeek && lastWeek
                ? '第 1 周 ' + formatWeekSpan(firstWeek.startDate, firstWeek.endDate) + ' · 第 ' + lastWeek.weekNo + ' 周 ' + formatWeekSpan(lastWeek.startDate, lastWeek.endDate)
                : '填写开始日期与总周次后显示周历预览'}
              {currentWeek
                ? ' · 当前为第 ' + currentWeek.weekNo + ' 周（' + (weekParityOf(form.week1Parity, currentWeek.weekNo) === 'odd' ? '单周' : '双周') + '）'
                : ''}
            </p>
          </div>
        </div>

        <Alert tone="warning" title="修改周设置会重建安排展开数据">
          调整开始日期、总周次或第 1 周单双周后，服务端会重建该学期的全部「周次 × 星期 × 格子」展开记录；超出新周次范围的占用将不再显示。
        </Alert>

        <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 rounded-control border border-line bg-canvas px-3 py-2.5 text-2xs sm:grid-cols-4">
          <div>
            <dt className="text-subtle">当前学期</dt>
            <dd className="mt-0.5 font-medium text-ink">{overview.semester.name}</dd>
          </div>
          <div>
            <dt className="text-subtle">开始日期</dt>
            <dd className="tabular mt-0.5 font-medium text-ink">{overview.semester.startDate}</dd>
          </div>
          <div>
            <dt className="text-subtle">总周次</dt>
            <dd className="tabular mt-0.5 font-medium text-ink">{overview.semester.totalWeeks} 周</dd>
          </div>
          <div>
            <dt className="text-subtle">第 1 周</dt>
            <dd className="mt-0.5 font-medium text-ink">{overview.semester.week1Parity === 'odd' ? '单周' : '双周'}</dd>
          </div>
        </dl>
      </div>
    </Card>
  );
}