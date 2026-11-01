import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import type { SlotTemplate } from '@freeshift/shared';
import { ApiError } from '../../../api/client';
import { createTemplate, templateKeys, updateTemplate } from '../../../api/templates';
import { getErrorMessage, getFieldErrors } from '../../../lib/errors';
import { Alert } from '../../ui/Alert';
import { Button } from '../../ui/Button';
import { Dialog } from '../../ui/Dialog';
import { Field, Input, Select, Textarea } from '../../ui/Input';

export type TemplateFormMode = 'create' | 'clone' | 'rename';

export interface TemplateFormDialogProps {
  mode: TemplateFormMode;
  /** clone / rename 的来源模板 */
  source?: SlotTemplate;
  /** create 模式下可选的克隆来源（预设 / 组织模板 / 自己的表） */
  cloneOptions?: SlotTemplate[];
  onClose: () => void;
  onSaved: (message: string, templateId: number) => void;
}

const TITLES: Record<TemplateFormMode, string> = {
  create: '新建我的表',
  clone: '克隆为我的表',
  rename: '重命名模板',
};

const DESCRIPTIONS: Record<TemplateFormMode, string> = {
  create: '新表归你所有；可以从现有模板复制时间段，也可以先建空表再在右侧添加。',
  clone: '复制来源模板的全部时间段，生成一张归你所有、可自由编辑的表。',
  rename: '仅修改模板名称与描述，不影响时间段与启用状态。',
};

/** 模板新建 / 克隆 / 重命名对话框（新建与克隆都会生成归当前用户所有的表） */
export function TemplateFormDialog({ mode, source, cloneOptions, onClose, onSaved }: TemplateFormDialogProps) {
  const queryClient = useQueryClient();
  const formId = useId();
  const [name, setName] = useState(() => {
    if (mode === 'clone' && source) return source.name + ' 副本';
    if (mode === 'rename' && source) return source.name;
    return '';
  });
  const [description, setDescription] = useState(source?.description ?? '');
  const [cloneFromId, setCloneFromId] = useState<number | null>(() => (mode === 'clone' && source ? source.id : null));
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const mutation = useMutation({
    mutationFn: async () => {
      if (mode === 'rename' && source) {
        return updateTemplate(source.id, { name: name.trim(), description: description.trim() });
      }
      return createTemplate({
        name: name.trim(),
        description: description.trim(),
        cloneFrom: cloneFromId ?? undefined,
      });
    },
    onSuccess: async (detail) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: templateKeys.all }),
        queryClient.invalidateQueries({ queryKey: ['users'] }),
        queryClient.invalidateQueries({ queryKey: ['board'] }),
        queryClient.invalidateQueries({ queryKey: ['semester'] }),
      ]);
      onSaved(
        mode === 'rename' ? '模板已重命名' : mode === 'clone' ? '已克隆为我的表' : '已新建我的表',
        detail.template.id,
      );
    },
    onError: (error) => setFieldErrors(getFieldErrors(error)),
  });

  function handleSubmit() {
    if (!name.trim()) {
      setFieldErrors({ name: '请输入表的名称' });
      return;
    }
    mutation.mutate();
  }

  const errorMessage = mutation.isError ? getErrorMessage(mutation.error) : null;
  const duplicated = mutation.isError && mutation.error instanceof ApiError && mutation.error.status === 409;
  const sources = cloneOptions ?? [];

  return (
    <Dialog
      open
      onClose={onClose}
      size="sm"
      title={TITLES[mode]}
      description={DESCRIPTIONS[mode]}
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={mutation.isPending}>
            取消
          </Button>
          <Button variant="primary" loading={mutation.isPending} onClick={handleSubmit}>
            {mode === 'rename' ? '保存' : mode === 'clone' ? '克隆' : '创建'}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {errorMessage ? (
          <Alert tone="danger" title={duplicated ? '名称重复' : '保存失败'}>
            {errorMessage}
          </Alert>
        ) : null}
        {mode === 'clone' && source ? (
          <p className="rounded-control border border-line bg-canvas px-3 py-2 text-2xs leading-5 text-muted">
            来源模板：<span className="font-medium text-ink">{source.name}</span>（{source.slotCount} 个时间段）
          </p>
        ) : null}
        <Field
          label="表名称"
          required
          htmlFor={formId + '-name'}
          error={fieldErrors.name}
          hint="同一组织内名称不可重复；建议按课表分段命名，如「早晚两段制」"
        >
          <Input
            id={formId + '-name'}
            value={name}
            maxLength={50}
            placeholder="如：我的早晚两段表"
            autoFocus
            onChange={(event) => {
              setName(event.target.value);
              setFieldErrors({});
              mutation.reset();
            }}
            disabled={mutation.isPending}
          />
        </Field>
        {mode === 'create' && sources.length > 0 ? (
          <Field
            label="从现有模板克隆（可选）"
            htmlFor={formId + '-clone'}
            hint="预设与组织模板只读；克隆一份到自己的表后即可修改时间段"
          >
            <Select
              id={formId + '-clone'}
              value={cloneFromId === null ? '' : String(cloneFromId)}
              disabled={mutation.isPending}
              onChange={(event) => {
                setCloneFromId(event.target.value === '' ? null : Number(event.target.value));
                mutation.reset();
              }}
            >
              <option value="">不克隆，创建空表</option>
              {sources.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.name}
                  {template.isPreset ? '（预设）' : template.isOrgTemplate ? '（组织模板）' : ''} · {template.slotCount} 个时间段
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
        <Field label="描述" htmlFor={formId + '-description'} error={fieldErrors.description} hint="可选，最多 200 字">
          <Textarea
            id={formId + '-description'}
            value={description}
            maxLength={200}
            placeholder="如：上午 2 节 + 下午 2 节"
            onChange={(event) => {
              setDescription(event.target.value);
              setFieldErrors({});
              mutation.reset();
            }}
            disabled={mutation.isPending}
          />
        </Field>
      </div>
    </Dialog>
  );
}
