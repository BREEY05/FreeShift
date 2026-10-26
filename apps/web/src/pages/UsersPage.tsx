import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDownUp, Plus, RefreshCw, Users as UsersIcon } from 'lucide-react';
import { useEffect, useState, type DragEvent } from 'react';
import type { AppUser } from '@freeshift/shared';
import { deleteUserPermanently, fetchUsers, reorderUsers, updateUser, userKeys } from '../api/users';
import { UserFormDialog } from '../components/pages/users/UserFormDialog';
import { UserRow } from '../components/pages/users/UserRow';
import { Alert } from '../components/ui/Alert';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Dialog } from '../components/ui/Dialog';
import { EmptyState } from '../components/ui/EmptyState';
import { Skeleton } from '../components/ui/Skeleton';
import { getErrorMessage } from '../lib/errors';

type FormState = { mode: 'create' } | { mode: 'edit'; user: AppUser };

/** 用户管理：列表、排序、启停、新增/编辑、彻底删除 */
export default function UsersPage() {
  const queryClient = useQueryClient();
  const usersQuery = useQuery({
    queryKey: userKeys.list(true),
    queryFn: () => fetchUsers(true),
    staleTime: 30_000,
  });
  const users = usersQuery.data ?? [];

  const [formState, setFormState] = useState<FormState | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AppUser | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);

  useEffect(() => {
    if (!statusMessage) return;
    const timer = window.setTimeout(() => setStatusMessage(null), 5000);
    return () => window.clearTimeout(timer);
  }, [statusMessage]);

  async function invalidateUserScoped(): Promise<void> {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: userKeys.all }),
      queryClient.invalidateQueries({ queryKey: ['board'] }),
      queryClient.invalidateQueries({ queryKey: ['schedules'] }),
      queryClient.invalidateQueries({ queryKey: ['stats'] }),
      queryClient.invalidateQueries({ queryKey: ['recommend'] }),
    ]);
  }

  const toggleMutation = useMutation({
    mutationFn: (user: AppUser) => updateUser(user.id, { isActive: !user.isActive }),
    onSuccess: async (saved) => {
      await invalidateUserScoped();
      setErrorMessage(null);
      setStatusMessage(saved.isActive ? '已启用成员「' + saved.name + '」' : '已停用成员「' + saved.name + '」，历史安排保留');
    },
    onError: (error) => setErrorMessage(getErrorMessage(error)),
  });

  const reorderMutation = useMutation({
    mutationFn: (ids: number[]) => reorderUsers(ids),
    onMutate: async (ids) => {
      await queryClient.cancelQueries({ queryKey: userKeys.list(true) });
      const previous = queryClient.getQueryData<AppUser[]>(userKeys.list(true));
      if (previous) {
        const byId = new Map(previous.map((user) => [user.id, user]));
        const next = ids
          .map((id) => byId.get(id))
          .filter((user): user is AppUser => user !== undefined);
        queryClient.setQueryData(userKeys.list(true), next);
      }
      return { previous };
    },
    onError: (error, _ids, context) => {
      if (context?.previous) queryClient.setQueryData(userKeys.list(true), context.previous);
      setErrorMessage(getErrorMessage(error));
    },
    onSuccess: (nextUsers) => {
      queryClient.setQueryData(userKeys.list(true), nextUsers);
      setErrorMessage(null);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: userKeys.all });
      void queryClient.invalidateQueries({ queryKey: ['board'] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (user: AppUser) => deleteUserPermanently(user.id),
    onSuccess: async (_data, user) => {
      await invalidateUserScoped();
      setDeleteTarget(null);
      setErrorMessage(null);
      setStatusMessage('已彻底删除成员「' + user.name + '」，其安排已一并删除');
    },
    onError: (error) => setErrorMessage(getErrorMessage(error)),
  });

  const busy = toggleMutation.isPending || reorderMutation.isPending || deleteMutation.isPending;
  const activeCount = users.filter((user) => user.isActive).length;

  function moveUser(index: number, delta: number) {
    const target = index + delta;
    if (target < 0 || target >= users.length) return;
    const next = [...users];
    const [item] = next.splice(index, 1);
    next.splice(target, 0, item);
    reorderMutation.mutate(next.map((user) => user.id));
  }

  function handleDragStart(index: number, event: DragEvent<HTMLDivElement>) {
    if (busy) return;
    event.dataTransfer.effectAllowed = 'move';
    setDragIndex(index);
  }

  function handleDragOver(index: number, event: DragEvent<HTMLDivElement>) {
    if (dragIndex === null) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    if (overIndex !== index) setOverIndex(index);
  }

  function handleDrop(index: number, event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    const from = dragIndex;
    setDragIndex(null);
    setOverIndex(null);
    if (from === null || from === index) return;
    const next = [...users];
    const [item] = next.splice(from, 1);
    next.splice(index, 0, item);
    reorderMutation.mutate(next.map((user) => user.id));
  }

  function handleDragEnd() {
    setDragIndex(null);
    setOverIndex(null);
  }

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-base font-semibold tracking-tight text-ink">用户管理</h1>
            <Badge tone="neutral">{users.length} 位成员</Badge>
            {activeCount !== users.length ? <Badge tone="amber">{users.length - activeCount} 位停用</Badge> : null}
          </div>
          <p className="mt-0.5 text-xs text-muted">
            添加成员并设置颜色；停用后不再出现在看板与推荐中，彻底删除会同时清空其安排。
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            iconLeft={<RefreshCw className="h-4 w-4" aria-hidden />}
            aria-label="刷新成员列表"
            onClick={() => void usersQuery.refetch()}
            disabled={usersQuery.isFetching}
          >
            刷新
          </Button>
          <Button
            variant="primary"
            iconLeft={<Plus className="h-4 w-4" aria-hidden />}
            onClick={() => setFormState({ mode: 'create' })}
          >
            添加成员
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

      {errorMessage ? (
        <Alert
          tone="danger"
          title="操作失败"
          action={
            <Button variant="ghost" size="sm" onClick={() => setErrorMessage(null)}>
              关闭
            </Button>
          }
        >
          {errorMessage}
        </Alert>
      ) : null}

      {usersQuery.isPending ? (
        <Card className="overflow-hidden">
          <div className="border-b border-line px-4 py-3">
            <Skeleton className="h-4 w-32" />
          </div>
          <div className="divide-y divide-line">
            {Array.from({ length: 5 }).map((_, index) => (
              <div key={index} className="flex items-center gap-3 px-4 py-3">
                <Skeleton className="h-9 w-9 rounded-full" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-3.5 w-24" />
                  <Skeleton className="h-3 w-40" />
                </div>
                <Skeleton className="h-8 w-20" />
              </div>
            ))}
          </div>
        </Card>
      ) : usersQuery.isError ? (
        <Alert
          tone="danger"
          title="成员列表加载失败"
          action={
            <Button variant="secondary" size="sm" onClick={() => void usersQuery.refetch()}>
              重试
            </Button>
          }
        >
          {getErrorMessage(usersQuery.error)}
        </Alert>
      ) : users.length === 0 ? (
        <EmptyState
          icon={<UsersIcon className="h-5 w-5" aria-hidden />}
          title="还没有成员"
          description="先添加第一位成员，设置姓名与颜色。之后即可在看板中登记占用、查看聚合空闲与推荐。"
          action={
            <Button
              variant="primary"
              iconLeft={<Plus className="h-4 w-4" aria-hidden />}
              onClick={() => setFormState({ mode: 'create' })}
            >
              添加第一位成员
            </Button>
          }
        />
      ) : (
        <Card className="overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-3 py-2.5 sm:px-4">
            <div className="flex items-center gap-1.5 text-2xs text-muted">
              <ArrowDownUp className="h-3.5 w-3.5 text-subtle" aria-hidden />
              <span>拖动行或使用 ↑ ↓ 调整顺序，顺序会同步到看板与导出。</span>
            </div>
            <span className="tabular text-2xs text-subtle">启用 {activeCount} / 共 {users.length}</span>
          </div>

          <div className="divide-y divide-line">
            {users.map((user, index) => (
              <UserRow
                key={user.id}
                user={user}
                isFirst={index === 0}
                isLast={index === users.length - 1}
                busy={busy}
                dragging={dragIndex === index}
                dragOver={overIndex === index && dragIndex !== index}
                onMoveUp={() => moveUser(index, -1)}
                onMoveDown={() => moveUser(index, 1)}
                onEdit={() => setFormState({ mode: 'edit', user })}
                onToggleActive={() => toggleMutation.mutate(user)}
                onDelete={() => setDeleteTarget(user)}
                onDragStart={(event) => handleDragStart(index, event)}
                onDragOver={(event) => handleDragOver(index, event)}
                onDrop={(event) => handleDrop(index, event)}
                onDragEnd={handleDragEnd}
              />
            ))}
          </div>

          <div className="border-t border-line bg-canvas px-3 py-2 sm:px-4">
            <p className="text-2xs leading-5 text-subtle">
              停用是软删除：历史安排与统计保留。彻底删除不可恢复，请优先使用停用。
            </p>
          </div>
        </Card>
      )}

      {formState ? (
        <UserFormDialog
          mode={formState.mode}
          user={formState.mode === 'edit' ? formState.user : undefined}
          onClose={() => setFormState(null)}
          onSaved={(message) => {
            setFormState(null);
            setErrorMessage(null);
            setStatusMessage(message);
          }}
        />
      ) : null}

      {deleteTarget ? (
        <Dialog
          open
          onClose={() => {
            if (!deleteMutation.isPending) setDeleteTarget(null);
          }}
          size="sm"
          title="彻底删除成员"
          footer={
            <div className="flex items-center justify-end gap-2">
              <Button variant="secondary" onClick={() => setDeleteTarget(null)} disabled={deleteMutation.isPending}>
                取消
              </Button>
              <Button
                variant="danger"
                loading={deleteMutation.isPending}
                onClick={() => deleteMutation.mutate(deleteTarget)}
              >
                确认删除
              </Button>
            </div>
          }
        >
          <div className="space-y-3">
            <Alert tone="danger" title="此操作不可恢复">
              将删除「{deleteTarget.name}」及其全部安排，统计数据也会随之变化。
            </Alert>
            <p className="text-xs leading-5 text-muted">
              如果只是想暂时从看板移除，请在列表中点击「停用」；停用会保留历史安排，可随时重新启用。
            </p>
          </div>
        </Dialog>
      ) : null}
    </div>
  );
}
