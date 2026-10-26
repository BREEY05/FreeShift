import { CheckCircle2, Copy, Pencil, Plus, Trash2 } from 'lucide-react';
import { useId } from 'react';
import type { SlotTemplate } from '@freeshift/shared';
import { cn } from '../../../lib/cn';
import { Badge } from '../../ui/Badge';
import { Button } from '../../ui/Button';
import { Card } from '../../ui/Card';

export interface TemplateListProps {
  templates: SlotTemplate[];
  selectedId: number | null;
  busy: boolean;
  onSelect: (id: number) => void;
  onCreate: () => void;
  onUse: (template: SlotTemplate) => void;
  onClone: (template: SlotTemplate) => void;
  onRename: (template: SlotTemplate) => void;
  onDelete: (template: SlotTemplate) => void;
}

/** 左侧模板列表：预设徽标、时间段数量、启用标记与操作 */
export function TemplateList({
  templates,
  selectedId,
  busy,
  onSelect,
  onCreate,
  onUse,
  onClone,
  onRename,
  onDelete,
}: TemplateListProps) {
  const headingId = useId();
  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2.5">
        <h2 id={headingId} className="text-xs font-semibold text-ink">
          模板列表
        </h2>
        <Button variant="soft" size="sm" iconLeft={<Plus className="h-3.5 w-3.5" aria-hidden />} onClick={onCreate} disabled={busy}>
          新建
        </Button>
      </div>
      <ul aria-labelledby={headingId} className="scrollbar-thin max-h-[560px] divide-y divide-line overflow-y-auto">
        {templates.map((template) => {
          const selected = template.id === selectedId;
          return (
            <li key={template.id} className={cn('transition-colors duration-150', selected ? 'bg-brand-soft' : '')}>
              <button
                type="button"
                aria-current={selected ? 'true' : undefined}
                onClick={() => onSelect(template.id)}
                className="flex w-full flex-col items-start gap-1 px-3 py-2.5 text-left hover:bg-canvas"
              >
                <span className="flex w-full items-center gap-1.5">
                  <span className={cn('truncate text-sm', selected ? 'font-semibold text-brand' : 'font-medium text-ink')}>
                    {template.name}
                  </span>
                  {template.isPreset ? <Badge tone="neutral">预设</Badge> : null}
                  {template.isActive ? <Badge tone="brand">启用中</Badge> : null}
                </span>
                <span className="text-2xs text-muted">
                  {template.slotCount} 个时间段
                  {template.isPreset ? ' · 只读' : ''}
                </span>
              </button>
              <div className="flex flex-wrap items-center gap-0.5 px-2 pb-1.5">
                {template.isActive ? (
                  <span className="inline-flex h-7 items-center gap-1 px-1.5 text-2xs text-mint">
                    <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
                    当前使用
                  </span>
                ) : (
                  <Button variant="ghost" size="sm" disabled={busy} onClick={() => onUse(template)}>
                    使用
                  </Button>
                )}
                <Button variant="ghost" size="sm" disabled={busy} onClick={() => onClone(template)} iconLeft={<Copy className="h-3.5 w-3.5" aria-hidden />}>
                  克隆
                </Button>
                {!template.isPreset ? (
                  <Button variant="ghost" size="sm" disabled={busy} onClick={() => onRename(template)} iconLeft={<Pencil className="h-3.5 w-3.5" aria-hidden />}>
                    改名
                  </Button>
                ) : null}
                {!template.isPreset && !template.isActive ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-danger hover:bg-red-50"
                    disabled={busy}
                    onClick={() => onDelete(template)}
                    iconLeft={<Trash2 className="h-3.5 w-3.5" aria-hidden />}
                  >
                    删除
                  </Button>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}