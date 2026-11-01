import { Clock3, Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import type { MyProfile } from '@freeshift/shared';
import { fetchTemplates, templateKeys } from '../../../api/templates';
import { useSetMyTemplate } from '../../../hooks/useUsers';
import { getErrorMessage } from '../../../lib/errors';
import { Alert } from '../../ui/Alert';
import { Badge } from '../../ui/Badge';
import { Button } from '../../ui/Button';
import { Card } from '../../ui/Card';
import { Field, Select } from '../../ui/Input';

export interface MyTableCardProps {
  profile: MyProfile;
  onSaved: (message: string) => void;
}

/** 我的表：显示当前个人表、切换同类型模板、新建我的表入口（时间段页） */
export function MyTableCard({ profile, onSaved }: MyTableCardProps) {
  const navigate = useNavigate();
  const mutation = useSetMyTemplate();
  const templatesQuery = useQuery({
    queryKey: templateKeys.list('all'),
    queryFn: () => fetchTemplates('all'),
    staleTime: 30_000,
  });

  const currentId = profile.user.templateId;
  const [selectedId, setSelectedId] = useState(currentId === null ? '' : String(currentId));
  useEffect(() => {
    setSelectedId(currentId === null ? '' : String(currentId));
  }, [currentId]);

  const templates = templatesQuery.data ?? [];
  /** 只有同类型模板可以切为个人表（后端 422 TEMPLATE_TYPE_MISMATCH） */
  const switchable = templates.filter((template) => template.sameTypeAsOrg || template.id === currentId);
  const dirty = selectedId !== '' && Number(selectedId) !== currentId;

  function handleSwitch() {
    if (!dirty) return;
    mutation.mutate(Number(selectedId), {
      onSuccess: (saved) => onSaved('已切换我的表为「' + (saved.templateName ?? '新表') + '」'),
    });
  }

  const errorMessage = mutation.isError ? getErrorMessage(mutation.error) : null;

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-1.5 text-sm font-medium text-ink">
            <Clock3 className="h-4 w-4 text-subtle" aria-hidden />
            我的表
          </h2>
          <p className="mt-0.5 text-2xs text-muted">
            个人安排按我的表的时间段展示；可切换同类型的既有模板，或新建一张自己的表。
          </p>
        </div>
        <Button
          variant="secondary"
          iconLeft={<Plus className="h-4 w-4" aria-hidden />}
          onClick={() => navigate('/slots')}
        >
          新建我的表
        </Button>
      </div>

      <div className="mt-3 rounded-control border border-line bg-canvas px-3 py-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-2xs text-subtle">当前个人表</span>
          <Badge tone="brand">{profile.user.templateName ?? '默认（组织模板）'}</Badge>
          <span className="tabular text-2xs text-subtle">{profile.slots.length} 个时间段</span>
        </div>
        {profile.slots.length > 0 ? (
          <p className="mt-1.5 truncate text-2xs text-subtle">
            {profile.slots
              .slice()
              .sort((a, b) => a.sortOrder - b.sortOrder)
              .map((slot) => slot.label)
              .join(' · ')}
          </p>
        ) : null}
      </div>

      {errorMessage ? <div className="mt-3"><Alert tone="danger" title="切换失败">{errorMessage}</Alert></div> : null}

      <div className="mt-3 flex flex-wrap items-end gap-2">
        <Field label="切换为同类型模板" htmlFor="my-table-select" className="min-w-[220px] flex-1">
          <Select
            id="my-table-select"
            value={selectedId}
            onChange={(event) => setSelectedId(event.target.value)}
            disabled={templatesQuery.isPending || mutation.isPending}
          >
            <option value="">{templatesQuery.isPending ? '加载中…' : '请选择模板'}</option>
            {switchable.map((template) => (
              <option key={template.id} value={template.id}>
                {template.name}
                {template.isOrgTemplate ? '（组织模板）' : template.isMine ? '（我的表）' : ''}
              </option>
            ))}
          </Select>
        </Field>
        <Button variant="primary" loading={mutation.isPending} disabled={!dirty} onClick={handleSwitch}>
          应用
        </Button>
      </div>
      {templatesQuery.isError ? (
        <p className="mt-2 text-2xs text-danger">可选模板加载失败：{getErrorMessage(templatesQuery.error)}</p>
      ) : null}
      <p className="mt-2 text-2xs leading-4 text-subtle">
        切换只影响你自己看板的行列展示；已有安排会按时间自动映射到新表，不会丢失。
      </p>
    </Card>
  );
}
