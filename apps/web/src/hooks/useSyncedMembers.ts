import { useCallback, useEffect, useState } from 'react';

/** 同步成员选择的本地持久化键：存的是成员 id 数组 */
export const SYNCED_MEMBERS_STORAGE_KEY = 'freeshift:synced-members';

function readStored(): number[] | null {
  try {
    const raw = window.localStorage.getItem(SYNCED_MEMBERS_STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed.filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  } catch {
    return null;
  }
}

function writeStored(ids: number[] | null) {
  try {
    if (ids === null) window.localStorage.removeItem(SYNCED_MEMBERS_STORAGE_KEY);
    else window.localStorage.setItem(SYNCED_MEMBERS_STORAGE_KEY, JSON.stringify(ids));
  } catch {
    // localStorage 不可用时忽略（隐私模式等）
  }
}

export interface UseSyncedMembersResult {
  /** null = 未启用同步（展示全部成员） */
  syncedIds: number[] | null;
  /** 当前生效的成员 id 列表：未启用同步时为 null，交给聚合接口展示全部成员 */
  userIds: number[] | null;
  /** 保存选择；传 null 清除同步 */
  setSyncedIds: (ids: number[] | null) => void;
}

/**
 * 看板「同步成员」选择：只把选中的成员传给聚合接口（user_ids），并持久化到 localStorage。
 * 空数组等同于未启用同步，避免出现「一个成员都不选」的空看板。
 */
export function useSyncedMembers(): UseSyncedMembersResult {
  const [syncedIds, setState] = useState<number[] | null>(() => {
    const stored = readStored();
    return stored && stored.length > 0 ? stored : null;
  });

  useEffect(() => {
    writeStored(syncedIds);
  }, [syncedIds]);

  const setSyncedIds = useCallback((ids: number[] | null) => {
    setState(ids && ids.length > 0 ? Array.from(new Set(ids)) : null);
  }, []);

  return { syncedIds, userIds: syncedIds, setSyncedIds };
}
