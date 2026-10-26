import { MousePointerClick, X } from 'lucide-react';
import { useState } from 'react';
import type { AppUser, BatchCellInput, ConflictDetail, Parity, WeekInfo } from '@freeshift/shared';
import { PARITY_LABELS } from '@freeshift/shared';
import { useScheduleActions } from '../../hooks/useScheduleActions';
import { getConflictDetails, getErrorMessage } from '../../lib/errors';
import { Alert } from '../ui/Alert';
import { Button } from '../ui/Button';
import { Field, Select } from '../ui/Input';
import { SegmentedControl } from '../ui/SegmentedControl';
import { ConflictBanner } from './ConflictBanner';

export interface BatchSelectBarProps {
  cells: BatchCellInput[];
  selectedCount: number;
  users: AppUser[];
  weeks: WeekInfo[];
  currentWeekNo?: number;
  defaultUserId?: number;
  onExit: () => void;
  onClear: () => void;
  onSaved: (message: string) => void;
}

/** 批选浮动操作条：选目标用户 + 周次区间 + 单双周，调用批量保存 */
export function BatchSelectBar({
  cells,
  selectedCount,
  users,
  weeks,
  currentWeekNo,
  defaultUserId,
  onExit,
  onClear,
  onSaved,
}: BatchSelectBarProps) {
  const actions = useScheduleActions();
  const fallbackWeek = weeks.find((week) => week.weekNo === currentWeekNo)?.weekNo ?? weeks[0]?.weekNo ?? 1;

  const [userId, setUserId] = useState<string>(String(defaultUserId ?? users[0]?.id ?? ''));
  const [startWeek, setStartWeek] = useState<string>(String(fallbackWeek));
  const [endWeek, setEndWeek] = useState<string>(String(fallbackWeek));
  const [parity, setParity] = useState<Parity>('all');
  const [conflicts, setConflicts] = useState<ConflictDetail[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save(mode: 'strict' | 'skip') {
    setError(null);
    const parsedUserId = Number(userId);
    const start = Number(startWeek);
    const end = Number(endWeek);
    if (!Number.isInteger(parsedUserId) || parsedUserId <= 0) {
      setError('请选择目标用户');
      return;
    }
    if (cells.length === 0) {
      setError('请先在网格中选择至少一个格子');
      return;
    }
    if (!Number.isInteger(start) || !Number.isInteger(end)) {
      setError('请选择周次区间');
      return;
    }
    if (start > end) {
      setError('起始周不能大于结束周');
      return;
    }
    setSaving(true);
    try {
      const result = await actions.batch({
        userId: parsedUserId,
        cells,
        weeks: { start, end, parity },
        mode,
      });
      const parts = ['新建 ' + result.created + ' 条安排'];
      if (result.skipped > 0) parts.push('跳过 ' + result.skipped + ' 条冲突');
      onSaved('批量保存完成：' + parts.join('，'));
    } catch (err) {
      const details = getConflictDetails(err);
      if (details && details.length > 0) {
        setConflicts(details);
        setError('存在 ' + details.length + ' 处冲突：可返回调整周次/格子，或跳过冲突后保存其余格子。');
      } else {
        setError(getErrorMessage(err));
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 px-3 pb-3 sm:px-6 sm:pb-5">
      <div className="pointer-events-auto mx-auto flex w-full max-w-4xl flex-col gap-3 rounded-card border border-line bg-surface p-3 shadow-lift sm:p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="flex items-center gap-2 text-xs text-muted">
            <MousePointerClick className="h-4 w-4 text-brand" aria-hidden />
            <span>
              已选 <strong className="tabular font-semibold text-ink">{selectedCount}</strong> 个格子
            </span>
            {selectedCount === 0 ? <span className="text-subtle">（点击或拖动格子进行选择）</span> : null}
          </div>
          <div className="flex items-center gap-1.5">
            <Button variant="ghost" size="sm" onClick={onClear} disabled={saving || selectedCount === 0}>
              清空选择
            </Button>
            <Button variant="ghost" size="sm" iconLeft={<X className="h-3.5 w-3.5" aria-hidden />} onClick={onExit} disabled={saving}>
              退出批选
            </Button>
          </div>
        </div>

        {error && conflicts.length === 0 ? <Alert tone="danger">{error}</Alert> : null}
        {conflicts.length > 0 ? (
          <div className="space-y-1.5">
            <ConflictBanner conflicts={conflicts} title={'批量保存遇到 ' + conflicts.length + ' 处冲突'} />
            <p className="text-2xs leading-4 text-muted">可返回调整周次或格子；也可跳过冲突后保存其余格子。</p>
          </div>
        ) : null}

        <div className="flex flex-wrap items-end gap-2.5">
          <Field label="目标用户" htmlFor="batch-user" className="w-[132px]">
            <Select id="batch-user" value={userId} onChange={(event) => setUserId(event.target.value)} disabled={saving}>
              <option value="">请选择</option>
              {users.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="起始周" htmlFor="batch-start" className="w-[104px]">
            <Select id="batch-start" value={startWeek} onChange={(event) => setStartWeek(event.target.value)} disabled={saving}>
              {weeks.map((week) => (
                <option key={week.weekNo} value={week.weekNo}>
                  第 {week.weekNo} 周
                </option>
              ))}
            </Select>
          </Field>
          <Field label="结束周" htmlFor="batch-end" className="w-[104px]">
            <Select id="batch-end" value={endWeek} onChange={(event) => setEndWeek(event.target.value)} disabled={saving}>
              {weeks.map((week) => (
                <option key={week.weekNo} value={week.weekNo}>
                  第 {week.weekNo} 周
                </option>
              ))}
            </Select>
          </Field>
          <Field label="单双周" className="w-[168px]">
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
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {conflicts.length > 0 ? (
              <Button variant="soft" loading={saving} onClick={() => void save('skip')}>
                跳过冲突保存
              </Button>
            ) : null}
            <Button
              variant="primary"
              loading={saving}
              disabled={selectedCount === 0}
              onClick={() => void save('strict')}
            >
              批量保存
            </Button>
          </div>
        </div>

        <p className="text-2xs leading-4 text-subtle">
          所选格子与周次区间做笛卡尔积；单双周按学期第 1 周设定展开。严格模式遇到冲突会整体失败，跳过模式只保存无冲突格子。
        </p>
      </div>
    </div>
  );
}
