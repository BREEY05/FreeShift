import { Check, Copy, LogOut, Trash2, UserCheck, X } from 'lucide-react';
import { useState } from 'react';
import type { OrgInfo, OrgMember } from '../../../api/org';
import { cn } from '../../../lib/cn';
import { formatEpochDateTime } from '../access/format';
import { Alert } from '../../ui/Alert';
import { Badge } from '../../ui/Badge';
import { Button } from '../../ui/Button';
import { Card } from '../../ui/Card';
import { Tooltip } from '../../ui/Tooltip';

/** 复制到剪贴板，返回是否成功（降级到 execCommand 以兼容非 HTTPS 环境） */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // 忽略，走降级方案
  }
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}

interface CopyButtonProps {
  value: string;
  label: string;
  className?: string;
}

/** 带成功反馈的复制按钮 */
export function CopyButton({ value, label, className }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="secondary"
      size="sm"
      className={className}
      iconLeft={copied ? <Check className="h-3.5 w-3.5 text-mint" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
      onClick={async () => {
        const ok = await copyText(value);
        if (!ok) return;
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1800);
      }}
    >
      {copied ? '已复制' : label}
    </Button>
  );
}

interface OrgIdentityCardProps {
  org: OrgInfo;
  myRole: 'owner' | 'member';
  currentEmail: string | null;
  leaving: boolean;
  onLeave: () => void;
}

/** 组织身份卡：组织名 + 大号组织 ID + 邀请说明 + 退出入口 */
export function OrgIdentityCard({ org, myRole, currentEmail, leaving, onLeave }: OrgIdentityCardProps) {
  const isOwner = myRole === 'owner';
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-col gap-4 px-4 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-2xs font-medium uppercase tracking-[0.14em] text-subtle">当前组织</p>
            <h2 className="mt-1 break-words text-xl font-semibold tracking-tight text-ink">{org.name}</h2>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <Badge tone={isOwner ? 'brand' : 'neutral'}>
                <UserCheck className="h-3 w-3" aria-hidden />
                {isOwner ? '我是负责人' : '我是成员'}
              </Badge>
              {currentEmail ? <span className="text-2xs text-subtle">{currentEmail}</span> : null}
            </div>
          </div>
          {isOwner ? (
            <Tooltip label="负责人需先转让或解散组织才能退出">
              <span className="inline-flex cursor-not-allowed">
                <Button variant="ghost" size="sm" disabled iconLeft={<LogOut className="h-3.5 w-3.5" aria-hidden />}>
                  退出组织
                </Button>
              </span>
            </Tooltip>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              loading={leaving}
              iconLeft={<LogOut className="h-3.5 w-3.5" aria-hidden />}
              onClick={onLeave}
            >
              退出组织
            </Button>
          )}
        </div>

        <div className="rounded-control border border-line bg-canvas px-3 py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-2xs font-medium text-muted">组织 ID</p>
              <p className="tabular mt-0.5 break-all text-2xl font-semibold leading-8 tracking-[0.16em] text-ink">{org.code}</p>
            </div>
            <CopyButton value={org.code} label="复制组织 ID" />
          </div>
          <p className="mt-2 text-2xs leading-5 text-subtle">
            把这个组织 ID 发给同学，对方在「组织」页选择「按组织 ID 加入」提交申请，经负责人审批后即可进入同一份排期数据。
          </p>
        </div>
      </div>
    </Card>
  );
}

interface MemberListProps {
  members: OrgMember[];
  ownerEmail: string;
  currentEmail: string | null;
  busyEmail: string | null;
  onRemove: (member: OrgMember) => void;
}

/** 成员列表：负责人可移除他人 */
export function MemberList({ members, ownerEmail, currentEmail, busyEmail, onRemove }: MemberListProps) {
  const pending = members.filter((member) => member.status === 'pending').length;
  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-2.5">
        <h3 className="text-xs font-semibold text-ink">成员</h3>
        <div className="flex items-center gap-1.5">
          {pending > 0 ? <Badge tone="amber">{pending} 待审批</Badge> : null}
          <Badge tone="outline">{members.length} 人</Badge>
        </div>
      </div>
      {members.length === 0 ? (
        <p className="px-4 py-6 text-center text-xs text-subtle">暂无成员，分享组织 ID 邀请同学加入</p>
      ) : (
        <ul className="divide-y divide-line">
          {members.map((member) => {
            const isOwner = member.email === ownerEmail || member.role === 'owner';
            const isSelf = currentEmail !== null && member.email === currentEmail;
            return (
              <li key={member.email} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
                <div className="flex min-w-0 items-center gap-2">
                  <span
                    className={cn(
                      'flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-2xs font-semibold uppercase',
                      isOwner ? 'bg-brand-soft text-brand' : 'bg-canvas text-muted',
                    )}
                    aria-hidden
                  >
                    {member.email.slice(0, 1).toUpperCase()}
                  </span>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="truncate text-xs font-medium text-ink">{member.email}</span>
                      {isOwner ? <Badge tone="brand">负责人</Badge> : <Badge tone="neutral">成员</Badge>}
                      {isSelf ? <Badge tone="mint">我</Badge> : null}
                    </div>
                    <p className="mt-0.5 text-2xs text-subtle">加入于 {formatEpochDateTime(Date.parse(member.createdAt) || null)}</p>
                  </div>
                </div>
                {isOwner ? null : (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-danger hover:bg-red-50 hover:text-danger"
                    loading={busyEmail === member.email}
                    iconLeft={<Trash2 className="h-3.5 w-3.5" aria-hidden />}
                    onClick={() => onRemove(member)}
                  >
                    移除
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

interface JoinRequestListProps {
  requests: OrgMember[];
  busyEmail: string | null;
  onApprove: (member: OrgMember) => void;
  onReject: (member: OrgMember) => void;
}

/** 待审批申请：仅负责人可见 */
export function JoinRequestList({ requests, busyEmail, onApprove, onReject }: JoinRequestListProps) {
  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-2.5">
        <h3 className="text-xs font-semibold text-ink">待审批申请</h3>
        <Badge tone={requests.length > 0 ? 'amber' : 'outline'}>{requests.length} 条</Badge>
      </div>
      {requests.length === 0 ? (
        <p className="px-4 py-6 text-center text-xs text-subtle">暂无待审批申请</p>
      ) : (
        <ul className="divide-y divide-line">
          {requests.map((request) => (
            <li key={request.email} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
              <div className="min-w-0">
                <p className="truncate text-xs font-medium text-ink">{request.email}</p>
                <p className="mt-0.5 text-2xs text-subtle">申请于 {formatEpochDateTime(Date.parse(request.createdAt) || null)}</p>
              </div>
              <div className="flex items-center gap-1.5">
                <Button
                  variant="ghost"
                  size="sm"
                  loading={busyEmail === request.email}
                  iconLeft={<X className="h-3.5 w-3.5" aria-hidden />}
                  onClick={() => onReject(request)}
                >
                  拒绝
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  loading={busyEmail === request.email}
                  iconLeft={<Check className="h-3.5 w-3.5" aria-hidden />}
                  onClick={() => onApprove(request)}
                >
                  通过
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <div className="border-t border-line px-4 py-2.5">
        <Alert tone="info" title="审批说明">
          通过后对方立刻获得组织内数据的读写权限；拒绝不会通知对方，但对方可以再次申请。
        </Alert>
      </div>
    </Card>
  );
}
