import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ListChecks, RefreshCw, UserRound, Users as UsersIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { AppUser } from '@freeshift/shared';
import { useSession } from '../auth/session';
import {
  deleteUserPermanently,
  fetchUsers,
  reorderUsers,
  updateUser,
  userKeys,
} from '../api/users';
import { useMyProfile } from '../hooks/useUsers';
import { OrgRequiredNotice } from '../components/layout/OrgRequiredNotice';
import { MemberBoardDialog } from '../components/pages/users/MemberBoardDialog';
import { MemberRow } from '../components/pages/users/MemberRow';
import { MyTableCard } from '../components/pages/users/MyTableCard';
import { ProfileEditor } from '../components/pages/users/ProfileEditor';
import { UserFormDialog } from '../components/pages/users/UserFormDialog';
import { Alert } from '../components/ui/Alert';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Dialog } from '../components/ui/Dialog';
import { EmptyState } from '../components/ui/EmptyState';
import { Skeleton } from '../components/ui/Skeleton';
import { userInitial, userSoftBackground } from '../lib/colors';
import { getErrorMessage } from '../lib/errors';

/** 用户页（契约 v3）：普通成员 = 我的资料 + 我的表；管理员 = 本组织已加入成员列表 + 每人个人表 */
export default function UsersPage() {
  const { isAdmin } = useSession();
  return isAdmin ? <AdminMembersView /> : <MyProfileView />;
}

/** 普通成员：查看/编辑自己的资料，设置我的表 */
function MyProfileView() {
  const profileQuery = useMyProfile();
  const [editing, setEditing] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!statusMessage) return;
    const timer = window.setTimeout(() => setStatusMessage(null), 5000);
    return () => window.clearTimeout(timer);
  }, [statusMessage]);

  if (profileQuery.isPending) {
    return (
      <div className="flex flex-col gap-4">
        <ProfileSkeleton />
      </div>
    );
  }

  if (profileQuery.isError || !profileQuery.data) {
    return <OrgRequiredNotice error={profileQuery.error} title="我的资料加载失败" />;
  }

  const profile = profileQuery.data;
  const user = profile.user;

  return (
    <div className="flex flex-col gap-4">
      <header>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-base font-semibold tracking-tight text-ink">我的资料</h1>
          <Badge tone="neutral">普通成员</Badge>
        </div>
        <p className="mt-0.5 text-xs text-muted">
          维护自己的姓名 / 颜色 / 备注，并设置「我的表」；组织成员与审批由管理员在组织页管理。
        </p>
      </header>

      {statusMessage ? (
        <Alert tone="success" action={<Button variant="ghost" size="sm" onClick={() => setStatusMessage(null)}>关闭</Button>}>
          {statusMessage}
        </Alert>
      ) : null}

      <Card className="p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <span
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-base font-semibold"
              style={{ backgroundColor: userSoftBackground(user.color), color: user.color }}
              aria-hidden
            >
              {userInitial(user.name)}
            </span>
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-ink">{user.name}</div>
              <div className="truncate text-2xs text-subtle">{user.email || '未绑定登录邮箱'}</div>
              <div className="mt-0.5 truncate text-2xs text-muted">{user.note || '暂无备注'}</div>
            </div>
          </div>
          <Button variant="secondary" iconLeft={<UserRound className="h-4 w-4" aria-hidden />} onClick={() => setEditing(true)}>
            编辑资料
          </Button>
        </div>
      </Card>

      <MyTableCard profile={profile} onSaved={setStatusMessage} />

      {editing ? (
        <ProfileEditor user={user} onClose={() => setEditing(false)} onSaved={(message) => { setEditing(false); setStatusMessage(message); }} />
      ) : null}
    </div>
  );
}

/** 管理员：本组织已加入成员列表（头像 / 邮箱 / 表名 / 最近状态），点成员查看其个人表 */
function AdminMembersView() {
  const queryClient = useQueryClient();
  const usersQuery = useQuery({
    queryKey: userKeys.list(true),
    queryFn: () => fetchUsers(true),
    staleTime: 30_000,
  });
  const users = usersQuery.data ?? [];

  const [manage, setManage] = useState(false);
  const [viewTarget, setViewTarget] = useState<AppUser | null>(null);
  const [editTarget, setEditTarget] = useState<AppUser | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AppUser | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!statusMessage) return;
    const timer = window.setTimeout(() => setStatusMessage(null), 5000);
    return () => window.clearTimeout(timer);
  }, [statusMessage]);

  function invalidateScoped() {
    void queryClient.invalidateQueries({ queryKey: userKeys.all });
    void queryClient.invalidateQueries({ queryKey: ['board'] });
    void queryClient.invalidateQueries({ queryKey: ['schedules'] });
  }

  const toggleMutation = useMutation({
    mutationFn: (user: AppUser) => updateUser(user.id, { isActive: !user.isActive }),
    onSuccess: (saved) => {
      invalidateScoped();
      setErrorMessage(null);
      setStatusMessage(saved.isActive ? '已启用成员「' + saved.name + '」' : '已停用成员「' + saved.name + '」，历史安排保留');
    },
    onError: (error) => setErrorMessage(getErrorMessage(error)),
  });

  const reorderMutation = useMutation({
    mutationFn: (ids: number[]) => reorderUsers(ids),
    onSuccess: (nextUsers) => {
      queryClient.setQueryData(userKeys.list(true), nextUsers);
      invalidateScoped();
      setErrorMessage(null);
    },
    onError: (error) => setErrorMessage(getErrorMessage(error)),
  });

  const deleteMutation = useMutation({
    mutationFn: (user: AppUser) => deleteUserPermanently(user.id),
    onSuccess: (_data, user) => {
      invalidateScoped();
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

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-base font-semibold tracking-tight text-ink">成员与个人表</h1>
            <Badge tone="neutral">{users.length} 位成员</Badge>
            {activeCount !== users.length ? <Badge tone="amber">{users.length - activeCount} 位停用</Badge> : null}
          </div>
          <p className="mt-0.5 text-xs text-muted">
            本组织已加入的成员（审批通过后自动建档）；点击「查看个人表」查看每人的时间安排。
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
            variant={manage ? 'soft' : 'secondary'}
            iconLeft={<ListChecks className="h-4 w-4" aria-hidden />}
            onClick={() => setManage((value) => !value)}
          >
            {manage ? '退出管理' : '管理成员'}
          </Button>
        </div>
      </header>

      {statusMessage ? (
        <Alert tone="success" action={<Button variant="ghost" size="sm" onClick={() => setStatusMessage(null)}>关闭</Button>}>
          {statusMessage}
        </Alert>
      ) : null}

      {errorMessage ? (
        <Alert tone="danger" title="操作失败" action={<Button variant="ghost" size="sm" onClick={() => setErrorMessage(null)}>关闭</Button>}>
          {errorMessage}
        </Alert>
      ) : null}

      {usersQuery.isPending ? (
        <ProfileSkeleton />
      ) : usersQuery.isError ? (
        <OrgRequiredNotice error={usersQuery.error} title="成员列表加载失败" />
      ) : users.length === 0 ? (
        <EmptyState
          icon={<UsersIcon className="h-5 w-5" aria-hidden />}
          title="还没有成员"
          description="成员在组织页申请加入并被审批通过后，会自动出现在这里。"
        />
      ) : (
        <Card className="overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-3 py-2.5 sm:px-4">
            <span className="text-2xs text-muted">
              {manage ? '管理模式：可调整顺序、启停与彻底删除；排序会同步到看板与导出。' : '点击成员可查看其个人表。'}
            </span>
            <span className="tabular text-2xs text-subtle">启用 {activeCount} / 共 {users.length}</span>
          </div>
          <div className="divide-y divide-line">
            {users.map((user, index) => (
              <MemberRow
                key={user.id}
                user={user}
                manage={manage}
                busy={busy}
                isFirst={index === 0}
                isLast={index === users.length - 1}
                onView={() => setViewTarget(user)}
                onEdit={() => setEditTarget(user)}
                onMoveUp={() => moveUser(index, -1)}
                onMoveDown={() => moveUser(index, 1)}
                onToggleActive={() => toggleMutation.mutate(user)}
                onDelete={() => setDeleteTarget(user)}
              />
            ))}
          </div>
          <div className="border-t border-line bg-canvas px-3 py-2 sm:px-4">
            <p className="text-2xs leading-5 text-subtle">
              停用是软删除：历史安排与统计保留；彻底删除不可恢复。新成员的姓名 / 颜色在其「我的资料」中维护。
            </p>
          </div>
        </Card>
      )}

      {viewTarget ? <MemberBoardDialog user={viewTarget} onClose={() => setViewTarget(null)} /> : null}

      {editTarget ? (
        <UserFormDialog
          mode="edit"
          user={editTarget}
          onClose={() => setEditTarget(null)}
          onSaved={(message) => {
            setEditTarget(null);
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
              <Button variant="danger" loading={deleteMutation.isPending} onClick={() => deleteMutation.mutate(deleteTarget)}>
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
              如果只是想暂时从看板移除，请在管理模式中点击「停用」；停用会保留历史安排，可随时重新启用。
            </p>
          </div>
        </Dialog>
      ) : null}
    </div>
  );
}

/** 成员/资料加载占位 */
function ProfileSkeleton() {
  return (
    <Card className="overflow-hidden">
      <div className="border-b border-line px-4 py-3">
        <Skeleton className="h-4 w-32" />
      </div>
      <div className="divide-y divide-line">
        {Array.from({ length: 4 }).map((_, index) => (
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
  );
}
