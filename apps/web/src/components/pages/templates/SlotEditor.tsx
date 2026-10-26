import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Clock, Copy, Plus, RotateCcw, Save, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { DayPart, SlotInput, TimeSlot } from '@freeshift/shared';
import { DAY_PART_LABELS } from '@freeshift/shared';
import { conflictScheduleCount, replaceSlots, templateKeys, type TemplateDetail } from '../../../api/templates';
import { cn } from '../../../lib/cn';
import { getErrorMessage } from '../../../lib/errors';
import { Alert } from '../../ui/Alert';
import { Badge } from '../../ui/Badge';
import { Button } from '../../ui/Button';
import { Card } from '../../ui/Card';
import { EmptyState } from '../../ui/EmptyState';
import { Input, Select } from '../../ui/Input';

export interface SlotEditorProps {
  detail: TemplateDetail;
  onClone: () => void;
  onSaved: (message: string) => void;
  onDirtyChange: (dirty: boolean) => void;
}

interface SlotDraft {
  key: string;
  label: string;
  startTime: string;
  endTime: string;
  dayPart: DayPart;
  durationMin: string;
}

let draftSeed = 0;

function nextKey(): string {
  draftSeed += 1;
  return 'slot-' + draftSeed;
}

function toDraft(slots: TimeSlot[]): SlotDraft[] {
  return slots
    .slice()
    .sort((left, right) => left.sortOrder - right.sortOrder)
    .map((slot) => ({
      key: nextKey(),
      label: slot.label,
      startTime: slot.startTime ?? '',
      endTime: slot.endTime ?? '',
      dayPart: slot.dayPart,
      durationMin: String(slot.durationMin),
    }));
}

function draftSignature(rows: SlotDraft[]): string {
  return JSON.stringify(rows.map((row) => [row.label.trim(), row.startTime, row.endTime, row.dayPart, row.durationMin.trim()]));
}

function slotsSignature(slots: TimeSlot[]): string {
  return JSON.stringify(
    slots
      .slice()
      .sort((left, right) => left.sortOrder - right.sortOrder)
      .map((slot) => [slot.label, slot.startTime ?? '', slot.endTime ?? '', slot.dayPart, String(slot.durationMin)]),
  );
}

function minutesOf(time: string): number | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function deriveDuration(startTime: string, endTime: string): number | null {
  const start = minutesOf(startTime);
  const end = minutesOf(endTime);
  if (start === null || end === null) return null;
  const diff = end - start;
  return diff >= 5 && diff <= 720 ? diff : null;
}

/** 右侧时间段编辑器：表格编辑 + 增删行 + 上下移动 + 全量保存（预设模板只读） */
export function SlotEditor({ detail, onClone, onSaved, onDirtyChange }: SlotEditorProps) {
  const queryClient = useQueryClient();
  const readOnly = detail.template.isPreset;
  const [draft, setDraft] = useState<SlotDraft[]>(() => toDraft(detail.slots));
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  const initialSignature = useMemo(() => slotsSignature(detail.slots), [detail.slots]);
  const dirty = !readOnly && draftSignature(draft) !== initialSignature;

  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);

  function patchRow(key: string, patch: Partial<SlotDraft>) {
    setDraft((prev) =>
      prev.map((row) => {
        if (row.key !== key) return row;
        const next = { ...row, ...patch };
        // 起止时间都完整时自动推算时长，可再手动覆盖
        if (patch.startTime !== undefined || patch.endTime !== undefined) {
          const derived = deriveDuration(next.startTime, next.endTime);
          if (derived !== null) next.durationMin = String(derived);
        }
        return next;
      }),
    );
    setRowErrors((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
    setFormError(null);
  }

  function addRow() {
    setDraft((prev) => [
      ...prev,
      { key: nextKey(), label: '', startTime: '', endTime: '', dayPart: 'morning', durationMin: '90' },
    ]);
  }

  function removeRow(key: string) {
    setDraft((prev) => prev.filter((row) => row.key !== key));
    setFormError(null);
  }

  function moveRow(index: number, delta: number) {
    const target = index + delta;
    if (target < 0 || target >= draft.length) return;
    const next = [...draft];
    const [item] = next.splice(index, 1);
    next.splice(target, 0, item);
    setDraft(next);
  }

  function resetDraft() {
    setDraft(toDraft(detail.slots));
    setRowErrors({});
    setFormError(null);
  }

  function validate(): SlotInput[] | null {
    const errors: Record<string, string> = {};
    const labels = new Set<string>();
    draft.forEach((row, index) => {
      const label = row.label.trim();
      if (!label) errors[row.key] = '第 ' + (index + 1) + ' 行：名称不能为空';
      else if (labels.has(label)) errors[row.key] = '第 ' + (index + 1) + ' 行：名称「' + label + '」重复';
      labels.add(label);

      const duration = Number(row.durationMin);
      if (!Number.isInteger(duration) || duration < 5 || duration > 720) {
        errors[row.key] = (errors[row.key] ? errors[row.key] + '；' : '') + '时长需为 5–720 的整数';
      }
      if ((row.startTime && !minutesOf(row.startTime)) || (row.endTime && !minutesOf(row.endTime))) {
        errors[row.key] = (errors[row.key] ? errors[row.key] + '；' : '') + '时间格式应为 HH:MM';
      }
      if (row.startTime && row.endTime) {
        const start = minutesOf(row.startTime);
        const end = minutesOf(row.endTime);
        if (start !== null && end !== null && end <= start) {
          errors[row.key] = (errors[row.key] ? errors[row.key] + '；' : '') + '结束时间需晚于开始时间';
        }
      }
    });
    setRowErrors(errors);
    if (Object.keys(errors).length > 0) {
      setFormError('有 ' + Object.keys(errors).length + ' 行需要修正，请检查标红的输入框。');
      return null;
    }
    return draft.map((row) => ({
      label: row.label.trim(),
      startTime: row.startTime ? row.startTime : null,
      endTime: row.endTime ? row.endTime : null,
      dayPart: row.dayPart,
      durationMin: Number(row.durationMin),
    }));
  }

  const saveMutation = useMutation({
    mutationFn: (slots: SlotInput[]) => replaceSlots(detail.template.id, slots),
    onSuccess: async (slots) => {
      queryClient.setQueryData<TemplateDetail>(templateKeys.detail(detail.template.id), {
        template: { ...detail.template, slotCount: slots.length },
        slots,
      });
      setDraft(toDraft(slots));
      setRowErrors({});
      setFormError(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: templateKeys.all }),
        queryClient.invalidateQueries({ queryKey: ['board'] }),
        queryClient.invalidateQueries({ queryKey: ['schedules'] }),
        queryClient.invalidateQueries({ queryKey: ['recommend'] }),
      ]);
      onSaved('已保存 ' + slots.length + ' 个时间段');
    },
    onError: (error) => {
      const count = conflictScheduleCount(error);
      setFormError(
        count !== null
          ? '该模板已被 ' + count + ' 条安排引用，无法整体替换时间段。请先清理这些安排，或克隆模板后在新模板中编辑。'
          : getErrorMessage(error),
      );
    },
  });

  function handleSave() {
    setFormError(null);
    const payload = validate();
    if (!payload) return;
    if (payload.length === 0) {
      setFormError('模板至少需要一个时间段；如需清空模板，请直接删除该模板。');
      return;
    }
    saveMutation.mutate(payload);
  }

  const totalMinutes = draft.reduce((sum, row) => {
    const duration = Number(row.durationMin);
    return sum + (Number.isFinite(duration) ? duration : 0);
  }, 0);

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-line px-4 py-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <h2 className="truncate text-sm font-semibold text-ink">{detail.template.name}</h2>
            {detail.template.isPreset ? <Badge tone="neutral">预设 · 只读</Badge> : null}
            {detail.template.isActive ? <Badge tone="brand">当前启用</Badge> : null}
            {dirty ? <Badge tone="amber">有未保存修改</Badge> : null}
          </div>
          <p className="mt-0.5 text-2xs text-muted">
            {detail.template.description || '暂无描述'} · 共 {draft.length} 个时间段，合计 {totalMinutes} 分钟
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {readOnly ? (
            <Button variant="secondary" size="sm" iconLeft={<Copy className="h-3.5 w-3.5" aria-hidden />} onClick={onClone}>
              克隆后可编辑
            </Button>
          ) : (
            <>
              {dirty ? (
                <Button variant="ghost" size="sm" iconLeft={<RotateCcw className="h-3.5 w-3.5" aria-hidden />} onClick={resetDraft} disabled={saveMutation.isPending}>
                  重置
                </Button>
              ) : null}
              <Button variant="soft" size="sm" iconLeft={<Plus className="h-3.5 w-3.5" aria-hidden />} onClick={addRow} disabled={saveMutation.isPending}>
                添加一行
              </Button>
              <Button
                variant="primary"
                size="sm"
                loading={saveMutation.isPending}
                disabled={!dirty}
                iconLeft={<Save className="h-3.5 w-3.5" aria-hidden />}
                onClick={handleSave}
              >
                保存时间段
              </Button>
            </>
          )}
        </div>
      </div>

      {formError ? (
        <div className="px-4 py-2.5">
          <Alert tone="warning">{formError}</Alert>
        </div>
      ) : null}

      {readOnly ? (
        <div className="px-4 py-2.5">
          <Alert tone="info" title="预设模板不可修改">
            预设模板用于快速开始。点击「克隆后可编辑」生成自定义模板，再自由增删时间段。
          </Alert>
        </div>
      ) : null}

      {draft.length === 0 ? (
        <div className="p-4">
          <EmptyState
            compact
            icon={<Clock className="h-4 w-4" aria-hidden />}
            title="还没有时间段"
            description="添加每天的节次，例如「第 1-2 节 08:00–09:40」。保存后看板将按这些行展示。"
            action={
              readOnly ? (
                <Button variant="secondary" size="sm" iconLeft={<Copy className="h-3.5 w-3.5" aria-hidden />} onClick={onClone}>
                  克隆后可编辑
                </Button>
              ) : (
                <Button variant="primary" size="sm" iconLeft={<Plus className="h-3.5 w-3.5" aria-hidden />} onClick={addRow}>
                  添加第一行
                </Button>
              )
            }
          />
        </div>
      ) : (
        <div className="scrollbar-thin overflow-x-auto">
          <table className="w-full min-w-[760px] border-collapse text-xs">
            <thead>
              <tr className="bg-canvas text-left text-2xs font-medium text-muted">
                <th scope="col" className="w-12 px-2 py-2">
                  #
                </th>
                <th scope="col" className="min-w-[140px] px-2 py-2">
                  名称
                </th>
                <th scope="col" className="w-[92px] px-2 py-2">
                  开始
                </th>
                <th scope="col" className="w-[92px] px-2 py-2">
                  结束
                </th>
                <th scope="col" className="w-[104px] px-2 py-2">
                  时段
                </th>
                <th scope="col" className="w-[92px] px-2 py-2">
                  时长(分)
                </th>
                <th scope="col" className="w-[112px] px-2 py-2 text-right">
                  操作
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {draft.map((row, index) => {
                const rowError = rowErrors[row.key];
                return (
                  <tr key={row.key} className={cn(rowError ? 'bg-red-50/50' : '')}>
                    <td className="px-2 py-1.5">
                      <span className="tabular text-2xs text-subtle">{index + 1}</span>
                    </td>
                    <td className="px-2 py-1.5">
                      <Input
                        aria-label={'第 ' + (index + 1) + ' 行名称'}
                        value={row.label}
                        maxLength={50}
                        placeholder="如：第 1-2 节"
                        disabled={saveMutation.isPending}
                        onChange={(event) => patchRow(row.key, { label: event.target.value })}
                        className={cn('h-8 px-2 text-xs', rowError ? 'border-danger' : '')}
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <Input
                        type="time"
                        aria-label={'第 ' + (index + 1) + ' 行开始时间'}
                        value={row.startTime}
                        disabled={saveMutation.isPending}
                        onChange={(event) => patchRow(row.key, { startTime: event.target.value })}
                        className="h-8 px-1.5 text-xs tabular"
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <Input
                        type="time"
                        aria-label={'第 ' + (index + 1) + ' 行结束时间'}
                        value={row.endTime}
                        disabled={saveMutation.isPending}
                        onChange={(event) => patchRow(row.key, { endTime: event.target.value })}
                        className="h-8 px-1.5 text-xs tabular"
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <Select
                        aria-label={'第 ' + (index + 1) + ' 行时段'}
                        value={row.dayPart}
                        disabled={saveMutation.isPending}
                        onChange={(event) => patchRow(row.key, { dayPart: event.target.value as DayPart })}
                        className="h-8 pl-2 text-xs"
                      >
                        {(Object.keys(DAY_PART_LABELS) as DayPart[]).map((part) => (
                          <option key={part} value={part}>
                            {DAY_PART_LABELS[part]}
                          </option>
                        ))}
                      </Select>
                    </td>
                    <td className="px-2 py-1.5">
                      <Input
                        type="number"
                        min={5}
                        max={720}
                        aria-label={'第 ' + (index + 1) + ' 行时长（分钟）'}
                        value={row.durationMin}
                        disabled={saveMutation.isPending}
                        onChange={(event) => patchRow(row.key, { durationMin: event.target.value })}
                        className={cn('h-8 px-2 text-xs tabular', rowError ? 'border-danger' : '')}
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <div className="flex items-center justify-end gap-0.5">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="px-1.5"
                          aria-label={'上移第 ' + (index + 1) + ' 行'}
                          disabled={index === 0 || saveMutation.isPending}
                          onClick={() => moveRow(index, -1)}
                        >
                          <ArrowUp className="h-3.5 w-3.5" aria-hidden />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="px-1.5"
                          aria-label={'下移第 ' + (index + 1) + ' 行'}
                          disabled={index === draft.length - 1 || saveMutation.isPending}
                          onClick={() => moveRow(index, 1)}
                        >
                          <ArrowDown className="h-3.5 w-3.5" aria-hidden />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="px-1.5 text-danger hover:bg-red-50"
                          aria-label={'删除第 ' + (index + 1) + ' 行'}
                          disabled={saveMutation.isPending}
                          onClick={() => removeRow(row.key)}
                        >
                          <Trash2 className="h-3.5 w-3.5" aria-hidden />
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {Object.keys(rowErrors).length > 0 ? (
        <div className="space-y-1 border-t border-line px-4 py-2">
          {Object.entries(rowErrors).map(([key, message]) => (
            <p key={key} className="text-2xs text-danger">
              {message}
            </p>
          ))}
        </div>
      ) : null}

      <div className="border-t border-line bg-canvas px-4 py-2">
        <p className="text-2xs leading-5 text-subtle">
          保存会以表格当前顺序全量替换该模板的时间段；模板一旦被安排引用（返回 409），时间段将不可再修改。
          时长可手动填写，改动起止时间会自动推算。
        </p>
      </div>
    </Card>
  );
}