import { useState } from 'react';
import type { AppUser } from '@freeshift/shared';
import { useSemester } from '../../../hooks/useSemester';
import { Dialog } from '../../ui/Dialog';
import { WeekSwitcher } from '../../schedule/WeekSwitcher';
import { PersonalBoardPanel } from '../dashboard/PersonalBoardPanel';

export interface MemberBoardDialogProps {
  user: AppUser;
  onClose: () => void;
}

/** 管理员查看某成员的个人表：周次切换 + 只读网格（fetchPersonalBoard(成员 id)） */
export function MemberBoardDialog({ user, onClose }: MemberBoardDialogProps) {
  const semesterQuery = useSemester();
  const weeks = semesterQuery.data?.weeks ?? [];
  const [week, setWeek] = useState<number | null>(null);
  const displayWeek = week === null ? weeks.find((item) => item.isCurrent) : weeks.find((item) => item.weekNo === week);

  return (
    <Dialog
      open
      onClose={onClose}
      size="lg"
      title={'成员个人表 · ' + user.name}
      description={user.email ? '登录邮箱：' + user.email : '历史成员（无登录邮箱）'}
      footer={
        <div className="flex justify-end">
          <button type="button" className="text-xs text-muted hover:text-ink" onClick={onClose}>
            关闭
          </button>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <WeekSwitcher week={displayWeek} weeks={weeks} onChange={setWeek} disabled={semesterQuery.isPending} />
        <PersonalBoardPanel userId={user.id} week={displayWeek?.weekNo ?? week} />
      </div>
    </Dialog>
  );
}
