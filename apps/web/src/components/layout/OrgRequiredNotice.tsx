import { Building2, Clock3, Info } from 'lucide-react';
import { Link } from 'react-router-dom';
import { ApiError } from '../../api/client';
import { getErrorMessage } from '../../lib/errors';
import { Button } from '../ui/Button';
import { EmptyState } from '../ui/EmptyState';

/** 未加入任何组织：后端 404 NO_ORG（message「你还没有加入任何组织」） */
export function isNoOrgError(error: unknown): boolean {
  if (error instanceof ApiError) {
    return error.code === 'NO_ORG' || error.message.includes('还没有加入任何组织');
  }
  return error instanceof Error && error.message.includes('还没有加入任何组织');
}

/** 加入申请待审批：后端 403 PENDING_APPROVAL（message「加入申请待审批」） */
export function isPendingApprovalError(error: unknown): boolean {
  if (error instanceof ApiError) {
    return error.code === 'PENDING_APPROVAL' || error.message.includes('待审批');
  }
  return error instanceof Error && error.message.includes('待审批');
}

export interface OrgRequiredNoticeProps {
  error: unknown;
  title?: string;
}

/**
 * 无组织 / 待审批空态（契约 v3，A 组提供，B/C 组复用；签名固定）。
 * 识别 NO_ORG / PENDING_APPROVAL 并引导去 /org；其它错误按通用错误展示。
 */
export function OrgRequiredNotice({ error, title }: OrgRequiredNoticeProps) {
  if (error === null || error === undefined) return null;

  const noOrg = isNoOrgError(error);
  const pending = !noOrg && isPendingApprovalError(error);
  const heading = title ?? (pending ? '加入申请待审批' : noOrg ? '还没有加入任何组织' : '组织信息加载失败');
  const description = pending
    ? '你的加入申请正在等待管理员审批，通过后即可使用个人表与组织模板。'
    : noOrg
      ? '先在组织页搜索或创建组织并加入，之后即可使用个人表、模板与成员列表。'
      : getErrorMessage(error);
  const icon = pending ? <Clock3 className="h-5 w-5" aria-hidden /> : noOrg ? <Building2 className="h-5 w-5" aria-hidden /> : <Info className="h-5 w-5" aria-hidden />;

  return (
    <EmptyState
      icon={icon}
      title={heading}
      description={description}
      action={
        <Link to="/org">
          <Button variant="primary">去组织页</Button>
        </Link>
      }
    />
  );
}
