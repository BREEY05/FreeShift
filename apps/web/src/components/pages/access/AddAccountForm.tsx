import { useEffect, useState, type FormEvent } from 'react';
import { UserPlus } from 'lucide-react';
import type { AuthRole } from '../../../auth/api';
import { Button } from '../../ui/Button';
import { Field, Input, Select } from '../../ui/Input';

export interface AddAccountFormProps {
  adminEmail: string;
  submitting: boolean;
  /** 字段级错误，由上层把 422 校验明细传入 */
  fieldErrors: Record<string, string>;
  onSubmit: (email: string, role: AuthRole) => void;
  onDismissError: () => void;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** 新增授权邮箱：邮箱输入 + 角色选择 */
export function AddAccountForm({ adminEmail, submitting, fieldErrors, onSubmit }: AddAccountFormProps) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<AuthRole>('member');
  const [localError, setLocalError] = useState('');

  // 上层校验错误变化时同步到本地展示
  const externalError = fieldErrors.email || fieldErrors.role || '';
  useEffect(() => {
    if (!externalError) setLocalError('');
  }, [externalError]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = email.trim().toLowerCase();
    if (!value) {
      setLocalError('请输入邮箱地址');
      return;
    }
    if (!EMAIL_PATTERN.test(value) || value.length > 254) {
      setLocalError('请输入有效的邮箱地址');
      return;
    }
    setLocalError('');
    onSubmit(value, role);
  }

  const shownError = localError || externalError;

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-3 px-4 py-4"
      aria-label="添加授权邮箱"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
        <Field
          label="邮箱地址"
          htmlFor="access-add-email"
          required
          error={shownError || undefined}
          className="min-w-0 flex-1"
        >
          <Input
            id="access-add-email"
            type="email"
            inputMode="email"
            autoComplete="off"
            spellCheck={false}
            placeholder="name@example.com"
            maxLength={254}
            value={email}
            disabled={submitting}
            aria-invalid={shownError ? true : undefined}
            onChange={(event) => {
              setEmail(event.target.value);
              setLocalError('');
            }}
          />
        </Field>
        <Field label="初始角色" htmlFor="access-add-role" className="w-full shrink-0 sm:w-[148px]">
          <Select
            id="access-add-role"
            value={role}
            disabled={submitting}
            onChange={(event) => setRole(event.target.value === 'admin' ? 'admin' : 'member')}
          >
            <option value="member">成员</option>
            <option value="admin">管理员</option>
          </Select>
        </Field>
        <div className="flex shrink-0 sm:pt-[22px]">
          <Button
            type="submit"
            variant="primary"
            loading={submitting}
            iconLeft={<UserPlus className="h-4 w-4" aria-hidden />}
            className="w-full sm:w-auto"
          >
            添加授权
          </Button>
        </div>
      </div>
      <p className="text-2xs leading-5 text-subtle">
        添加后该邮箱立即可用：无需注册，首次验证码验证即完成登录。
        {adminEmail ? ' 管理员账户邮箱：' + adminEmail + '。' : ''}
      </p>
      <ul className="flex flex-col gap-1 text-2xs leading-5 text-subtle sm:flex-row sm:gap-4">
        <li>成员：查看看板、推荐与统计</li>
        <li>管理员：额外可进入访问授权页管理名单</li>
      </ul>
    </form>
  );
}
