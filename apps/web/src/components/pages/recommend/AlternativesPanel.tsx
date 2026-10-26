import { useMutation, useQuery } from '@tanstack/react-query';
import { AlertTriangle, ArrowRightLeft, Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { AlternativesInput, AppUser, Parity, SemesterOverview, Weekday } from '@freeshift/shared';
import { PARITY_LABELS, WEEKDAY_LABELS, WEEKDAY_ORDER } from '@freeshift/shared';
import { fetchAlternatives } from '../../../api/recommend';
import { fetchTemplateDetail, templateKeys } from '../../../api/templates';
import { getErrorMessage } from '../../../lib/errors';
import { Alert } from '../../ui/Alert';
import { Badge } from '../../ui/Badge';
import { Button } from '../../ui/Button';
import { Card } from '../../ui/Card';
import { EmptyState } from '../../ui/EmptyState';
import { Field, Select } from '../../ui/Input';
import { SegmentedControl } from '../../ui/SegmentedControl';
import { Skeleton } from '../../ui/Skeleton';

export interface AlternativesPanelProps {
  semester: SemesterOverview;
  users: AppUser[];
}

/** 算法 3：冲突最小化——原格冲突人数 + 排序后的替代时段 */
export function AlternativesPanel({ semester, users }: AlternativesPanelProps) {
  const totalWeeks = semester.semester.totalWeeks;
  const currentWeek = semester.weeks.find((week) => week.isCurrent)?.weekNo ?? 1;
  const activeTemplateId = semester.semester.activeTemplateId;

  const slotsQuery = useQuery({
    queryKey: templateKeys.detail(activeTemplateId ?? 0),
    queryFn: () => fetchTemplateDetail(activeTemplateId as number),
    enabled: activeTemplateId !== null,
    staleTime: 60_000,
  });
  const slots = slotsQuery.data?.slots ?? [];

  const [userId, setUserId] = useState('');
  const [weekday, setWeekday] = useState('1');
  const [slotId, setSlotId] = useState('');
  const [startWeek, setStartWeek] = useState(String(currentWeek));
  const [endWeek, setEndWeek] = useState(String(currentWeek));
  const [parity, setParity] = useState<Parity>('all');
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!userId && users.length > 0) setUserId(String(users[0].id));
  }, [users, userId]);

  useEffect(() => {
    if (!slotId && slots.length > 0) setSlotId(String(slots[0].id));
  }, [slots, slotId]);

  const mutation = useMutation({
    mutationFn: (input: AlternativesInput) => fetchAlternatives(input),
  });

  function handleSubmit() {
    setFormError(null);
    const parsedUserId = Number(userId);
    const parsedSlotId = Number(slotId);
    const parsedStart = Number(startWeek);
    const parsedEnd = Number(endWeek);
    if (!Number.isInteger(parsedUserId) || parsedUserId <= 0) {
      setFormError('请选择成员');
      return;
    }
    if (!Number.isInteger(parsedSlotId) || parsedSlotId <= 0) {
      setFormError('请选择原时段');
      return;
    }
    if (!Number.isInteger(parsedStart) || !Number.isInteger(parsedEnd) || parsedStart < 1 || parsedEnd > totalWeeks) {
      setFormError('周次需在 1–' + totalWeeks + ' 之间');
      return;
    }
    if (parsedStart > parsedEnd) {
      setFormError('起始周不能大于结束周');
      return;
    }
    mutation.mutate({
      userId: parsedUserId,
      weekday: Number(weekday) as Weekday,
      slotId: parsedSlotId,
      startWeek: parsedStart,
      endWeek: parsedEnd,
      parity,
      topK: 20,
    });
  }

  const result = mutation.data;

  return (
    <div className="flex flex-col gap-4">
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
          <div className="flex items-center gap-2">
            <ArrowRightLeft className="h-4 w-4 text-brand" aria-hidden />
            <h2 className="text-xs font-semibold text-ink">冲突最小化</h2>
            <span className="text-2xs text-subtle">为一个想调整的格子寻找冲突更少的替代时段</span>
          </div>
        </div>

        {activeTemplateId === null ? (
          <div className="p-4">
            <Alert tone="warning" title="当前学期还没有启用时间段模板">
              请先到「时间段」页启用一个模板，系统才知道有哪些格子可用于替代。
            </Alert>
          </div>
        ) : null}

        <div className="grid grid-cols-1 gap-3 px-4 py-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="成员" required>
            <Select aria-label="成员" value={userId} onChange={(event) => setUserId(event.target.value)}>
              <option value="">请选择</option>
              {users.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="星期" required>
            <Select aria-label="星期" value={weekday} onChange={(event) => setWeekday(event.target.value)}>
              {WEEKDAY_ORDER.map((value) => (
                <option key={value} value={value}>
                  {WEEKDAY_LABELS[value]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="原时段" required>
            {slotsQuery.isPending ? (
              <Skeleton className="h-9 w-full" />
            ) : slotsQuery.isError ? (
              <span className="text-2xs text-danger">时间段加载失败</span>
            ) : (
              <Select aria-label="原时段" value={slotId} onChange={(event) => setSlotId(event.target.value)}>
                <option value="">请选择</option>
                {slots.map((slot) => (
                  <option key={slot.id} value={slot.id}>
                    {slot.label}
                    {slot.startTime ? '（' + slot.startTime + (slot.endTime ? '–' + slot.endTime : '') + '）' : ''}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="单双周">
            <SegmentedControl<Parity>
              size="sm"
              ariaLabel="单双周"
              value={parity}
              onChange={setParity}
              options={[
                { value: 'all', label: PARITY_LABELS.all },
                { value: 'odd', label: PARITY_LABELS.odd },
                { value: 'even', label: PARITY_LABELS.even },
              ]}
            />
          </Field>
          <Field label="起始周" required>
            <Select aria-label="起始周" value={startWeek} onChange={(event) => setStartWeek(event.target.value)}>
              {semester.weeks.map((week) => (
                <option key={week.weekNo} value={week.weekNo}>
                  第 {week.weekNo} 周
                </option>
              ))}
            </Select>
          </Field>
          <Field label="结束周" required>
            <Select aria-label="结束周" value={endWeek} onChange={(event) => setEndWeek(event.target.value)}>
              {semester.weeks.map((week) => (
                <option key={week.weekNo} value={week.weekNo}>
                  第 {week.weekNo} 周
                </option>
              ))}
            </Select>
          </Field>
          <div className="flex items-end sm:col-span-2">
            <Button
              variant="primary"
              iconLeft={<Search className="h-4 w-4" aria-hidden />}
              loading={mutation.isPending}
              disabled={activeTemplateId === null}
              onClick={handleSubmit}
            >
              查找替代时段
            </Button>
          </div>
        </div>

        {formError ? (
          <div className="px-4 pb-3">
            <Alert tone="danger">{formError}</Alert>
          </div>
        ) : null}
        {mutation.isError ? (
          <div className="px-4 pb-3">
            <Alert tone="danger" title="替代时段计算失败">
              {getErrorMessage(mutation.error)}
            </Alert>
          </div>
        ) : null}
      </Card>

      {result ? (
        <Card className="overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber" aria-hidden />
              <h2 className="text-xs font-semibold text-ink">原时段冲突概况</h2>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge tone="neutral">
                {WEEKDAY_LABELS[result.source.weekday]} ·{' '}
                {slots.find((slot) => slot.id === result.source.slotId)?.label ?? '原时段'}
              </Badge>
              <Badge tone={result.source.occupiedUsers > 0 ? 'amber' : 'mint'}>冲突 {result.source.occupiedUsers} 人</Badge>
              <Badge tone="neutral">空闲 {result.source.freeUsers} 人</Badge>
            </div>
          </div>

          {result.source.occupiedUsers === 0 ? (
            <div className="px-4 py-3">
              <Alert tone="success" title="原时段当前无冲突">
                这段周次里该格子没有任何人占用，可以直接按原时段添加安排。
              </Alert>
            </div>
          ) : null}

          {result.cells.length === 0 ? (
            <div className="p-4">
              <EmptyState
                compact
                icon={<ArrowRightLeft className="h-4 w-4" aria-hidden />}
                title="没有可用的替代时段"
                description="该用户在这些周次的其它格子都已有占用，或当前模板只有一个时间段。可以缩小周次范围，或先清理已有安排。"
              />
            </div>
          ) : (
            <ol className="divide-y divide-line">
              {result.cells.map((cell, index) => (
                <li key={cell.weekday + '-' + cell.slotId} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span className="tabular flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-canvas text-2xs font-semibold text-muted">
                      {index + 1}
                    </span>
                    <div className="min-w-0">
                      <div className="truncate text-xs font-medium text-ink">
                        {WEEKDAY_LABELS[cell.weekday]} · {cell.slotLabel}
                      </div>
                      <div className="tabular text-2xs text-muted">综合可用度 {Math.round(cell.score * 100)}%</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Badge tone={cell.occupiedUsers > 0 ? 'amber' : 'mint'}>冲突 {cell.occupiedUsers} 人</Badge>
                    <Badge tone="neutral">空闲 {cell.freeUsers} 人</Badge>
                  </div>
                </li>
              ))}
            </ol>
          )}

          <div className="border-t border-line bg-canvas px-4 py-2">
            <p className="text-2xs leading-5 text-subtle">
              排序规则：冲突人数少优先，其次空闲人数多、可用度高。结果基于所选周次区间与单双周展开后的占用统计。
            </p>
          </div>
        </Card>
      ) : null}
    </div>
  );
}