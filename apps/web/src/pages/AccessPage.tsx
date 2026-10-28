import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, RefreshCw, ShieldAlert, ShieldCheck, UserPlus } from 'lucide-react';
import type { AuthRole } from '../auth/api';
import { useSession } from '../auth/session';
import {
  addAccessAccount,
  authAccountKeys,
  fetchAccessAccounts,
  removeAccessAccount,
  setAccessAccountRole,
  type AccessAccount,
} from '../api/authAccounts';
import { AccountRow } from '../components/pages/access/AccountRow';
import { AddAccountForm } from '../components/pages/access/AddAccountForm';
import { Alert } from '../components/ui/Alert';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Dialog } from '../components/ui/Dialog';
import { EmptyState } from '../components/ui/EmptyState';
import { Skeleton } from '../components/ui/Skeleton';
import { getErrorMessage, getFieldErrors } from '../lib/errors';
import { ApiError } from '../api/client';

/** 访问授权：管理员维护可登录的邮箱名单（添加即授权） */
export default function AccessPage() {
  const { session, isAdmin } = useSession();
  const queryClient = useQueryClient();
  const currentEmail = session.email ?? '';

  const accountsQuery = useQuery({
    queryKey: authAccountKeys.list(),
    queryFn: ({ signal }) => fetchAccessAccounts(signal),
    enabled: isAdmin,
    staleTime: 15_000,
  });

  const accounts = useMemo<AccessAccount[]>(() => accountsQuery.data?.accounts ?? [], [accountsQuery.data]);
  const adminEmail = accountsQuery.data?.adminEmail ?? '';
  const adminCount = accounts.filter((account) => account.role === 'admin').length;

  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [pendingRole, setPendingRole] = useState<{ email: string; role: AuthRole } | null>(null);
  const [removeTarget, setRemoveTarget] = useState<AccessAccount | null>(null);

  useEffect(() => {
    if (!statusMessage) return;
    const timer = window.setTimeout(() => setStatusMessage(null), 5000);
    return () => window.clearTimeout(timer);
  }, [statusMessage]);

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: authAccountKeys.all });
  }

  const addMutation = useMutation({
    mutationFn: ({ email, role }: { email: string; role: AuthRole }) => addAccessAccount(email, role),
    onSuccess: (account) => {
      setFieldErrors({});
      setErrorMessage(null);
      setStatusMessage('已授权 ' + account.email + '（' + (account.role === 'admin' ? '管理员' : '成员') + '），该邮箱现在可以登录');
      invalidate();
    },
    onError: (error) => {
      const issues = getFieldErrors(error);
      // 服务端 422 的 path 为 email / role；字段错误展示在表单内，避免重复弹全局错误
      if (issues.email || issues.role) {
        setFieldErrors(issues.email ? { email: issues.email } : { role: issues.role });
      } else {
        setFieldErrors({});
      }
      if (error instanceof ApiError && error.status === 409) {
        setErrorMessage('该邮箱已在授权名单中，可直接修改其角色');
        return;
      }
      setErrorMessage(issues.email || issues.role ? null : getErrorMessage(error));
    },
  });

  const roleMutation = useMutation({
    mutationFn: ({ email, role }: { email: string; role: AuthRole }) => setAccessAccountRole(email, role),
    onSuccess: (account) => {
      setErrorMessage(null);
      setStatusMessage('已将 ' + account.email + ' 设为' + (account.role === 'admin' ? '管理员' : '成员'));
      invalidate();
    },
    onError: (error) => setErrorMessage(getErrorMessage(error)),
    onSettled: () => setPendingRole(null),
  });

  const removeMutation = useMutation({
    mutationFn: (email: string) => removeAccessAccount(email),
    onSuccess: (removed) => {
      setRemoveTarget(null);
      setErrorMessage(null);
      setStatusMessage('已移除 ' + removed + ' 的访问授权，其登录会话将在到期后失效');
      invalidate();
    },
    onError: (error) => setErrorMessage(getErrorMessage(error)),
  });

  const busy = addMutation.isPending || roleMutation.isPending || removeMutation.isPending;

  function handleAdd(email: string, role: AuthRole) {
    addMutation.mutate({ email, role });
  }

  function handleSetRole(account: AccessAccount, role: AuthRole) {
    if (busy) return;
    setPendingRole({ email: account.email, role });
    roleMutation.mutate({ email: account.email, role });
  }

  function handleRemove(account: AccessAccount) {
    if (busy) return;
    removeMutation.mutate(account.email);
  }

  if (!isAdmin) {
    return (
      <div className="flex flex-col gap-4">
        <header>
          <h1 className="text-base font-semibold tracking-tight text-ink">访问授权</h1>
          <p className="mt-0.5 text-xs text-muted">管理可以登录 FreeShift 的邮箱名单。</p>
        </header>
        <EmptyState
          icon={<ShieldAlert className="h-5 w-5" aria-hidden />}
          title="无权限访问"
          description="访问授权仅对管理员开放。如需管理登录名单，请联系团队管理员为你升级权限。"
          action={<Button variant="secondary" onClick={() => window.history.back()}>返回上一页</Button>}
        />
      </div>
    );
  }

  const selfAccount = accounts.find((account) => account.email.toLowerCase() === currentEmail.toLowerCase());
  const uniqueAdmin = adminCount <= 1;

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-base font-semibold tracking-tight text-ink">访问授权</h1>
            {accountsQuery.data ? <Badge tone="neutral">{accounts.length} 个授权邮箱</Badge> : null}
            {adminCount > 0 ? <Badge tone="brand">{adminCount} 位管理员</Badge> : null}
          </div>
          <p className="mt-0.5 max-w-2xl text-xs leading-5 text-muted">
            把邮箱加入名单即完成授权，等同于「注册并验证」：该邮箱无需注册，输入验证码即可登录。未授权的邮箱无法获取登录验证码。
          </p>
        </div>
        <Button
          variant="secondary"
          iconLeft={<RefreshCw className="h-4 w-4" aria-hidden />}
          aria-label="刷新授权名单"
          onClick={() => void accountsQuery.refetch()}
          disabled={accountsQuery.isFetching}
        >
          刷新
        </Button>
      </header>

      {statusMessage ? (
        <Alert
          tone="success"
          action={<Button variant="ghost" size="sm" onClick={() => setStatusMessage(null)}>关闭</Button>}
        >
          {statusMessage}
        </Alert>
      ) : null}

      {errorMessage ? (
        <Alert
          tone="danger"
          title="操作失败"
          action={<Button variant="ghost" size="sm" onClick={() => setErrorMessage(null)}>关闭</Button>}
        >
          {errorMessage}
        </Alert>
      ) : null}

      <Card className="overflow-hidden">
        <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
          <UserPlus className="h-4 w-4 text-subtle" aria-hidden />
          <h2 className="text-xs font-semibold text-ink">添加授权邮箱</h2>
        </div>
        <AddAccountForm
          adminEmail={adminEmail}
          submitting={addMutation.isPending}
          fieldErrors={fieldErrors}
          onSubmit={handleAdd}
          onDismissError={() => setFieldErrors({})}
        />
      </Card>

      {accountsQuery.isPending ? (
        <Card className="overflow-hidden">
          <div className="border-b border-line px-4 py-3">
            <Skeleton className="h-4 w-32" />
          </div>
          <div className="divide-y divide-line">
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className="flex items-center gap-3 px-4 py-3">
                <Skeleton className="h-9 w-9 rounded-full" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-3.5 w-48" />
                  <Skeleton className="h-3 w-56" />
                </div>
                <Skeleton className="h-8 w-24" />
              </div>
            ))}
          </div>
        </Card>
      ) : accountsQuery.isError ? (
        <Alert
          tone="danger"
          title="授权名单加载失败"
          action={<Button variant="secondary" size="sm" onClick={() => void accountsQuery.refetch()}>重试</Button>}
        >
          {getErrorMessage(accountsQuery.error)}
        </Alert>
      ) : accounts.length === 0 ? (
        <EmptyState
          icon={<KeyRound className="h-5 w-5" aria-hidden />}
          title="还没有授权邮箱"
          description="添加第一位可登录的成员邮箱。也可以在上方把任意邮箱设为管理员，以便分担名单维护工作。"
        />
      ) : (
        <Card className="overflow-hidden">
          <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
            <ShieldCheck className="h-4 w-4 text-subtle" aria-hidden />
            <h2 className="text-xs font-semibold text-ink">授权名单</h2>
            {adminEmail ? <span className="text-2xs text-subtle">管理员邮箱 {adminEmail}</span> : null}
          </div>
          <div className="divide-y divide-line">
            {accounts.map((account) => (
              <AccountRow
                key={account.email}
                account={account}
                isSelf={account.email.toLowerCase() === currentEmail.toLowerCase()}
                isLastAdmin={uniqueAdmin}
                busy={busy}
                pendingRole={pendingRole && pendingRole.email === account.email ? pendingRole.role : null}
                onSetRole={(role) => handleSetRole(account, role)}
                onRemove={() => setRemoveTarget(account)}
              />
            ))}
          </div>
          <div className="border-t border-line bg-canvas px-3 py-2 sm:px-4">
            <p className="text-2xs leading-5 text-subtle">
              移除后该邮箱无法再获取验证码登录；已登录的会话在到期前仍然有效。
              {selfAccount ? ' 管理员不能修改或移除自己的授权。' : ''}
            </p>
          </div>
        </Card>
      )}

      <Dialog
        open={removeTarget !== null}
        onClose={() => { if (!removeMutation.isPending) setRemoveTarget(null); }}
        size="sm"
        title="移除访问授权"
        footer={
          <div className="flex items-center justify-end gap-2">
            <Button variant="secondary" onClick={() => setRemoveTarget(null)} disabled={removeMutation.isPending}>
              取消
            </Button>
            <Button
              variant="danger"
              loading={removeMutation.isPending}
              onClick={() => { if (removeTarget) handleRemove(removeTarget); }}
            >
              确认移除
            </Button>
          </div>
        }
      >
        <div className="space-y-3">
          <Alert tone="danger" title="移除后将无法登录">
            移除后，<span className="font-medium">{removeTarget?.email ?? ''}</span> 将无法再获取登录验证码。
          </Alert>
          <p className="text-xs leading-5 text-muted">
            该账户的排班数据属于共享工作区，不会随之删除。如需恢复访问，重新添加同一邮箱即可。
          </p>
        </div>
      </Dialog>
    </div>
  );
}
