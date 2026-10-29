import { Building2, Loader2, Users } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useOrg, useOrgMutations } from '../hooks/useOrg';
import { useSession } from '../auth/session';
import { CreateOrgForm, JoinOrgForm } from '../components/pages/org/OrgForms';
import { JoinRequestList, MemberList, OrgIdentityCard } from '../components/pages/org/OrgPanels';
import { Alert } from '../components/ui/Alert';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Dialog } from '../components/ui/Dialog';
import { EmptyState } from '../components/ui/EmptyState';
import { Skeleton } from '../components/ui/Skeleton';
import { getErrorMessage } from '../lib/errors';
import type { OrgMember } from '../api/org';

/** 组织：创建/加入组织，查看组织 ID 与成员，负责人审批申请 */
export default function OrgPage() {
  const { session } = useSession();
  const orgQuery = useOrg();
  const { createMutation, joinMutation, approveMutation, rejectMutation, removeMutation, leaveMutation } = useOrgMutations();
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmMember, setConfirmMember] = useState<OrgMember | null>(null);
  const [confirmLeave, setConfirmLeave] = useState(false);

  useEffect(() => {
    if (!statusMessage) return;
    const timer = window.setTimeout(() => setStatusMessage(null), 5000);
    return () => window.clearTimeout(timer);
  }, [statusMessage]);

  const snapshot = orgQuery.data;
  const org = snapshot && snapshot.org ? snapshot.org : null;
  const isOwner = Boolean(org && session.email && org.ownerEmail === session.email);
  const myMember = snapshot?.members.find((member) => member.email === session.email);
  const pendingApproval = orgQuery.isError && getErrorMessage(orgQuery.error).includes('待审批');

  function run(action: () => void) {
    setActionError(null);
    action();
  }

  if (orgQuery.isPending) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-12 w-64" />
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-base font-semibold tracking-tight text-ink">组织</h1>
            {org ? <span className="text-2xs text-subtle">{org.name}</span> : null}
          </div>
          <p className="mt-0.5 text-xs text-muted">同一组织的成员共享看板、时间段模板与推荐数据。</p>
        </div>
        <Button
          variant="secondary"
          iconLeft={<Users className="h-4 w-4" aria-hidden />}
          onClick={() => void orgQuery.refetch()}
          disabled={orgQuery.isFetching}
        >
          刷新
        </Button>
      </header>

      {statusMessage ? <Alert tone="success" action={<Button variant="ghost" size="sm" onClick={() => setStatusMessage(null)}>关闭</Button>}>{statusMessage}</Alert> : null}
      {actionError ? <Alert tone="danger" title="操作失败" action={<Button variant="ghost" size="sm" onClick={() => setActionError(null)}>关闭</Button>}>{actionError}</Alert> : null}

      {org && myMember ? (
        <div className="flex flex-col gap-4">
          <OrgIdentityCard
            org={org}
            myRole={myMember.role}
            currentEmail={session.email}
            leaving={leaveMutation.isPending}
            onLeave={() => setConfirmLeave(true)}
          />
          <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-2">
            <MemberList
              members={snapshot?.members ?? []}
              ownerEmail={org.ownerEmail}
              currentEmail={session.email}
              busyEmail={removeMutation.isPending ? (removeMutation.variables ?? null) : null}
              onRemove={(member) => setConfirmMember(member)}
            />
            {isOwner ? (
              <JoinRequestList
                requests={snapshot?.requests ?? []}
                busyEmail={approveMutation.isPending ? (approveMutation.variables ?? null) : rejectMutation.isPending ? (rejectMutation.variables ?? null) : null}
                onApprove={(member) =>
                  run(() =>
                    approveMutation.mutate(member.email, {
                      onSuccess: () => setStatusMessage(`已通过 ${member.email} 的加入申请`),
                      onError: (error) => setActionError(getErrorMessage(error)),
                    }),
                  )
                }
                onReject={(member) =>
                  run(() =>
                    rejectMutation.mutate(member.email, {
                      onSuccess: () => setStatusMessage(`已拒绝 ${member.email} 的加入申请`),
                      onError: (error) => setActionError(getErrorMessage(error)),
                    }),
                  )
                }
              />
            ) : null}
          </div>
        </div>
      ) : orgQuery.isError && !pendingApproval ? (
        <EmptyState
          icon={<Building2 className="h-5 w-5" aria-hidden />}
          title="组织信息加载失败"
          description={getErrorMessage(orgQuery.error)}
          action={<Button variant="secondary" onClick={() => void orgQuery.refetch()}>重试</Button>}
        />
      ) : (
        <div className="flex flex-col gap-4">
          {pendingApproval ? <Alert tone="warning" title="加入申请待审批">你已提交加入申请，负责人审批通过后即可访问组织数据。审批期间可以重新发起或联系负责人。</Alert> : null}
          <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-2">
            <Card className="overflow-hidden">
              <div className="flex items-center gap-2 border-b border-line px-4 py-3">
                <Building2 className="h-4 w-4 text-brand" aria-hidden />
                <h2 className="text-xs font-semibold text-ink">创建组织</h2>
              </div>
              <CreateOrgForm
                submitting={createMutation.isPending}
                error={createMutation.isError ? getErrorMessage(createMutation.error) : null}
                onSubmit={(name) =>
                  run(() =>
                    createMutation.mutate(name, {
                      onSuccess: () => setStatusMessage(`已创建组织「${name}」，你已成为负责人`),
                      onError: (error) => setActionError(getErrorMessage(error)),
                    }),
                  )
                }
              />
            </Card>
            <Card className="overflow-hidden">
              <div className="flex items-center gap-2 border-b border-line px-4 py-3">
                <Loader2 className="h-4 w-4 text-brand" aria-hidden />
                <h2 className="text-xs font-semibold text-ink">按组织 ID 加入</h2>
              </div>
              <JoinOrgForm
                submitting={joinMutation.isPending}
                error={joinMutation.isError ? getErrorMessage(joinMutation.error) : null}
                onSubmit={(code) =>
                  run(() =>
                    joinMutation.mutate(code, {
                      onSuccess: (result) =>
                        setStatusMessage(result.status === 'approved' ? '已加入组织' : '申请已提交，等待负责人审批'),
                      onError: (error) => setActionError(getErrorMessage(error)),
                    }),
                  )
                }
              />
            </Card>
          </div>
        </div>
      )}

      <Dialog
        open={confirmMember !== null}
        onClose={() => setConfirmMember(null)}
        size="sm"
        title="移除成员？"
        description="该成员将失去对组织数据的访问权限。"
        footer={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button variant="ghost" onClick={() => setConfirmMember(null)}>取消</Button>
            <Button
              variant="danger"
              loading={removeMutation.isPending}
              onClick={() => {
                const target = confirmMember;
                if (!target) return;
                removeMutation.mutate(target.email, {
                  onSuccess: () => {
                    setStatusMessage(`已移除 ${target.email}`);
                    setConfirmMember(null);
                  },
                  onError: (error) => {
                    setActionError(getErrorMessage(error));
                    setConfirmMember(null);
                  },
                });
              }}
            >
              移除
            </Button>
          </div>
        }
      >
        <p className="text-xs leading-5 text-muted">{confirmMember ? confirmMember.email : ''} 将立即失去组织内看板、推荐与统计的访问权限。</p>
      </Dialog>

      <Dialog
        open={confirmLeave}
        onClose={() => setConfirmLeave(false)}
        size="sm"
        title="退出组织？"
        description="退出后可重新申请加入。"
        footer={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button variant="ghost" onClick={() => setConfirmLeave(false)}>取消</Button>
            <Button
              variant="danger"
              loading={leaveMutation.isPending}
              onClick={() =>
                leaveMutation.mutate(undefined, {
                  onSuccess: () => {
                    setConfirmLeave(false);
                    setStatusMessage('已退出组织');
                  },
                  onError: (error) => {
                    setConfirmLeave(false);
                    setActionError(getErrorMessage(error));
                  },
                })
              }
            >
              退出
            </Button>
          </div>
        }
      >
        <p className="text-xs leading-5 text-muted">退出后你将无法查看该组织的看板与数据，需要重新申请并通过审批才能再次加入。</p>
      </Dialog>
    </div>
  );
}
