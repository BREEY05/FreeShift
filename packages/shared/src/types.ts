export type Weekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;
export type Parity = 'all' | 'odd' | 'even';
export type WeekParity = 'odd' | 'even';
export type DayPart = 'morning' | 'afternoon' | 'evening';

export interface Semester {
  id: number;
  name: string;
  /** 第 1 周周一，YYYY-MM-DD */
  startDate: string;
  totalWeeks: number;
  week1Parity: WeekParity;
  activeTemplateId: number | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SemesterOverview {
  semester: Semester;
  weeks: WeekInfo[];
}

export interface WeekInfo {
  weekNo: number;
  parity: WeekParity;
  startDate: string;
  endDate: string;
  isCurrent: boolean;
}

export interface SlotTemplate {
  id: number;
  name: string;
  description: string;
  isPreset: boolean;
  slotCount: number;
  isActive: boolean;
  createdAt: string;
}

export interface TimeSlot {
  id: number;
  templateId: number;
  label: string;
  startTime: string | null;
  endTime: string | null;
  dayPart: DayPart;
  durationMin: number;
  sortOrder: number;
}

export interface AppUser {
  id: number;
  name: string;
  color: string;
  note: string;
  isActive: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface Schedule {
  id: number;
  semesterId: number;
  userId: number;
  weekday: Weekday;
  slotId: number;
  startWeek: number;
  endWeek: number;
  parity: Parity;
  note: string;
  createdAt: string;
  updatedAt: string;
}

export interface ConflictDetail {
  weekNo: number;
  weekday: Weekday;
  slotId: number;
  slotLabel: string;
  scheduleId: number;
  startWeek: number;
  endWeek: number;
  parity: Parity;
  note: string;
}

export interface BoardCell {
  weekday: Weekday;
  slotId: number;
  freeCount: number;
  totalUsers: number;
  freeUserIds: number[];
  occupiedUserIds: number[];
}

export interface AggregateBoard {
  week: WeekInfo;
  semester: Semester;
  slots: TimeSlot[];
  users: AppUser[];
  cells: BoardCell[];
}

export interface CellDetail {
  week: WeekInfo;
  weekday: Weekday;
  slot: TimeSlot;
  freeUsers: AppUser[];
  occupiedUsers: AppUser[];
}

export interface PersonalCell {
  weekday: Weekday;
  slotId: number;
  scheduleId: number | null;
  note: string;
}

export interface PersonalBoard {
  week: WeekInfo;
  semester: Semester;
  user: AppUser;
  slots: TimeSlot[];
  cells: PersonalCell[];
}

export interface FreeBlock {
  weekday: Weekday;
  slotIds: number[];
  labels: string[];
  startTime: string | null;
  endTime: string | null;
  /** 连续格子数量 */
  length: number;
  durationMin: number;
}

export type FactorKey = 'freeRatio' | 'continuity' | 'history' | 'friendliness' | 'recentLoad';
export type FactorScores = Record<FactorKey, number>;

export interface ScoredCell {
  weekday: Weekday;
  slotId: number;
  slotLabel: string;
  startTime: string | null;
  endTime: string | null;
  score: number;
  freeCount: number;
  totalUsers: number;
  blockLength: number;
  factors: FactorScores;
  reasons: string[];
}

export interface AlternativeCell {
  weekday: Weekday;
  slotId: number;
  slotLabel: string;
  occupiedUsers: number;
  freeUsers: number;
  score: number;
}

export interface AlternativesResult {
  cells: AlternativeCell[];
  source: {
    weekday: Weekday;
    slotId: number;
    occupiedUsers: number;
    freeUsers: number;
  };
}

export interface FairnessUser {
  userId: number;
  name: string;
  color: string;
  occupiedCells: number;
  occupiedMinutes: number;
  maxContiguousMinutes: number;
}

export interface FairnessReport {
  fromWeek: number;
  toWeek: number;
  users: FairnessUser[];
  gini: number;
  variance: number;
  mean: number;
  hints: string[];
}

export interface RecommendConfig {
  weights: FactorScores;
  dayPart: Record<DayPart, number>;
  historyWeeks: number;
  recentWindow: number;
}

export interface ImportResult {
  created: number;
  skipped: number;
  errors: { row: number; message: string }[];
}

export interface HealthInfo {
  status: 'ok';
  db: 'ok';
  version: string;
}

export interface ApiMeta {
  total: number;
}

export interface SemesterInput {
  name: string;
  startDate: string;
  totalWeeks: number;
  week1Parity?: WeekParity;
}

export interface TemplateInput {
  name: string;
  description?: string;
  cloneFrom?: number;
}

export interface SlotInput {
  label: string;
  startTime?: string | null;
  endTime?: string | null;
  dayPart?: DayPart;
  durationMin?: number;
  sortOrder?: number;
}

export interface SlotReorderInput {
  order: number[];
}

export interface UserInput {
  name: string;
  color?: string;
  note?: string;
  isActive?: boolean;
}

export interface ScheduleInput {
  userId: number;
  weekday: Weekday;
  slotId: number;
  startWeek: number;
  endWeek: number;
  parity?: Parity;
  note?: string;
}

export interface BatchCellInput {
  weekday: Weekday;
  slotIds: number[];
}

export interface BatchScheduleInput {
  userId: number;
  cells: BatchCellInput[];
  weeks: { start: number; end: number; parity: Parity };
  mode?: 'strict' | 'skip';
  note?: string;
}

export interface BatchScheduleResult {
  created: number;
  skipped: number;
  schedules: Schedule[];
  conflicts: ConflictDetail[];
}

export interface ConflictCheckInput {
  userId: number;
  weekday: Weekday;
  slotIds: number[];
  startWeek: number;
  endWeek: number;
  parity: Parity;
  excludeScheduleId?: number;
}

export interface CommonFreeInput {
  week?: number;
  userIds: number[];
  topK?: number;
  /** 是否要求相邻格子时间连续（默认 true，无时间信息时退化为顺序相邻） */
  requireTimeAdjacent?: boolean;
}

export interface ScoredInput {
  week?: number;
  userIds?: number[];
  filters?: {
    dayParts?: DayPart[];
    weekdays?: Weekday[];
    allFreeOnly?: boolean;
    minFreeRatio?: number;
  };
  weights?: Partial<FactorScores>;
  topK?: number;
  /** 用于历史偏好与近期负载的视角用户；缺省使用 userIds 全员 */
  perspectiveUserId?: number;
}

export interface AlternativesInput {
  userId: number;
  weekday: Weekday;
  slotId: number;
  startWeek: number;
  endWeek: number;
  parity: Parity;
  topK?: number;
}

export interface BoardQuery {
  week?: number;
  userIds?: number[];
  dayParts?: DayPart[];
  filter?: 'all' | 'full_free' | 'partial';
}