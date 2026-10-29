# 组织与数据隔离（v1.1）

> 从 v1.1 起，FreeShift 支持多组织：每个登录邮箱拥有独立的数据空间，组织之间完全隔离。

## 1. 核心概念

| 概念 | 说明 |
| --- | --- |
| 组织 organization | 一个排班空间，拥有唯一 8 位组织 ID（`code`），创建者即负责人（owner） |
| 成员 org_member | 邮箱 + 角色（owner/member）+ 状态（pending/approved），同一邮箱同一组织只有一条 |
| 学期 semester | 每个组织一份活动学期；切换组织不会互相影响 |
| 时间段模板 slot_template | 每个组织一套；预设模板（含「大学课表（秋）」）在创建组织时自动生成 |
| 成员 app_user | 组织内的排班成员（可理解为班级里的同学），名称只在组织内唯一 |
| 个人表 | 某个成员的周课表（`schedule`） |
| 总览表 | 组织内被选中成员的聚合看板（热力格子 = 空闲人数） |

隔离规则：所有 API 都以「当前登录邮箱 → 所属组织」为作用域，跨组织的用户、模板、安排一律返回 404。

## 2. 使用流程

1. 用已授权邮箱登录（访问授权名单见 [ACCESS-CONTROL.md](ACCESS-CONTROL.md)）。
2. 首次进入「组织」页：创建组织（自动成为负责人）或用组织 ID 申请加入。
3. 负责人「组织」页 → 待审批 → 通过/拒绝申请。
4. 「用户」页添加成员（颜色自动分配）；「时间段」页选择预设或自定义时间段。
5. 成员在「总览 → 个人」里点格子登记自己的空闲安排，系统自动展开到「周次 × 星期 × 时间段」的占用记录。
6. 负责人在「总览」页点「同步成员」，勾选要纳入总览的成员，即可看到聚合空闲热力表，无需手工录入。

## 3. 新增预设：「大学课表（秋）」

| 时间段 | 时间 | 备注 |
| --- | --- | --- |
| 第1-2节 | 08:30 – 10:10 | 上午 |
| 第3-4节 | 10:30 – 12:10 | 上午 |
| 第5-6节 | 14:00 – 15:40 | 下午 |
| 第7-8节 | 16:00 – 17:40 | 下午 |

预设模板只读；需要调整时用「克隆」生成自定义模板后再改。

## 4. 重置数据

「设置 → 危险区 → 重置当前组织数据」会清空当前组织的：

- 全部安排 `schedule` 与展开明细 `schedule_occurrence`
- 全部成员 `app_user`

保留：组织本身、成员关系（谁在组织里）、访问授权账号、学期与时间段模板。
对应接口：`DELETE /api/v1/data/reset` → `{"data":{"deletedSchedules":n,"deletedUsers":m}}`。

需要输入「重置」二次确认，操作不可撤销（建议先导出 CSV 备份）。

## 5. 组织 API

| 方法与路径 | 说明 |
| --- | --- |
| `GET /api/v1/org` | 我的组织 + 成员 + 待审批申请（申请仅负责人可见） |
| `POST /api/v1/org` `{name}` | 创建组织，返回组织与 8 位组织 ID |
| `POST /api/v1/org/join` `{code}` | 按组织 ID 申请加入，返回 `{org,status:"pending"｜"approved"}` |
| `GET /api/v1/org/requests` | 待审批申请列表（负责人） |
| `POST /api/v1/org/requests/:email/approve` `{}` | 通过申请 |
| `POST /api/v1/org/requests/:email/reject` `{}` | 拒绝申请 |
| `GET /api/v1/org/members` | 成员列表 |
| `DELETE /api/v1/org/members/:email` | 移除成员（204） |
| `POST /api/v1/org/leave` `{}` | 退出组织（负责人不可退出：409 OWNER_CANNOT_LEAVE） |

错误码：`NO_ORG`(404) 未加入组织、`PENDING_APPROVAL`(403) 申请待审批、`FORBIDDEN`(403) 无权限、`OWNER_CANNOT_LEAVE`(409)、`AUTH_REQUIRED`(401) 未登录。

## 6. 老数据升级

服务启动时自动迁移（幂等，可重复执行）：

1. 若无 `organization` 表则创建，并生成默认组织「我的组织」，负责人取访问授权名单中的管理员邮箱。
2. 为 `semester` / `slot_template` / `app_user` 补 `org_id` 并重建唯一约束（`app_user` 名称改为组织内唯一）。
3. 现有学期、模板、成员、安排全部归入默认组织，数据不丢失。

升级后原有账号登录即看到「我的组织」，历史数据完整保留。

## 7. 服务端升级步骤

```bash
cd /opt/freeshift
sudo -u ubuntu git pull --ff-only
sudo -u ubuntu /opt/node24/bin/node /opt/node24/lib/node_modules/pnpm/bin/pnpm.cjs install --frozen-lockfile
sudo -u ubuntu env NODE_OPTIONS=--max-old-space-size=1024 /opt/node24/bin/node /opt/node24/lib/node_modules/pnpm/bin/pnpm.cjs build
sudo systemctl restart freeshift-api
sudo systemctl status freeshift-api --no-pager
```

验证：`curl -s https://freeshift.ainavi.online/healthz`；浏览器打开站点登录后进入「组织」页应看到「我的组织」。
