import { Check } from 'lucide-react';
import { useId, useState } from 'react';
import type { AppUser } from '@freeshift/shared';
import { DEFAULT_USER_COLORS } from '@freeshift/shared';
import { useUpdateMyProfile } from '../../../hooks/useUsers';
import { cn } from '../../../lib/cn';
import { userInitial, userSoftBackground } from '../../../lib/colors';
import { getErrorMessage, getFieldErrors } from '../../../lib/errors';
import { Alert } from '../../ui/Alert';
import { Button } from '../../ui/Button';
import { Dialog } from '../../ui/Dialog';
import { Field, Input, Textarea } from '../../ui/Input';

export interface ProfileEditorProps {
  user: AppUser;
  onClose: () => void;
  onSaved: (message: string) => void;
}

/** 普通成员编辑自己的资料：姓名 / 颜色 / 备注（PATCH /users/me） */
export function ProfileEditor({ user, onClose, onSaved }: ProfileEditorProps) {
  const formId = useId();
  const mutation = useUpdateMyProfile();
  const [form, setForm] = useState(() => ({ name: user.name, color: user.color, note: user.note }));
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  function patchForm(patch: Partial<typeof form>) {
    setForm((prev) => ({ ...prev, ...patch }));
    setFieldErrors({});
    mutation.reset();
  }

  function handleSubmit() {
    const name = form.name.trim();
    if (!name) {
      setFieldErrors({ name: '请输入你的姓名' });
      return;
    }
    if (name.length > 50) {
      setFieldErrors({ name: '姓名不能超过 50 个字符' });
      return;
    }
    mutation.mutate(
      { name, color: form.color, note: form.note.trim() },
      { onSuccess: (saved) => onSaved('已保存我的资料「' + saved.name + '」') },
    );
  }

  const errorMessage = mutation.isError ? getErrorMessage(mutation.error) : null;
  const fieldError = Object.keys(fieldErrors).length === 0 && mutation.isError ? getFieldErrors(mutation.error) : fieldErrors;

  return (
    <Dialog
      open
      onClose={onClose}
      size="sm"
      title="编辑我的资料"
      description="姓名、颜色与备注会显示在看板与成员列表中。"
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={mutation.isPending}>
            取消
          </Button>
          <Button variant="primary" loading={mutation.isPending} onClick={handleSubmit}>
            保存修改
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {errorMessage ? <Alert tone="danger" title="保存失败">{errorMessage}</Alert> : null}

        <div className="flex items-center gap-3 rounded-control border border-line bg-canvas px-3 py-2.5">
          <span
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold"
            style={{ backgroundColor: userSoftBackground(form.color), color: form.color }}
            aria-hidden
          >
            {userInitial(form.name)}
          </span>
          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-ink">{form.name.trim() || '我的昵称'}</div>
            <div className="truncate text-2xs text-subtle">{user.email || '登录邮箱'}</div>
          </div>
        </div>

        <Field label="姓名" required htmlFor={formId + '-name'} error={fieldError.name} hint="会显示在成员列表与看板中">
          <Input
            id={formId + '-name'}
            value={form.name}
            maxLength={50}
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

        <Field label="备注" htmlFor={formId + '-note'} error={fieldError.note} hint="班级 / 部门 / 说明，可留空">
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
