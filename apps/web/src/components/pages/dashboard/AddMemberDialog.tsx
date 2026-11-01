import { UserPlus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useOrgMutations } from '../../../hooks/useOrg';
import { getErrorMessage } from '../../../lib/errors';
import { Alert } from '../../ui/Alert';
import { Button } from '../../ui/Button';
import { Dialog } from '../../ui/Dialog';
import { Field, Input } from '../../ui/Input';

export interface AddMemberDialogProps {
  open: boolean;
  /** 组织内已审批成员数，仅用于展示 */
  memberCount: number;
  onClose: () => void;
}

/**
 * 组织负责人直接添加成员：输入邮箱（姓名可选）即建档，无需对方申请。
 * 新成员的「我的表」默认沿用组织模板，因此会立刻出现在组织表里。
 */
export function AddMemberDialog({ open, memberCount, onClose }: AddMemberDialogProps) {
  const { addMemberMutation } = useOrgMutations();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setStatus(null);
    setError(null);
  }, [open]);

  function submit() {
    const value = email.trim();
    if (value === '') {
      setError('请输入成员邮箱');
      return;
    }
    if (!value.includes('@')) {
      setError('邮箱格式不正确');
      return;
    }
    setError(null);
    addMemberMutation.mutate(
      { email: value, name: name.trim() === '' ? undefined : name.trim() },
      {
        onSuccess: () => {
          setStatus('已添加 ' + value + '：个人表默认沿用组织模板，可直接在组织表里安排时间。');
          setEmail('');
          setName('');
        },
        onError: (mutationError) => setError(getErrorMessage(mutationError)),
      },
    );
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="md"
      title="添加成员"
      description={'成员无需提交申请，添加后自动建档并纳入组织表。当前已加入 ' + memberCount + ' 人。'}
      footer={
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            关闭
          </Button>
          <Button
            variant="primary"
            iconLeft={<UserPlus className="h-4 w-4" aria-hidden />}
            loading={addMemberMutation.isPending}
            onClick={submit}
          >
            添加成员
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        {status ? <Alert tone="success">{status}</Alert> : null}
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <Field label="成员邮箱" htmlFor="add-member-email" required hint="用于登录 FreeShift 的邮箱">
          <Input
            id="add-member-email"
            type="email"
            inputMode="email"
            autoComplete="off"
            placeholder="name@example.com"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') submit();
            }}
          />
        </Field>
        <Field label="显示名称" htmlFor="add-member-name" hint="可留空，默认取邮箱前缀；重名会自动加后缀">
          <Input
            id="add-member-name"
            value={name}
            maxLength={40}
            placeholder="例如：张三"
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') submit();
            }}
          />
        </Field>
      </div>
    </Dialog>
  );
}
