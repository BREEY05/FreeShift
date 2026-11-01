import { CheckCircle2, Copy, Pencil, Plus, Star, Trash2 } from 'lucide-react';
import { useId } from 'react';
import type { SlotTemplate } from '@freeshift/shared';
import { cn } from '../../../lib/cn';
import { Badge } from '../../ui/Badge';
import { Button } from '../../ui/Button';
import { Card } from '../../ui/Card';

/** 左侧分组：预设时间类型 / 组织模板 / 我的表 / 其他成员的表 */
export interface TemplateGroup {
  key: string;
  title: string;
  /** 分组说明：为什么这些模板只读、能做什么 */
  description: string;
  templates: SlotTemplate[];
  /** 分组为空时的提示文案（有值时渲染占位） */
  emptyText?: string;
  /** 分组为空时展示的新建按钮文案 */
  emptyActionLabel?: string;
}

export interface TemplateListProps {
  groups: TemplateGroup[];
  selectedId: number | null;
  busy: boolean;
  isAdmin: boolean;
  /** 是否有编辑（改名/删除/存时间段）权限：预设只读、个人表仅本人或管理员、组织共享仅管理员 */
  canEdit: (template: SlotTemplate) => boolean;
  /** 当前个人表模板 id（app_user.template_id ?? 组织模板） */
  currentPersonalTemplateId: number | null;
  onSelect: (id: number) => void;
  onCreate: () => void;
  onUse: (template: SlotTemplate) => void;
  onClone: (template: SlotTemplate) => void;
  onRename: (template: SlotTemplate) => void;
  onDelete: (template: SlotTemplate) => void;
  onSetMine: (template: SlotTemplate) => void;
}

/** 左侧模板列表：按「预设 / 组织模板 / 我的表」分组，按权限展示操作 */
export function TemplateList({
  groups,
  selectedId,
  busy,
  isAdmin,
  canEdit,
  currentPersonalTemplateId,
  onSelect,
  onCreate,
  onUse,
  onClone,
  onRename,
  onDelete,
  onSetMine,
}: TemplateListProps) {
  const headingId = useId();
  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2.5">
        <h2 id={headingId} className="text-xs font-semibold text-ink">
          时间类型与表
        </h2>
        <Button variant="soft" size="sm" iconLeft={<Plus className="h-3.5 w-3.5" aria-hidden />} onClick={onCreate} disabled={busy}>
          新建我的表
        </Button>
      </div>
      <div aria-labelledby={headingId} className="scrollbar-thin max-h-[620px] divide-y divide-line overflow-y-auto">
        {groups.map((group) => (
          <section key={group.key} aria-label={group.title}>
            <div className="sticky top-0 z-10 border-b border-line bg-canvas px-3 py-2">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-2xs font-semibold text-muted">{group.title}</h3>
                <span className="tabular text-2xs text-subtle">{group.templates.length}</span>
              </div>
              <p className="mt-0.5 text-2xs leading-4 text-subtle">{group.description}</p>
            </div>
            {group.templates.length === 0 ? (
              group.emptyText ? (
                <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5">
                  <p className="text-2xs leading-4 text-subtle">{group.emptyText}</p>
                  {group.emptyActionLabel ? (
                    <Button variant="ghost" size="sm" iconLeft={<Plus className="h-3.5 w-3.5" aria-hidden />} onClick={onCreate} disabled={busy}>
                      {group.emptyActionLabel}
                    </Button>
                  ) : null}
                </div>
              ) : null
            ) : (
              <ul>
                {group.templates.map((template) => {
                  const selected = template.id === selectedId;
                  const editable = canEdit(template);
                  const isCurrentPersonal = template.id === currentPersonalTemplateId;
                  const canSetMine = !isCurrentPersonal && template.sameTypeAsOrg;
                  return (
                    <li key={template.id} className={cn('transition-colors duration-150', selected ? 'bg-brand-soft' : '')}>
                      <button
                        type="button"
                        aria-current={selected ? 'true' : undefined}
                        onClick={() => onSelect(template.id)}
                        className="flex w-full flex-col items-start gap-1 px-3 py-2.5 text-left hover:bg-canvas"
                      >
                        <span className="flex w-full flex-wrap items-center gap-1">
                          <span className={cn('truncate text-sm', selected ? 'font-semibold text-brand' : 'font-medium text-ink')}>
                            {template.name}
                          </span>
                          {template.isPreset ? <Badge tone="neutral">预设</Badge> : null}
                          {template.isOrgTemplate ? <Badge tone="brand">组织模板</Badge> : null}
                          {template.isMine ? (
                            <Badge tone="mint">
                              <Star className="h-3 w-3" aria-hidden />
                              我的表
                            </Badge>
                          ) : null}
                          {isCurrentPersonal ? <Badge tone="amber">当前个人表</Badge> : null}
                          {template.isActive ? <Badge tone="brand">学期启用中</Badge> : null}
                        </span>
                        <span className="text-2xs text-muted">
                          {template.slotCount} 个时间段
                          {template.isPreset ? ' · 内置只读' : template.ownerEmail ? ' · 归属 ' + template.ownerEmail : ' · 组织共享'}
                          {!template.sameTypeAsOrg && !template.isPreset ? ' · 与组织时间类型不同' : ''}
                        </span>
                      </button>
                      <div className="flex flex-wrap items-center gap-0.5 px-2 pb-1.5">
                        {isAdmin && !template.isActive ? (
                          <Button variant="ghost" size="sm" disabled={busy} onClick={() => onUse(template)}>
                            设为学期模板
                          </Button>
                        ) : null}
                        {isAdmin && template.isActive ? (
                          <span className="inline-flex h-7 items-center gap-1 px-1.5 text-2xs text-mint">
                            <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
                            学期启用中
                          </span>
                        ) : null}
                        {canSetMine ? (
                          <Button variant="ghost" size="sm" disabled={busy} onClick={() => onSetMine(template)}>
                            设为我的表
                          </Button>
                        ) : null}
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={busy}
                          onClick={() => onClone(template)}
                          iconLeft={<Copy className="h-3.5 w-3.5" aria-hidden />}
                        >
                          克隆
                        </Button>
                        {editable ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={busy}
                            onClick={() => onRename(template)}
                            iconLeft={<Pencil className="h-3.5 w-3.5" aria-hidden />}
                          >
                            改名
                          </Button>
                        ) : null}
                        {editable && !template.isActive ? (
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
            )}
          </section>
        ))}
      </div>
    </Card>
  );
}
