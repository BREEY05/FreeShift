import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, Layers, RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { SlotTemplate } from '@freeshift/shared';
import {
  activateTemplate,
  conflictScheduleCount,
  deleteTemplate,
  fetchTemplateDetail,
  fetchTemplates,
  templateKeys,
} from '../api/templates';
import { SlotEditor } from '../components/pages/templates/SlotEditor';
import { TemplateFormDialog, type TemplateFormMode } from '../components/pages/templates/TemplateFormDialog';
import { TemplateList } from '../components/pages/templates/TemplateList';
import { Alert } from '../components/ui/Alert';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Dialog } from '../components/ui/Dialog';
import { EmptyState } from '../components/ui/EmptyState';
import { Skeleton } from '../components/ui/Skeleton';
import { getErrorMessage } from '../lib/errors';

type FormState = { mode: TemplateFormMode; source?: SlotTemplate };

/** 时间段模板：左侧切换模板，右侧编辑时间段（预设只读，冲突 409 有明确指引） */
export default function TemplatesPage() {
  const queryClient = useQueryClient();
  const templatesQuery = useQuery({ queryKey: templateKeys.list(), queryFn: fetchTemplates, staleTime: 30_000 });
  const templates = templatesQuery.data ?? [];

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [dirty, setDirty] = useState(false);
  const [pendingSelectId, setPendingSelectId] = useState<number | null>(null);
  const [formState, setFormState] = useState<FormState | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SlotTemplate | null>(null);
  const [forcePrompt, setForcePrompt] = useState<{ template: SlotTemplate; count: number } | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    if (!statusMessage) return;
    const timer = window.setTimeout(() => setStatusMessage(null), 5000);
    return () => window.clearTimeout(timer);
  }, [statusMessage]);

  useEffect(() => {
    if (templates.length === 0) return;
    if (selectedId !== null && templates.some((template) => template.id === selectedId)) return;
    const active = templates.find((template) => template.isActive);
    setSelectedId(active?.id ?? templates[0]?.id ?? null);
  }, [templates, selectedId]);

  const detailQuery = useQuery({
    queryKey: templateKeys.detail(selectedId ?? 0),
    queryFn: () => fetchTemplateDetail(selectedId as number),
    enabled: selectedId !== null,
    staleTime: 15_000,
  });

  async function invalidateTemplateScoped(): Promise<void> {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: templateKeys.all }),
      queryClient.invalidateQueries({ queryKey: ['semester'] }),
      queryClient.invalidateQueries({ queryKey: ['board'] }),
      queryClient.invalidateQueries({ queryKey: ['schedules'] }),
      queryClient.invalidateQueries({ queryKey: ['recommend'] }),
    ]);
  }

  const activateMutation = useMutation({
    mutationFn: (input: { template: SlotTemplate; force: boolean }) => activateTemplate(input.template.id, input.force),
    onSuccess: async (_overview, input) => {
      await invalidateTemplateScoped();
      setForcePrompt(null);
      setActionError(null);
      setDirty(false);
      setStatusMessage('已切换到模板「' + input.template.name + '」');
    },
    onError: (error, input) => {
      const count = conflictScheduleCount(error);
      if (count !== null && !input.force) {
        setForcePrompt({ template: input.template, count });
        setActionError(null);
        return;
      }
      setForcePrompt(null);
      setActionError(getErrorMessage(error));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (template: SlotTemplate) => deleteTemplate(template.id),
    onSuccess: async (_data, template) => {
      if (selectedId === template.id) {
        setSelectedId(null);
        setDirty(false);
      }
      // 只失效列表与跨页数据；已删除模板的详情不再请求，避免 404
      queryClient.removeQueries({ queryKey: templateKeys.detail(template.id) });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: templateKeys.list() }),
        queryClient.invalidateQueries({ queryKey: ['semester'] }),
        queryClient.invalidateQueries({ queryKey: ['board'] }),
        queryClient.invalidateQueries({ queryKey: ['schedules'] }),
        queryClient.invalidateQueries({ queryKey: ['recommend'] }),
      ]);
      setDeleteTarget(null);
      setActionError(null);
      setStatusMessage('已删除模板「' + template.name + '」');
    },
    onError: (error) => setActionError(getErrorMessage(error)),
  });

  function handleSelect(id: number) {
    if (id === selectedId) return;
    if (dirty) {
      setPendingSelectId(id);
      return;
    }
    setDirty(false);
    setSelectedId(id);
  }

  function confirmDiscardAndSwitch() {
    if (pendingSelectId === null) return;
    setDirty(false);
    setSelectedId(pendingSelectId);
    setPendingSelectId(null);
  }

  const busy = activateMutation.isPending || deleteMutation.isPending;
  const activeTemplate = templates.find((template) => template.isActive) ?? null;

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-base font-semibold tracking-tight text-ink">时间段模板</h1>
            {activeTemplate ? <AlertInlineTemplate name={activeTemplate.name} /> : <span className="text-2xs text-amber">未启用模板</span>}
          </div>
          <p className="mt-0.5 text-xs text-muted">
            模板决定看板的行（时间段）。预设模板只读，可克隆后编辑；切换模板前请确认旧模板的安排是否已处理。
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            iconLeft={<RefreshCw className="h-4 w-4" aria-hidden />}
            aria-label="刷新模板"
            onClick={() => void templatesQuery.refetch()}
            disabled={templatesQuery.isFetching}
          >
            刷新
          </Button>
          <Button variant="primary" iconLeft={<Layers className="h-4 w-4" aria-hidden />} onClick={() => setFormState({ mode: 'create' })}>
            新建模板
          </Button>
        </div>
      </header>

      {statusMessage ? (
        <Alert
          tone="success"
          action={
            <Button variant="ghost" size="sm" onClick={() => setStatusMessage(null)}>
              关闭
            </Button>
          }
        >
          {statusMessage}
        </Alert>
      ) : null}

      {actionError ? (
        <Alert
          tone="danger"
          title="操作未完成"
          action={
            <Button variant="ghost" size="sm" onClick={() => setActionError(null)}>
              关闭
            </Button>
          }
        >
          {actionError}
        </Alert>
      ) : null}

      {!templatesQuery.isPending && !templatesQuery.isError && activeTemplate === null ? (
        <Alert tone="warning" title="当前学期尚未启用时间段模板">
          在左侧选择一个模板并点击「使用」，看板与推荐才会生成格子。
        </Alert>
      ) : null}

      {templatesQuery.isPending ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
          <Card className="p-3">
            <Skeleton className="h-5 w-24" />
            <div className="mt-3 space-y-2">
              {Array.from({ length: 4 }).map((_, index) => (
                <Skeleton key={index} className="h-14 w-full" />
              ))}
            </div>
          </Card>
          <Card className="p-4">
            <Skeleton className="h-6 w-40" />
            <div className="mt-4 space-y-2">
              {Array.from({ length: 5 }).map((_, index) => (
                <Skeleton key={index} className="h-9 w-full" />
              ))}
            </div>
          </Card>
        </div>
      ) : templatesQuery.isError ? (
        <Alert
          tone="danger"
          title="模板列表加载失败"
          action={
            <Button variant="secondary" size="sm" onClick={() => void templatesQuery.refetch()}>
              重试
            </Button>
          }
        >
          {getErrorMessage(templatesQuery.error)}
        </Alert>
      ) : templates.length === 0 ? (
        <EmptyState
          icon={<CalendarClock className="h-5 w-5" aria-hidden />}
          title="没有可用模板"
          description="正常情况下应预置若干模板；也可以先新建一个空模板，再逐个添加时间段。"
          action={
            <Button variant="primary" onClick={() => setFormState({ mode: 'create' })}>
              新建模板
            </Button>
          }
        />
      ) : (
        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
          <TemplateList
            templates={templates}
            selectedId={selectedId}
            busy={busy}
            onSelect={handleSelect}
            onCreate={() => setFormState({ mode: 'create' })}
            onUse={(template) => activateMutation.mutate({ template, force: false })}
            onClone={(template) => setFormState({ mode: 'clone', source: template })}
            onRename={(template) => setFormState({ mode: 'rename', source: template })}
            onDelete={(template) => {
              setActionError(null);
              setDeleteTarget(template);
            }}
          />

          {detailQuery.isPending ? (
            <Card className="p-4">
              <Skeleton className="h-6 w-40" />
              <div className="mt-4 space-y-2">
                {Array.from({ length: 5 }).map((_, index) => (
                  <Skeleton key={index} className="h-9 w-full" />
                ))}
              </div>
            </Card>
          ) : detailQuery.isError ? (
            <Alert
              tone="danger"
              title="模板详情加载失败"
              action={
                <Button variant="secondary" size="sm" onClick={() => void detailQuery.refetch()}>
                  重试
                </Button>
              }
            >
              {getErrorMessage(detailQuery.error)}
            </Alert>
          ) : detailQuery.data ? (
            <SlotEditor
              key={detailQuery.data.template.id}
              detail={detailQuery.data}
              onClone={() => setFormState({ mode: 'clone', source: detailQuery.data.template })}
              onSaved={(message) => {
                setDirty(false);
                setActionError(null);
                setStatusMessage(message);
              }}
              onDirtyChange={setDirty}
            />
          ) : null}
        </div>
      )}

      {formState ? (
        <TemplateFormDialog
          mode={formState.mode}
          source={formState.source}
          onClose={() => setFormState(null)}
          onSaved={(message, templateId) => {
            setFormState(null);
            setDirty(false);
            setStatusMessage(message);
            if (formState.mode !== 'rename') setSelectedId(templateId);
          }}
        />
      ) : null}

      {pendingSelectId !== null ? (
        <Dialog
          open
          onClose={() => setPendingSelectId(null)}
          size="sm"
          title="有未保存的时间段修改"
          footer={
            <div className="flex items-center justify-end gap-2">
              <Button variant="secondary" onClick={() => setPendingSelectId(null)}>
                继续编辑
              </Button>
              <Button variant="danger" onClick={confirmDiscardAndSwitch}>
                放弃修改并切换
              </Button>
            </div>
          }
        >
          <p className="text-xs leading-5 text-muted">
            当前模板的时间段尚未保存。切换模板会丢失这些修改，确定继续吗？
          </p>
        </Dialog>
      ) : null}

      {forcePrompt ? (
        <Dialog
          open
          onClose={() => setForcePrompt(null)}
          size="sm"
          title="旧模板仍有安排"
          footer={
            <div className="flex items-center justify-end gap-2">
              <Button variant="secondary" onClick={() => setForcePrompt(null)}>
                取消
              </Button>
              <Button
                variant="danger"
                loading={activateMutation.isPending}
                onClick={() => activateMutation.mutate({ template: forcePrompt.template, force: true })}
              >
                强制切换
              </Button>
            </div>
          }
        >
          <div className="space-y-3">
            <Alert tone="warning" title={'旧模板仍有 ' + forcePrompt.count + ' 条安排'}>
              切换后这些安排不会显示在新模板的看板上，但仍保留在数据库中。切回旧模板即可恢复显示。
            </Alert>
            <p className="text-xs leading-5 text-muted">
              如果希望保留当前安排，请先在看板中清理旧模板的占用，或取消本次切换。
            </p>
          </div>
        </Dialog>
      ) : null}

      {deleteTarget ? (
        <Dialog
          open
          onClose={() => {
            if (!deleteMutation.isPending) setDeleteTarget(null);
          }}
          size="sm"
          title="删除模板"
          footer={
            <div className="flex items-center justify-end gap-2">
              <Button variant="secondary" onClick={() => setDeleteTarget(null)} disabled={deleteMutation.isPending}>
                取消
              </Button>
              <Button variant="danger" loading={deleteMutation.isPending} onClick={() => deleteMutation.mutate(deleteTarget)}>
                确认删除
              </Button>
            </div>
          }
        >
          <div className="space-y-3">
            {deleteMutation.isError ? <Alert tone="danger">{getErrorMessage(deleteMutation.error)}</Alert> : null}
            <Alert tone="danger" title="删除后不可恢复">
              将删除模板「{deleteTarget.name}」及其 {deleteTarget.slotCount} 个时间段。
            </Alert>
            <p className="text-xs leading-5 text-muted">被学期使用或被安排引用的模板无法删除；此时可先切换模板或清理安排。</p>
          </div>
        </Dialog>
      ) : null}
    </div>
  );
}

function AlertInlineTemplate({ name }: { name: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-brand-soft px-1.5 py-0.5 text-2xs font-medium text-brand">
      当前模板：{name}
    </span>
  );
}