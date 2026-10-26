import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check } from 'lucide-react';
import { useId, useState } from 'react';
import type { AppUser, UserInput } from '@freeshift/shared';
import { DEFAULT_USER_COLORS } from '@freeshift/shared';
import { createUser, updateUser, userKeys } from '../../../api/users';
import { cn } from '../../../lib/cn';
import { userInitial, userSoftBackground } from '../../../lib/colors';
import { getErrorMessage, getFieldErrors } from '../../../lib/errors';
import { Alert } from '../../ui/Alert';
import { Button } from '../../ui/Button';
import { Dialog } from '../../ui/Dialog';
import { Field, Input, Textarea } from '../../ui/Input';

export interface UserFormDialogProps {
  mode: 'create' | 'edit';
  user?: AppUser;
  onClose: () => void;
  onSaved: (message: string) => void;
}

interface FormState {
  name: string;
  color: string;
  note: string;
}

/** 新增/编辑成员：姓名必填（重名 409），预设色板 + 自定义取色 */
export function UserFormDialog({ mode, user, onClose, onSaved }: UserFormDialogProps) {
  const queryClient = useQueryClient();
  const formId = useId();
  const [form, setForm] = useState<FormState>(() => ({
    name: user?.name ?? '',
    color: user?.color ?? DEFAULT_USER_COLORS[0],
    note: user?.note ?? '',
  }));
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const mutation = useMutation({
    mutationFn: (input: UserInput) => (mode === 'edit' && user ? updateUser(user.id, input) : createUser(input)),
    onSuccess: async (saved) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: userKeys.all }),
        queryClient.invalidateQueries({ queryKey: ['board'] }),
      ]);
      onSaved(mode === 'edit' ? '已保存成员「' + saved.name + '」' : '已添加成员「' + saved.name + '」');
    },
    onError: (error) => setFieldErrors(getFieldErrors(error)),
  });

  function patchForm(patch: Partial<FormState>) {
    setForm((prev) => ({ ...prev, ...patch }));
    setFieldErrors({});
    mutation.reset();
  }

  function handleSubmit() {
    const name = form.name.trim();
    if (!name) {
      setFieldErrors({ name: '请输入成员姓名' });
      return;
    }
    if (name.length > 50) {
      setFieldErrors({ name: '姓名不能超过 50 个字符' });
      return;
    }
    mutation.mutate({ name, color: form.color, note: form.note.trim() });
  }

  const errorMessage = mutation.isError ? getErrorMessage(mutation.error) : null;
  const isDuplicate = mutation.isError && errorMessage?.includes('已存在');

  return (
    <Dialog
      open
      onClose={onClose}
      size="sm"
      title={mode === 'edit' ? '编辑成员' : '添加成员'}
      description={mode === 'edit' ? '修改姓名、颜色或备注，改动会同步到看板。' : '成员用于登记占用与聚合空闲，颜色决定看板上的标识。'}
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={mutation.isPending}>
            取消
          </Button>
          <Button variant="primary" loading={mutation.isPending} onClick={handleSubmit}>
            {mode === 'edit' ? '保存修改' : '添加成员'}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {errorMessage ? (
          <Alert tone="danger" title={isDuplicate ? '姓名重复' : '保存失败'}>
            {errorMessage}
          </Alert>
        ) : null}

        <div className="flex items-center gap-3 rounded-control border border-line bg-canvas px-3 py-2.5">
          <span
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold"
            style={{ backgroundColor: userSoftBackground(form.color), color: form.color }}
            aria-hidden
          >
            {userInitial(form.name)}
          </span>
          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-ink">{form.name.trim() || '新成员'}</div>
            <div className="text-2xs text-subtle">
              {mode === 'edit' ? (user?.isActive ? '当前启用中' : '当前已停用') : '颜色用于看板标识'}
            </div>
          </div>
        </div>

        <Field label="姓名" required htmlFor={formId + '-name'} error={fieldErrors.name} hint="与其他成员重名会保存失败">
          <Input
            id={formId + '-name'}
            value={form.name}
            maxLength={50}
            placeholder="如：小林"
            autoFocus
            onChange={(event) => patchForm({ name: event.target.value })}
            disabled={mutation.isPending}
          />
        </Field>

        <Field label="颜色" hint="点击预设色，或用右侧取色器自定义">
          <div className="flex flex-wrap items-center gap-1.5">
            {DEFAULT_USER_COLORS.map((color) => {
              const selected = form.color.toLowerCase() === color.toLowerCase();
              return (
                <button
                  key={color}
                  type="button"
                  aria-label={'使用颜色 ' + color}
                  aria-pressed={selected}
                  onClick={() => patchForm({ color })}
                  className={cn(
                    'flex h-8 w-8 items-center justify-center rounded-full transition-transform duration-150 hover:scale-105',
                    selected ? 'ring-2 ring-brand ring-offset-2' : '',
                  )}
                  style={{ backgroundColor: color }}
                >
                  {selected ? <Check className="h-4 w-4 text-white" aria-hidden /> : null}
                </button>
              );
            })}
            <label className="ml-1 flex cursor-pointer items-center gap-1.5 rounded-control border border-line px-2 py-1 text-2xs text-muted hover:bg-canvas">
              <input
                type="color"
                aria-label="自定义颜色"
                value={form.color}
                onChange={(event) => patchForm({ color: event.target.value })}
                className="h-5 w-6 cursor-pointer border-0 bg-transparent p-0"
              />
              <span className="tabular">{form.color.toUpperCase()}</span>
            </label>
          </div>
        </Field>

        <Field label="备注" htmlFor={formId + '-note'} error={fieldErrors.note} hint="班级 / 部门 / 说明，可留空">
          <Textarea
            id={formId + '-note'}
            value={form.note}
            maxLength={200}
            placeholder="如：2024 级 1 班"
            onChange={(event) => patchForm({ note: event.target.value })}
            disabled={mutation.isPending}
          />
        </Field>
      </div>
    </Dialog>
  );
}
