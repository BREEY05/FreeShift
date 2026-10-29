import { AlertTriangle, RotateCcw } from 'lucide-react';
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { resetData } from '../../../api/org';
import { getErrorMessage } from '../../../lib/errors';
import { Alert } from '../../ui/Alert';
import { Button } from '../../ui/Button';
import { Dialog } from '../../ui/Dialog';
import { Field, Input } from '../../ui/Input';

export interface ResetDataPanelProps {
  onDone?: (message: string) => void;
}

const CONFIRM_WORD = '重置';

/** 危险区：清空当前组织的安排与成员数据（二次确认，不可撤销） */
export function ResetDataPanel({ onDone }: ResetDataPanelProps) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [error, setError] = useState<string | null>(null);

  const resetMutation = useMutation({
    mutationFn: () => resetData(),
    onSuccess: (result) => {
      for (const key of ['board', 'schedules', 'stats', 'recommend', 'users', 'templates', 'semester', 'org']) {
        void queryClient.invalidateQueries({ queryKey: [key] });
      }
      setOpen(false);
      setConfirmText('');
      onDone?.(`已重置数据：删除 ${result.deletedSchedules} 条安排、${result.deletedUsers} 位成员`);
    },
    onError: (err) => setError(getErrorMessage(err)),
  });

  const confirmed = confirmText.trim() === CONFIRM_WORD;

  function close() {
    setOpen(false);
    setConfirmText('');
    setError(null);
  }

  return (
    <>
      <div className="space-y-3">
        <Alert tone="danger" title="重置数据不可撤销">
          重置会清空当前组织下的全部时段安排与成员数据（保留组织本身与你的登录身份）。建议先在上方导出 CSV 备份。
        </Alert>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-2xs leading-5 text-subtle">如果你不是组织负责人，请让负责人执行重置。</p>
          <Button variant="danger" iconLeft={<RotateCcw className="h-4 w-4" aria-hidden />} onClick={() => setOpen(true)}>
            重置数据
          </Button>
        </div>
      </div>

      <Dialog
        open={open}
        onClose={close}
        size="sm"
        title="确认重置数据？"
        description="此操作会立即生效且无法撤销。"
        footer={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button variant="ghost" onClick={close}>
              取消
            </Button>
            <Button
              variant="danger"
              loading={resetMutation.isPending}
              disabled={!confirmed || resetMutation.isPending}
              onClick={() => {
                setError(null);
                resetMutation.mutate();
              }}
            >
              确认重置
            </Button>
          </div>
        }
      >
        <div className="flex flex-col gap-3">
          <Alert tone="danger" title="即将删除的内容">
            当前组织的全部时段安排、成员记录与统计数据。删除后无法恢复。
          </Alert>
          <Field label={`输入「${CONFIRM_WORD}」以确认`} htmlFor="reset-confirm" required>
            <Input
              id="reset-confirm"
              value={confirmText}
              autoComplete="off"
              placeholder={CONFIRM_WORD}
              onChange={(event) => setConfirmText(event.target.value)}
            />
          </Field>
          {error ? <Alert tone="danger" title="重置失败">{error}</Alert> : null}
        </div>
      </Dialog>
    </>
  );
}
