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
  /** 个人表的拥有者邮箱；NULL = 组织共享 / 内置预设 */
  ownerEmail: string | null;
  /** 是否是当前登录用户自己的表 */
  isMine: boolean;
  /** 是否是当前组织的组织模板 */
  isOrgTemplate: boolean;
  /** 是否与组织模板属于同一时间类型（成员可选作个人表） */
  sameTypeAsOrg: boolean;
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
  /** 登录邮箱；历史遗留用户可能为 null */
  email: string | null;
  /** 该成员的当前个人表模板 id */
  templateId: number | null;
  templateName: string | null;
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

export interface OrgInfo {
  id: number;
  name: string;
  code: string;
  ownerEmail: string;
  createdAt: string;
  templateId: number | null;
  templateName: string | null;
}

export type OrgRole = 'owner' | 'member';
export type OrgMemberStatus = 'pending' | 'approved';

export interface OrgMember {
  orgId: number;
  email: string;
  role: OrgRole;
  status: OrgMemberStatus;
  createdAt: string;
  /** 该成员当前个人表模板名（未建表为 null） */
  tableName: string | null;
}

export interface OrgSnapshot {
  org: OrgInfo;
  members: OrgMember[];
  requests: OrgMember[];
}

export interface OrgMineItem {
  org: OrgInfo;
  role: OrgRole;
}

export interface OrgSearchItem extends OrgInfo {
  memberCount: number;
  /** 当前登录用户与该组织的关系 */
  myStatus: OrgRole | 'approved' | 'pending' | null;
}

export interface OrgPreset {
  name: string;
  description: string;
  slotCount: number;
}

export interface OrgCreateInput {
  name: string;
  presetName: string;
}

export interface OrgJoinInput {
  orgId?: number;
  code?: string;
}

export interface OrgJoinResult {
  org: OrgInfo;
  status: OrgMemberStatus;
}

/** GET /users/me：本人资料 + 个人表时间段 */
export interface MyProfile {
  user: AppUser;
  slots: TimeSlot[];
}

export interface LoginInput {
  email: string;
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