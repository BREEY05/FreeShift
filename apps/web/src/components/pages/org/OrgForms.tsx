import { useState, type FormEvent } from 'react';
import { Alert } from '../../ui/Alert';
import { Button } from '../../ui/Button';
import { Field, Input } from '../../ui/Input';

export interface CreateOrgFormProps {
  submitting: boolean;
  error: string | null;
  onSubmit: (name: string) => void;
}

/** 创建组织：只需组织名称，创建者自动成为负责人 */
export function CreateOrgForm({ submitting, error, onSubmit }: CreateOrgFormProps) {
  const [name, setName] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const shownError = localError ?? error;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = name.trim();
    if (value.length === 0) {
      setLocalError('请填写组织名称');
      return;
    }
    if (value.length > 80) {
      setLocalError('组织名称最多 80 个字符');
      return;
    }
    setLocalError(null);
    onSubmit(value);
  }

  return (
    <form className="flex flex-col gap-3 px-4 py-3" onSubmit={handleSubmit} noValidate>
      <Field label="组织名称" htmlFor="org-create-name" required error={shownError} hint="例如「2024 级 3 班」或「算法组」">
        <Input
          id="org-create-name"
          value={name}
          maxLength={80}
          placeholder="输入组织名称"
          autoComplete="off"
          aria-invalid={shownError ? true : undefined}
          onChange={(event) => {
            setName(event.target.value);
            if (localError) setLocalError(null);
          }}
        />
      </Field>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-2xs leading-5 text-subtle">创建后你会成为负责人，系统会自动生成组织 ID 与初始时间段模板。</p>
        <Button type="submit" variant="primary" loading={submitting} disabled={submitting}>
          创建组织
        </Button>
      </div>
    </form>
  );
}

export interface JoinOrgFormProps {
  submitting: boolean;
  error: string | null;
  onSubmit: (code: string) => void;
}

/** 通过组织 ID 申请加入：提交后需等待负责人审批 */
export function JoinOrgForm({ submitting, error, onSubmit }: JoinOrgFormProps) {
  const [code, setCode] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const shownError = localError ?? error;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = code.trim().toUpperCase();
    if (value.length === 0) {
      setLocalError('请输入组织 ID');
      return;
    }
    setLocalError(null);
    onSubmit(value);
  }

  return (
    <form className="flex flex-col gap-3 px-4 py-3" onSubmit={handleSubmit} noValidate>
      <Field label="组织 ID" htmlFor="org-join-code" required error={shownError} hint="向负责人索取 8 位组织 ID，提交后需等待审批">
        <Input
          id="org-join-code"
          value={code}
          maxLength={32}
          placeholder="例如 3F9A2C81"
          autoComplete="off"
          spellCheck={false}
          className="tabular uppercase tracking-[0.12em]"
          aria-invalid={shownError ? true : undefined}
          onChange={(event) => {
            setCode(event.target.value.toUpperCase().replace(/\s+/g, ''));
            if (localError) setLocalError(null);
          }}
        />
      </Field>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-2xs leading-5 text-subtle">加入后即可查看看板、推荐与统计；负责人审批通过前无法访问组织数据。</p>
        <Button type="submit" variant="secondary" loading={submitting} disabled={submitting}>
          申请加入
        </Button>
      </div>
      {error ? <Alert tone="danger" title="加入失败">{error}</Alert> : null}
    </form>
  );
}
