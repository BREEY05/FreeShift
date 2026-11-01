# 角色化重构契约（v3）

> 目标：把「组织 = 数据容器」改成「组织 = 平台管理员带时间类型模板、成员各自建表」的产品形态。
> 本文件是后端/前端并行开发的**唯一接口契约**。改接口必须先改这里；实现中发现缺口也要回写这里。

## 1. 角色与页面

| 页面 | 路由 | 可见角色 | 内容 |
| --- | --- | --- | --- |
| 总览 | `/` | 所有人 | **只看自己的个人表**（周次 × 星期 × 时间段），点格子录入/编辑自己的安排；没有聚合视图、没有批选、没有同步成员。未加入组织/待审批时显示引导空态 |
| 用户 | `/users` | 所有人 | 普通成员=自己的资料 + 我的表设置（选表/新建表入口）；管理员=本组织已加入成员列表（显示每人的表名），点成员可查看其个人表 |
| 时间段 | `/slots` | 所有人 | 预设时间类型、组织模板、我的表；任何成员可新建属于自己的表（name+可选 cloneFrom）；管理员可编辑任何模板，普通成员只编辑自己的表 |
| 推荐 | `/recommend` | 仅管理员 | 保持现状 |
| 统计 | `/stats` | 仅管理员 | 保持现状 |
| 组织 | `/org` | 所有人 | 我的组织（切换）+ 组织搜索/列表 + 申请加入 + 管理员创建组织（名字 + 时间类型）+ 创建人审批申请 + 管理成员 |
| 设置 | `/settings` | 所有人 | 时间（学期）+ 基础设置；普通成员**只读**，管理员可改（含 CSV / 危险区） |
| 访问授权 | `/access` | 仅管理员 | 保持现状 |

登录：**授权名单内的邮箱直接输入邮箱即可进入，不再要求验证码**（send-code/verify 接口保留作兜底）。

角色判断：管理员 = `auth_account.role === 'admin'`（平台管理员，同时是「访问授权」页维护者）。组织创建人 = `organization.owner_email`，可审批/管理自己创建的组织。普通成员可在多个组织里。

### 无组织 / 待审批空态（所有页面必须处理）

后端在需要组织上下文的接口上仍返回：
- 未加入任何组织 → 404 `NO_ORG`（message「你还没有加入任何组织」）
- 申请待审批 → 403 `PENDING_APPROVAL`（message「加入申请待审批」）

前端：`App.tsx` 顶层不拦截（否则无法进 /org 搜索）；各页面用共享组件
`apps/web/src/components/layout/OrgRequiredNotice.tsx`（A 组负责创建）渲染空态：
props `{ error: unknown; title?: string }`，内部识别 `ApiError.code === 'NO_ORG' | 'PENDING_APPROVAL'`，
显示说明 + 「去组织页」链接（`/org`）。org 页自身不做此拦截。

## 2. 数据模型（lead 负责）

```sql
ALTER TABLE organization  ADD COLUMN template_id INTEGER REFERENCES slot_template(id) ON DELETE SET NULL;
ALTER TABLE slot_template ADD COLUMN owner_email TEXT; -- NULL=组织共享/预设；非空=某个人的表
ALTER TABLE app_user ADD COLUMN email TEXT;            -- 登录邮箱，组织内唯一
ALTER TABLE app_user ADD COLUMN template_id INTEGER REFERENCES slot_template(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_app_user_email ON app_user(org_id, email) WHERE email IS NOT NULL;
```

- `organization.template_id`：该组织确定的时间类型模板（创建组织时必选，来自 5 个内置预设之一）。
- `slot_template.owner_email`：非空 = 个人表；`is_preset=1` = 内置预设（组织共享、只读）；其余 NULL = 组织共享模板（如组织模板）。
- `app_user.email`：成员登录邮箱；审批通过或首次访问 `/users/me` 时自动建立。
- `app_user.template_id`：该成员当前的个人表；缺省 = 组织模板（**共享同一行，不复制**）。

**同一时间类型**：两个模板的 `time_slot` 起止时间序列按 `sort_order` 完全一致（逐项比 `start_time`/`end_time`）。

### 2.1 规范时间段（canonical slot）

`schedule.slot_id` / `schedule_occurrence.slot_id` **只存「组织参考模板」的 time_slot.id**。
参考模板 = 该组织当前学期 `semester.active_template_id`，为空时退回 `organization.template_id`。

- 写路径（create/update/batch/checkConflicts）：接受任意同类型模板（尤其用户个人表）的 slotId，
  先映射为参考模板 slotId 再校验/落库。映射规则：先按同 `(start_time,end_time)`，再退回同 `sort_order`；
  仍映射不到 → 422 `SLOT_NOT_COMPATIBLE`（message 说明该时间段不属于组织时间类型）。
- 读个人表：取 `app_user.template_id` 的 slots 当作行列；把每条 schedule 的 slot 按
  `(start_time,end_time)` → `sort_order` 映射回个人 slot 后落格（映射不到就跳过该条）。
- 聚合看板/推荐/统计/公平性继续用参考模板 slots + 已存储的 slot_id，语义不变。

## 3. 后端 API 契约

统一信封 `{data}` / `{error:{code,message,details}}`；cookie `freeshift_session`（登录）、`freeshift_org`（当前组织）。
所有 `/api` 接口 no-store；mutation 要求 JSON body。

### 3.1 认证（lead）

- `POST /api/v1/auth/login` body `{email}` → 200 `{data:{enabled,email,role}}` + Set-Cookie 会话。
  - 邮箱不在 `auth_account` 白名单 → 403 `NOT_AUTHORIZED`（message「该邮箱尚未获得访问授权」）。
  - 无验证码、无频率限制；写 `last_login_at`。
  - 若 `ADMIN_EMAIL` 对应账号不存在则先 ensure 管理员账号（现 `ensureAdminAccount` 逻辑）。
- `GET /api/v1/auth/session`、`POST /auth/logout`、`send-code`、`verify` 不变（前端不再使用验证码）。

### 3.2 组织（lead）

- `GET /api/v1/org/mine` → `{data:{orgs:[{org:{id,name,code,ownerEmail,createdAt,templateId,templateName},role:'owner'|'member'}],activeOrgId:number|null,canCreate:boolean}}`
  - 无组织时 200 且 `orgs:[]`、`activeOrgId:null`（**不能抛 NO_ORG**）。
- `GET /api/v1/org/list?q=` → `{data:{orgs:[{id,name,code,ownerEmail,memberCount,templateId,templateName,myStatus:'owner'|'approved'|'pending'|null}]}}`
  - 任意登录用户可调用（无需已加入）；`q` 按 name / code 模糊（不区分大小写）。
- `GET /api/v1/org/presets` → `{data:{presets:[{name,description,slotCount}]}}`（seed-defaults 的 5 个预设，slotCount 由预设定义给出）。
- `POST /api/v1/org` body `{name, presetName}` → 201 `{data:{org:{...含 templateId/templateName},members,requests}}`
  - 仅平台管理员（`isAdminRequest`），否则 403；name 1-80；presetName ∈ presets，否则 422。
  - 创建时为组织播种 5 个预设模板（沿用 `seedDefaults`），并把选中的预设设为 `organization.template_id` 与当前学期 `active_template_id`；创建者成为 owner/approved；Set-Cookie `freeshift_org`。
- `POST /api/v1/org/join` body `{orgId?, code?}` → `{data:{org:{id,name,code,ownerEmail,createdAt,templateId,templateName},status:'pending'|'approved'}}`
  - 兼容旧 `{code}`；已是成员返回现有状态；不存在 → 404。
- `GET /api/v1/org`（当前组织）→ `{data:{org:{...含 templateId/templateName},members:[{orgId,email,role,status,createdAt,tableName}],requests:[...]}}`
  - `tableName` = 该成员 `app_user.template_id` 的模板名（无 app_user 为 null）；`requests` 仅管理者可见（其他人 `[]`）。
- 审批：`GET /org/requests`、`POST /org/requests/:email/approve|reject` 路径不变。
  - approve 时：`org_member.status='approved'` + 自动建 `app_user`（name=邮箱前缀，重名加 `_2`…；color 按 `DEFAULT_USER_COLORS` 轮转；email=该邮箱；template_id=组织模板）。可重复调用（已 approved 幂等）。
- 其余（switch/members/leave/patch role）路径与行为不变。

### 3.3 用户 / 个人表（backend-accounts）

- `GET /api/v1/users/me` → `{data:{user:{id,name,color,note,email,templateId,templateName},slots:[TimeSlot...]}}`
  - 当前会话邮箱在该组织还没有 `app_user` 时自动创建（含个人表=组织模板）；slots 为该用户个人表的时间段。
  - 离线模式（`AUTH_ENABLED=false`）返回默认组织 owner 的用户（不新建）。
- `PATCH /api/v1/users/me` body `{name?,color?,note?}` → `{data:{user}}`。
- `PUT /api/v1/users/me/template` body `{templateId}` → `{data:{user}}`
  - 模板必须属于当前组织；与组织模板同一时间类型，否则 422 `TEMPLATE_TYPE_MISMATCH`。
  - 不允许选 `is_preset=1` 的预设？允许（预设可作为个人表），但个人表通常用组织模板或自建表。
- `GET /api/v1/users?include_inactive=0|1` → `{data:{users:[{id,name,color,note,isActive,sortOrder,createdAt,updatedAt,email,templateId,templateName}]}}`
  - 普通成员：只返回自己一条。管理员：本组织全部 `app_user`（即加入组织后自动建立/历史遗留的成员）。
  - 旧的 POST/PATCH/DELETE /users/:id、PUT /users/order 保留（管理员可用，行为不变），前端新页面不依赖。

### 3.4 模板 / 我的表（backend-accounts）

- `GET /api/v1/templates?scope=mine|all`（默认 all）→ `{data:{templates:[...]}}`，列表项新增：
  `ownerEmail: string|null`、`isMine: boolean`、`isOrgTemplate: boolean`（= 组织模板）、`sameTypeAsOrg: boolean`。
  - `scope=mine`：`owner_email = 当前邮箱` 或 `id = 当前用户 app_user.template_id`。
- `POST /api/v1/templates` body `{name, description?, cloneFrom?}` → `{data:{template,slots}}`
  - 任意登录用户可创建**属于自己的表**：`owner_email = 当前邮箱`；`cloneFrom` 复制该模板的 slots。
  - 组织内重名 → 409（保留 UNIQUE(org_id,name)）。
- 编辑权限（PATCH/DELETE/PUT slots/activate）：
  - `is_preset=1` → 只读（409 `TEMPLATE_READONLY`，管理员也不能改预设）。
  - 个人表（owner_email 非空）→ 仅 owner 或管理员可编辑/删除。
  - 组织共享模板（owner_email NULL 且非预设）→ 仅管理员可编辑。
  - 前端对无权限的模板隐藏编辑按钮。
- 其它路径/行为（activate 的 409 TEMPLATE_IN_USE、slots 的 SLOT_IN_USE）不变。

## 4. 前端文件归属（互不重叠）

### A 组 web-dashboard（队友）
- `apps/web/src/auth/*`（`api.ts` 增 `login(email)`；`LoginScreen.tsx` 改成邮箱直连单步；`AuthGate.tsx` 适配）
- `apps/web/src/components/layout/navItems.ts`、`SideNav.tsx`（推荐/统计/访问授权仅管理员可见）、`apps/web/src/App.tsx`（路由不变，/recommend /stats 加管理员守卫）
- `apps/web/src/components/layout/OrgRequiredNotice.tsx`（新建，B 组复用）
- `apps/web/src/pages/DashboardPage.tsx`（改成纯个人表）+ 需要的子组件（放 `apps/web/src/components/pages/dashboard/`）
- `apps/web/src/pages/UsersPage.tsx`、`apps/web/src/components/pages/users/**`、`apps/web/src/api/users.ts`、`apps/web/src/hooks/useUsers.ts`
- `apps/web/src/components/schedule/ScheduleFormDialog.tsx`（槽位映射兼容，见 5.2）

### B 组 web-org（队友）
- `apps/web/src/pages/OrgPage.tsx`、`apps/web/src/components/pages/org/**`、`apps/web/src/api/org.ts`、`apps/web/src/hooks/useOrg.ts`

### C 组 web-templates（队友）
- `apps/web/src/pages/TemplatesPage.tsx`、`apps/web/src/components/pages/templates/**`、`apps/web/src/api/templates.ts`
- `apps/web/src/pages/SettingsPage.tsx`、`apps/web/src/components/pages/settings/**`

### 后端 backend-accounts（队友）
- `apps/server/src/services/userService.ts`、`apps/server/src/routes/users.ts`
- `apps/server/src/services/templateService.ts`、`apps/server/src/routes/templates.ts`
- 只读依赖 lead 提供：`apps/server/src/services/tableService.ts`（见 5.1 导出签名）

### lead
- `apps/server/src/db/schema.sql`、`apps/server/src/db/index.ts`、`apps/server/src/db/seed-defaults.ts`
- `apps/server/src/services/authService.ts`、`apps/server/src/routes/auth.ts`
- `apps/server/src/services/orgService.ts`、`apps/server/src/routes/org.ts`、`apps/server/src/services/orgContext.ts`
- `apps/server/src/services/context.ts`、`apps/server/src/services/tableService.ts`（新建）
- `apps/server/src/services/aggregateService.ts`、`apps/server/src/services/scheduleService.ts`（canonical slot）
- `packages/shared/src/types.ts`
- 测试：`apps/server/test/{auth,org,board,e2e.contract,schedules}.test.ts`；队友负责 `test/{users,templates}.test.ts`
- `docs/REDESIGN-CONTRACT.md`

## 5. 协作细节

### 5.1 `apps/server/src/services/tableService.ts`（lead 提供给 backend-accounts，签名固定）

```ts
/** 组织参考模板 id：当前学期 active_template_id ?? organization.template_id */
export function referenceTemplateId(orgId: number): number | null;
/** 组织模板 id（= organization.template_id） */
export function orgTemplateId(orgId: number): number | null;
/** 同一时间类型判定（按 sort_order 比 start_time/end_time） */
export function sameSlotType(a: number, b: number): boolean;
/** 会话邮箱对应的 app_user（不存在则按组织模板自动创建；可选模板覆盖） */
export function ensureUserForEmail(orgId: number, email: string): UserRow;
export function userRowByEmail(orgId: number, email: string): UserRow | undefined;
/** 个人表模板 id：app_user.template_id ?? 组织模板 ?? 参考模板 */
export function personalTemplateId(orgId: number, userId: number): number | null;
/** 模板写权限：is_preset 只读、个人表仅 owner/管理员、组织共享仅管理员 */
export function assertTemplateWritable(orgId: number, templateId: number, email: string | null, isAdmin: boolean): void;
/** 槽位 canonical 映射（双向），映射不到抛 422 SLOT_NOT_COMPATIBLE */
export function canonicalSlotId(orgId: number, slotId: number): number;
export function slotIdInTemplate(orgId: number, canonicalSlotId: number, templateId: number): number | null;
/** 用户个人表 slots（参考模板为空时退回参考模板 slots） */
export function personalSlots(orgId: number, userId: number): TimeSlot[];
```

`UserRow` 形状（mappers.ts 的 UserRow 扩展，lead 负责）：`{ id, org_id, name, color, note, is_active, sort_order, email: string|null, template_id: number|null, created_at, updated_at }`。

### 5.2 前端个人表编辑兼容（A 组）
`ScheduleFormDialog` 编辑态：若 `detail.slotId` 不在 `props.slots` 中，则保留 `defaultSlotId`（个人表视图传个人 slots）。
提交时一律提交当前选择的 slotId（后端负责 canonical 映射）。

### 5.3 并行与验收
- 先让 `pnpm --filter @freeshift/web typecheck` 与 `pnpm --filter @freeshift/server test`（或仓库根测试命令）通过再交任务。
- 不碰不属于自己的文件；如必须改别人的文件，先在 Team Task 里说明。
- 后端接口改动先改本契约（或至少在任务里写明），避免前端按旧契约写完。

## 6. 验收标准（对应需求 1–4）

1. 授权名单邮箱在登录页输入邮箱即进入，无验证码；未授权邮箱提示未授权。
2. 成员（未加入组织）打开 /org 能看到全部组织列表并可提交申请；待审批可见状态。
3. 页面逻辑：(1) 管理员创建组织必须有名字+时间类型；(2) 总览只有自己个人表；(3) /users 成员配自己的表、管理员看本组织成员及各自表；(4) /slots 是预设/组织/我的表的管理处；(5) 成员无推荐/统计入口；(6) /org 可搜索、申请、创建人审批；(7) 成员在组织模板基础上配置，可选同类型既有模板；(8) /settings 成员只读；(9) 管理员 /users 只显示其组织已加入用户。
4. 成员可在 /slots 或 /users 新建属于自己的表并切换到它，个人安排在新表下正常显示。
