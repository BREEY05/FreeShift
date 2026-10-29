import { all, get, run, transaction, type SqlValue } from '../db/index.ts';
import { defaultOrgId } from './context.ts';

export interface ResetResult {
  deletedSchedules: number;
  deletedUsers: number;
}

function countOf(sql: string, params: readonly SqlValue[] = []): number {
  return Number(get<{ n: number }>(sql, params)?.n ?? 0);
}

/**
 * 重置当前组织的数据：清空该组织的 schedule / schedule_occurrence / app_user。
 * - organization 与 org_member（成员与授权）保持不变，auth_account / algo_config 也不受影响；
 * - 只删本组织数据：schedule / schedule_occurrence 都通过 semester.org_id 归属，
 *   同一事务内先删 occurrence（FK 指向 schedule / app_user），再删 schedule，最后删 app_user；
 * - 返回被删除的 schedule 条数与用户条数。
 */
export function resetOrgData(orgId?: number): ResetResult {
  const org = orgId ?? defaultOrgId();
  return transaction(() => {
    const deletedSchedules = countOf(
      `SELECT COUNT(*) AS n FROM schedule s
         JOIN semester sem ON sem.id = s.semester_id
        WHERE sem.org_id = ?`,
      [org],
    );
    const deletedUsers = countOf('SELECT COUNT(*) AS n FROM app_user WHERE org_id = ?', [org]);

    const semesterIds = all<{ id: number }>('SELECT id FROM semester WHERE org_id = ?', [org]).map((row) =>
      Number(row.id),
    );
    if (semesterIds.length > 0) {
      const marks = semesterIds.map(() => '?').join(', ');
      run('DELETE FROM schedule_occurrence WHERE semester_id IN (' + marks + ')', semesterIds);
      run('DELETE FROM schedule WHERE semester_id IN (' + marks + ')', semesterIds);
    }
    run('DELETE FROM app_user WHERE org_id = ?', [org]);

    return { deletedSchedules, deletedUsers };
  });
}
