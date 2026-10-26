import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import type { SlotTemplate } from '@freeshift/shared';
import { createTemplate, templateKeys, updateTemplate } from '../../../api/templates';
import { getErrorMessage, getFieldErrors } from '../../../lib/errors';
import { Alert } from '../../ui/Alert';
import { Button } from '../../ui/Button';
import { Dialog } from '../../ui/Dialog';
import { Field, Input, Textarea } from '../../ui/Input';

export type TemplateFormMode = 'create' | 'clone' | 'rename';

export interface TemplateFormDialogProps {
  mode: TemplateFormMode;
  source?: SlotTemplate;
  onClose: () => void;
  onSaved: (message: string, templateId: number) => void;
}

const TITLES: Record<TemplateFormMode, string> = {
  create: '新建自定义模板',
  clone: '克隆模板',
  rename: '重命名模板',
};

const DESCRIPTIONS: Record<TemplateFormMode, string> = {
  create: '新建空模板，随后在右侧逐个添加时间段。',
  clone: '复制来源模板的全部时间段，生成可自由编辑的自定义模板。',
  rename: '仅修改模板名称与描述，不影响时间段与已启用状态。',
};

/** 模板新建 / 克隆 / 重命名对话框 */
export function TemplateFormDialog({ mode, source, onClose, onSaved }: TemplateFormDialogProps) {
  const queryClient = useQueryClient();
  const formId = useId();
  const [name, setName] = useState(() => {
    if (mode === 'clone' && source) return source.name + ' 副本';
    if (mode === 'rename' && source) return source.name;
    return '';
  });
  const [description, setDescription] = useState(source?.description ?? '');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const mutation = useMutation({
    mutationFn: async () => {
      if (mode === 'rename' && source) {
        return updateTemplate(source.id, { name: name.trim(), description: description.trim() });
      }
      return createTemplate({
        name: name.trim(),
        description: description.trim(),
        cloneFrom: mode === 'clone' && source ? source.id : undefined,
      });
    },
    onSuccess: async (detail) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: templateKeys.all }),
        queryClient.invalidateQueries({ queryKey: ['board'] }),
        queryClient.invalidateQueries({ queryKey: ['semester'] }),
      ]);
      onSaved(mode === 'rename' ? '模板已重命名' : mode === 'clone' ? '已克隆模板' : '已新建模板', detail.template.id);
    },
    onError: (error) => setFieldErrors(getFieldErrors(error)),
  });

  function handleSubmit() {
    if (!name.trim()) {
      setFieldErrors({ name: '请输入模板名称' });
      return;
    }
    mutation.mutate();
  }

  const errorMessage = mutation.isError ? getErrorMessage(mutation.error) : null;

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
          <Alert tone="danger" title={errorMessage.includes('已存在') ? '名称重复' : '保存失败'}>
            {errorMessage}
          </Alert>
        ) : null}
        {mode === 'clone' && source ? (
          <p className="rounded-control border border-line bg-canvas px-3 py-2 text-2xs leading-5 text-muted">
            来源模板：<span className="font-medium text-ink">{source.name}</span>（{source.slotCount} 个时间段）
          </p>
        ) : null}
        <Field label="模板名称" required htmlFor={formId + '-name'} error={fieldErrors.name} hint="同一学期内名称不可重复">
          <Input
            id={formId + '-name'}
            value={name}
            maxLength={50}
            placeholder="如：早晚两段制"
            autoFocus
            onChange={(event) => {
              setName(event.target.value);
              setFieldErrors({});
              mutation.reset();
            }}
            disabled={mutation.isPending}
          />
        </Field>
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
