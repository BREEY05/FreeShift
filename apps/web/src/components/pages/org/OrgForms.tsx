import { useState, type FormEvent } from 'react';
import type { OrgPreset } from '../../../api/org';
import { Alert } from '../../ui/Alert';
import { Button } from '../../ui/Button';
import { Field, Input } from '../../ui/Input';

export interface CreateOrgFormProps {
  submitting: boolean;
  error: string | null;
  presets: OrgPreset[];
  selectedPreset: string;
  onPresetChange: (name: string) => void;
  onSubmit: (name: string) => void;
}

/** 创建组织：名称与组织时间类型，创建者自动成为负责人 */
export function CreateOrgForm({ submitting, error, presets, selectedPreset, onPresetChange, onSubmit }: CreateOrgFormProps) {
  const [name, setName] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const shownError = localError ?? error;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = name.trim();
    if (!selectedPreset) { setLocalError('请选择组织时间类型'); return; }
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
      <Field label="组织时间类型" htmlFor="org-create-preset" required error={shownError}>
        <select id="org-create-preset" value={selectedPreset} onChange={e=>onPresetChange(e.target.value)} className="w-full rounded-control border border-line bg-canvas px-3 py-2 text-xs text-ink">
          <option value="">请选择预设模板</option>{presets.map(p=><option key={p.name} value={p.name}>{p.name}（{p.slotCount} 个时段）</option>)}
        </select>
      </Field>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-2xs leading-5 text-subtle">创建者成为负责人，并设置组织时间类型。</p>
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
