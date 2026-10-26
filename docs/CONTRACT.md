# FreeShift API 契约（实现对照版）

> 本文件是前后端并行开发的唯一契约。类型以 packages/shared/src/types.ts 为准，本文件描述路由、参数与返回负载。
> 基础路径 /api/v1。成功统一返回 { data: 负载 }；失败返回 4xx/5xx + { error: { code, message, details? } }。
> 列表型查询参数用逗号分隔：user_ids=1,2,5、day_parts=morning,evening、weekdays=1,3,5。
> 未传 week 时使用“当前周”（服务端 Asia/Shanghai 计算，超出学期范围时取第 1 周）。
> 除 /healthz、/meta、CSV 导出外，全部走 { data } 包裹。

## 学期

| 方法与路径 | 请求 | data 负载 |
| --- | --- | --- |
| GET /semester | – | SemesterOverview { semester, weeks[] } |
| GET /semester/weeks | – | { weeks: WeekInfo[] } |
| PUT /semester | SemesterInput 部分字段（name, startDate, totalWeeks, week1Parity） | SemesterOverview（若周设置变化，事务内重建该学期全部 occurrence） |
| POST /semester | SemesterInput + activeTemplateId? | SemesterOverview（新学期的，自动置为启用） |

## 模板与时间段

| 方法与路径 | 请求 | data 负载 |
| --- | --- | --- |
| GET /templates | – | { templates: SlotTemplate[] }（含 slotCount、isActive） |
| GET /templates/:id | – | { template, slots: TimeSlot[] } |
| POST /templates | TemplateInput { name, description?, cloneFrom? } | { template, slots } |
| PATCH /templates/:id | { name?, description? } | { template, slots }（预设模板只读，409） |
| DELETE /templates/:id | – | 204（预设 / 启用中 / 有安排时 409） |
| POST /templates/:id/activate | { force?: boolean } | SemesterOverview；旧模板有安排且未 force 时 409 TEMPLATE_IN_USE，details { scheduleCount } |
| PUT /templates/:id/slots | { slots: SlotInput[] } 全量替换 | { slots }；模板已有安排时 409 SLOT_IN_USE |
| POST /templates/:id/slots | SlotInput | { slot } |
| PATCH /slots/:id | SlotInput 部分字段 | { slot } |
| DELETE /slots/:id | – | 204；被安排引用时 409 |

SlotInput：label 必填；startTime/endTime HH:MM 可空；dayPart 缺省按开始时间推断（<12 上午，<18 下午，其余晚上）；durationMin 缺省按起止时间计算，否则 90；sortOrder 缺省追加到末尾。

## 用户

| 方法与路径 | 请求 | data 负载 |
| --- | --- | --- |
| GET /users | include_inactive=1 | { users: AppUser[] }（按 sortOrder） |
| GET /users/:id | – | { user } |
| POST /users | UserInput | 201 { user } |
| PATCH /users/:id | UserInput 部分字段 | { user } |
| DELETE /users/:id | hard=1 时彻底删除（级联安排） | 204；默认软删除（is_active=0） |
| PUT /users/order | { ids: number[] } | { users } 重排后的完整列表 |

## 安排与冲突

| 方法与路径 | 请求 | data 负载 |
| --- | --- | --- |
| GET /schedules | user_id?, from_week?, to_week?, weekday? | { schedules: Schedule[] } |
| GET /schedules/:id | – | { schedule } |
| POST /schedules | ScheduleInput | 201 { schedule }；冲突时 409 SCHEDULE_CONFLICT，details = ConflictDetail[] |
| POST /schedules/batch | BatchScheduleInput | BatchScheduleResult { created, skipped, schedules, conflicts } |
| POST /schedules/check | ConflictCheckInput | { conflicts: ConflictDetail[] }（不写库） |
| PATCH /schedules/:id | ScheduleInput 部分字段（可改区间/单双周/格子/备注） | { schedule }；冲突 409 |
| DELETE /schedules/:id | – | 204 |

冲突定义：同一用户、同一学期、同一 week_no + weekday + slot_id 已有占用。
strict 模式（默认）任一冲突整体 409、不落库；skip 模式跳过存在冲突的整条（weekday, slot）格，其余保存并在 conflicts 中返回明细。
批量 cells 与 weeks 做笛卡尔积；同一请求内重复格子去重。created 为新建 schedule 条数。

## 看板

| 方法与路径 | 请求 | data 负载 |
| --- | --- | --- |
| GET /board/aggregate | week?, user_ids?, day_parts?, filter=all/full_free/partial | AggregateBoard { week, semester, slots, users, cells } |
| GET /board/cell | week?, weekday, slot_id | CellDetail { week, weekday, slot, freeUsers, occupiedUsers } |
| GET /board/user/:id | week? | PersonalBoard { week, semester, user, slots, cells } |
| GET /board/user/:id/schedules | from_week?, to_week? | { schedules } |

cells 始终返回完整网格；filter 仅裁剪 cells。user_ids 参与计算时，total_users 为该子集人数。
PersonalBoard.cells：{ weekday, slotId, scheduleId|null, note }，占用时 scheduleId 指向可编辑的 schedule。

## 推荐与统计

| 方法与路径 | 请求 | data 负载 |
| --- | --- | --- |
| POST /recommend/common-free | CommonFreeInput { week?, userIds[], topK?, requireTimeAdjacent? } | { blocks: FreeBlock[] } |
| POST /recommend/scored | ScoredInput | { cells: ScoredCell[] } |
| POST /recommend/alternatives | AlternativesInput | AlternativesResult { cells, source } |
| GET /recommend/config | – | RecommendConfig |
| PUT /recommend/config | RecommendConfig 部分字段 | RecommendConfig（权重自动归一化存储） |
| GET /stats/fairness | from_week?, to_week? | FairnessReport |

## 数据导入导出

| 方法与路径 | 请求 | data / 响应 |
| --- | --- | --- |
| GET /export/schedules | from_week?, to_week? | text/csv 附件（UTF-8 BOM），表头 user,weekday,slot_label,start_week,end_week,parity,note |
| GET /export/board | week? | text/csv 附件，首列时间段，周一到周日；格子内容“空闲 3/5” |
| POST /import/schedules | Content-Type text/csv，原始 CSV 文本；dry_run=1 只校验 | ImportResult { created, skipped, errors[{row,message}] } |
| GET /healthz | – | { status, db, version }（不包裹 data） |
| GET /meta | – | { data: { version, db, timezone } } |

导入规则：按 user 名匹配用户、按当前启用模板的 label 匹配时间段；weekday 1-7；start_week <= end_week；parity ∈ all/odd/even；无法解析的行计入 errors 且不中断；dry_run 不写库。

## 文件归属（并行开发互不越界）

- Lead：根配置、packages/shared、apps/server/src/app.ts、index.ts、db/*、lib/*、services/context.ts、services/occurrence.ts、deploy/*、docs/*、README、apps/web 的构建配置与 index.css、main.tsx、api/client.ts。
- 后端核心：routes/{semester,templates,slots,users,schedules}.ts、services/{scheduleService,conflictService,templateService,userService}.ts、test/ 下相关测试。
- 后端算法：routes/{board,recommend,stats,data}.ts、services/{aggregateService,recommendService,fairnessService,csvService,importExportService}.ts、test/ 下相关测试。
- 前端核心：App.tsx、components/**（ui、layout、schedule）、hooks/**、lib/**、api/{semester,board,schedules}.ts、pages/DashboardPage.tsx。
- 前端页面：pages/{UsersPage,TemplatesPage,RecommendPage,StatsPage,SettingsPage}.tsx、api/{users,templates,recommend,stats,export}.ts、components/pages/**。

## 约定

- 时间/日期：日期 YYYY-MM-DD；时间 HH:MM；周一 = 1，周日 = 7；单双周 parity: odd/even，每周 all。
- 错误码：400/404/409（SCHEDULE_CONFLICT、TEMPLATE_IN_USE、SLOT_IN_USE、USER_EXISTS、TEMPLATE_EXISTS、TEMPLATE_READONLY、TEMPLATE_ACTIVE）/422（VALIDATION_ERROR，details 为 {path,message}[]）。
- 批量保存成功返回 201；删除 204；创建类接口 201。
- JSON 字段一律 camelCase；数据库一律 snake_case。