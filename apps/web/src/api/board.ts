import type { AggregateBoard, CellDetail, DayPart, PersonalBoard, Weekday } from '@freeshift/shared';
import { api } from './client';

export interface AggregateQuery {
  week?: number;
  userIds?: number[];
  dayParts?: DayPart[];
  filter?: 'all' | 'full_free' | 'partial';
}

/** GET /board/aggregate：一次拿到整周网格 */
export function fetchAggregateBoard(query: AggregateQuery = {}): Promise<AggregateBoard> {
  return api.get<AggregateBoard>('/board/aggregate', {
    week: query.week,
    user_ids: query.userIds,
    day_parts: query.dayParts,
    filter: query.filter,
  });
}

export interface CellDetailQuery {
  week?: number;
  weekday: Weekday;
  slotId: number;
}

/** GET /board/cell：单个格子的空闲/占用名单 */
export function fetchCellDetail(query: CellDetailQuery): Promise<CellDetail> {
  return api.get<CellDetail>('/board/cell', {
    week: query.week,
    weekday: query.weekday,
    slot_id: query.slotId,
  });
}

/** GET /board/user/:id：个人视图 */
export function fetchPersonalBoard(userId: number, week?: number): Promise<PersonalBoard> {
  return api.get<PersonalBoard>('/board/user/' + userId, { week });
}
