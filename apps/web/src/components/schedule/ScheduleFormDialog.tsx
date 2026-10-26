import { useQuery } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import { useEffect, useId, useMemo, useState } from 'react';
import type { AppUser, ConflictDetail, Parity, ScheduleInput, TimeSlot, WeekInfo, Weekday } from '@freeshift/shared';
import { PARITY_LABELS, WEEKDAY_LABELS, WEEKDAY_ORDER } from '@freeshift/shared';
import { fetchSchedule } from '../../api/schedules';
import { useScheduleActions } from '../../hooks/useScheduleActions';
import { getConflictDetails, getErrorMessage, getFieldErrors } from '../../lib/errors';
import { scheduleRangeLabel } from '../../lib/format';
import { Alert } from '../ui/Alert';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { Field, Input, Select } from '../ui/Input';
import { Skeleton } from '../ui/Skeleton';
import { ConflictBanner } from './ConflictBanner';

interface FormState {
  userId: string;
  weekday: string;
  slotId: string;
  startWeek: string;
  endWeek: string;
  parity: Parity;
  note: string;
}

export interface ScheduleFormDialogProps {
  mode: 'create' | 'edit';
  scheduleId?: number;
  defaultWeekday?: Weekday;
  defaultSlotId?: number;
  defaultUserId?: number;
  defaultStartWeek?: number;
  users: AppUser[];
  slots: TimeSlot[];
  weeks: WeekInfo[];
  totalWeeks: number;
  onClose: () => void;
  onSaved: (message: string) => void;
}

/** 新增/编辑安排对话框：区间 + 单双周，409 冲突就地展示明细 */
export function ScheduleFormDialog({
  mode,
  scheduleId,
  defaultWeekday,
  defaultSlotId,
  defaultUserId,
  defaultStartWeek,
  users,
  slots,
  weeks,
  totalWeeks,
  onClose,
  onSaved,
}: ScheduleFormDialogProps) {
  const actions = useScheduleActions();
  const formId = useId();
  const isEdit = mode === 'edit' && scheduleId !== undefined;

  const [form, setForm] = useState<FormState>(() => {
    const initialWeek = String(Math.min(Math.max(defaultStartWeek ?? 1, 1), Math.max(totalWeeks, 1)));
    return {
      userId: String(defaultUserId ?? users[0]?.id ?? ''),
      weekday: String(defaultWeekday ?? 1),
      slotId: String(defaultSlotId ?? slots[0]?.id ?? ''),
      startWeek: initialWeek,
      endWeek: initialWeek,
      parity: 'all',
      note: '',
    };
  });
  const [conflicts, setConflicts] = useState<ConflictDetail[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const detailQuery = useQuery({
    queryKey: ['schedules', 'detail', scheduleId ?? 'none'],
    queryFn: () => fetchSchedule(scheduleId as number),
    enabled: isEdit,
    staleTime: 0,
    retry: false,
  });

  const detail = detailQuery.data;
  useEffect(() => {
    if (!detail) return;
    setForm({
      userId: String(detail.userId),
      weekday: String(detail.weekday),
      slotId: String(detail.slotId),
      startWeek: String(detail.startWeek),
      endWeek: String(detail.endWeek),
      parity: detail.parity,
      note: detail.note,
    });
  }, [detail]);

  const coveredWeeks = useMemo(() => {
    const start = Number(form.startWeek);
    const end = Number(form.endWeek);
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start) return null;
    if (weeks.length === 0) return end - start + 1;
    return weeks.filter(
      (week) => week.weekNo >= start && week.weekNo <= end && (form.parity === 'all' || week.parity === form.parity),
    ).length;
  }, [weeks, form.startWeek, form.endWeek, form.parity]);

  const sortedSlots = useMemo(() => [...slots].sort((a, b) => a.sortOrder - b.sortOrder), [slots]);
  const weekNumbers = useMemo(() => Array.from({ length: Math.max(totalWeeks, 1) }, (_, index) => index + 1), [totalWeeks]);

  function patchForm(patch: Partial<FormState>) {
    setForm((prev) => ({ ...prev, ...patch }));
    setError(null);
    setConflicts([]);
  }

  function validate(): boolean {
    const next: Record<string, string> = {};
    const userId = Number(form.userId);
    const weekday = Number(form.weekday);
    const slotId = Number(form.slotId);
    const startWeek = Number(form.startWeek);
    const endWeek = Number(form.endWeek);
    if (!Number.isInteger(userId) || userId <= 0) next.userId = '请选择成员';
    if (!Number.isInteger(weekday) || weekday < 1 || weekday > 7) next.weekday = '请选择星期';
    if (!Number.isInteger(slotId) || slotId <= 0) next.slotId = '请选择时间段';
    if (!Number.isInteger(startWeek) || startWeek < 1 || startWeek > totalWeeks) next.startWeek = '起始周需在 1–' + totalWeeks;
    if (!Number.isInteger(endWeek) || endWeek < 1 || endWeek > totalWeeks) next.endWeek = '结束周需在 1–' + totalWeeks;
    if (!next.startWeek && !next.endWeek && startWeek > endWeek) next.endWeek = '结束周不能小于起始周';
    setFieldErrors(next);
    return Object.keys(next).length === 0;
  }

  async function handleSubmit() {
    setError(null);
    setConflicts([]);
    if (!validate()) return;
    const payload: ScheduleInput = {
      userId: Number(form.userId),
      weekday: Number(form.weekday) as Weekday,
      slotId: Number(form.slotId),
      startWeek: Number(form.startWeek),
      endWeek: Number(form.endWeek),
      parity: form.parity,
      note: form.note.trim(),
    };
    setSaving(true);
    try {
      if (isEdit && scheduleId !== undefined) {
        await actions.update(scheduleId, payload);
        onSaved('安排已更新');
      } else {
        await actions.create(payload);
        onSaved('安排已创建');
      }
    } catch (err) {
      const details = getConflictDetails(err);
      if (details && details.length > 0) {
        setConflicts(details);
        setError('所选时间范围已存在占用，请修改起止周/单双周，或换个时间段。');
      } else {
        setError(getErrorMessage(err));
        setFieldErrors(getFieldErrors(err));
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (scheduleId === undefined) return;
    setDeleting(true);
    setError(null);
    try {
      await actions.remove(scheduleId);
      onSaved('安排已删除');
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setDeleting(false);
    }
  }

  const previewRange =
    Number(form.startWeek) >= 1 && Number(form.endWeek) >= Number(form.startWeek)
      ? scheduleRangeLabel(Number(form.startWeek), Number(form.endWeek), form.parity)
      : '待选择周次';

  return (
    <Dialog
      open
      onClose={onClose}
      size="md"
      title={isEdit ? '编辑安排' : '新增安排'}
      description={isEdit ? '修改区间或备注，保存后会同步到对应周次。' : '登记一段占用，系统自动展开到周次并检测冲突。'}
      footer={
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            {isEdit ? (
              confirmDelete ? (
                <div className="flex items-center gap-2">
                  <span className="text-2xs text-danger">确认删除这条安排？</span>
                  <Button variant="danger" size="sm" loading={deleting} onClick={handleDelete}>
                    删除
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(false)} disabled={deleting}>
                    取消
                  </Button>
                </div>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  iconLeft={<Trash2 className="h-3.5 w-3.5" aria-hidden />}
                  className="text-danger hover:bg-red-50"
                  onClick={() => setConfirmDelete(true)}
                  disabled={saving}
                >
                  删除安排
                </Button>
              )
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={onClose} disabled={saving || deleting}>
              取消
            </Button>
            <Button variant="primary" loading={saving} disabled={deleting} onClick={handleSubmit}>
              {isEdit ? '保存修改' : '添加安排'}
            </Button>
          </div>
        </div>
      }
    >
      {isEdit && detailQuery.isPending ? (
        <div className="space-y-3">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : isEdit && detailQuery.isError ? (
        <Alert
          tone="danger"
          title="安排详情加载失败"
          action={
            <Button variant="secondary" size="sm" onClick={() => void detailQuery.refetch()}>
              重试
            </Button>
          }
        >
          {getErrorMessage(detailQuery.error)}
        </Alert>
      ) : (
        <div className="space-y-4">
          {error && conflicts.length === 0 ? <Alert tone="danger">{error}</Alert> : null}
          {conflicts.length > 0 ? (
            <div className="space-y-1.5">
              <ConflictBanner conflicts={conflicts} title={'该用户已有 ' + conflicts.length + ' 处占用冲突'} />
              <p className="text-2xs leading-4 text-muted">可修改起止周或单双周后重试；若该时段不可用，请更换时间段或切换为跳过冲突的批量保存。</p>
            </div>
          ) : null}

          <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
            <Field label="成员" required htmlFor={formId + '-user'} error={fieldErrors.userId} className="sm:col-span-2">
              <Select
                id={formId + '-user'}
                value={form.userId}
                onChange={(event) => patchForm({ userId: event.target.value })}
                disabled={saving}
              >
                <option value="">请选择成员</option>
                {users.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.name}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="星期" required htmlFor={formId + '-weekday'} error={fieldErrors.weekday}>
              <Select
                id={formId + '-weekday'}
                value={form.weekday}
                onChange={(event) => patchForm({ weekday: event.target.value })}
                disabled={saving}
              >
                {WEEKDAY_ORDER.map((weekday) => (
                  <option key={weekday} value={weekday}>
                    {WEEKDAY_LABELS[weekday]}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="时间段" required htmlFor={formId + '-slot'} error={fieldErrors.slotId}>
              <Select
                id={formId + '-slot'}
                value={form.slotId}
                onChange={(event) => patchForm({ slotId: event.target.value })}
                disabled={saving}
              >
                <option value="">请选择时间段</option>
                {sortedSlots.map((slot) => (
                  <option key={slot.id} value={slot.id}>
                    {slot.label}
                    {slot.startTime ? '（' + slot.startTime + (slot.endTime ? '–' + slot.endTime : '') + '）' : ''}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="起始周" required htmlFor={formId + '-start'} error={fieldErrors.startWeek}>
              <Select
                id={formId + '-start'}
                value={form.startWeek}
                onChange={(event) => patchForm({ startWeek: event.target.value })}
                disabled={saving}
              >
                {weekNumbers.map((weekNo) => (
                  <option key={weekNo} value={weekNo}>
                    第 {weekNo} 周
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="结束周" required htmlFor={formId + '-end'} error={fieldErrors.endWeek}>
              <Select
                id={formId + '-end'}
                value={form.endWeek}
                onChange={(event) => patchForm({ endWeek: event.target.value })}
                disabled={saving}
              >
                {weekNumbers.map((weekNo) => (
                  <option key={weekNo} value={weekNo}>
                    第 {weekNo} 周
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="单双周" htmlFor={formId + '-parity'} className="sm:col-span-2">
              <Select
                id={formId + '-parity'}
                value={form.parity}
                onChange={(event) => patchForm({ parity: event.target.value as Parity })}
                disabled={saving}
              >
                {(['all', 'odd', 'even'] as Parity[]).map((parity) => (
                  <option key={parity} value={parity}>
                    {PARITY_LABELS[parity]}
                  </option>
                ))}
              </Select>
            </Field>

            <Field
              label="备注"
              htmlFor={formId + '-note'}
              hint={coveredWeeks !== null ? previewRange + ' · 将写入 ' + coveredWeeks + ' 个周次' : previewRange}
              className="sm:col-span-2"
            >
              <Input
                id={formId + '-note'}
                value={form.note}
                maxLength={120}
                placeholder="如：高数课 / 社团活动"
                onChange={(event) => patchForm({ note: event.target.value })}
                disabled={saving}
              />
            </Field>
          </div>
        </div>
      )}
    </Dialog>
  );
}
