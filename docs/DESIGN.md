# FreeShift 设计说明书 v0.1

> 名称：FreeShift（空闲排班） · Multi-User Free-Time Aggregation Scheduler
> 状态：**已确认并实现**（SQLite / Node+Fastify / React+Vite / 无应用内账号） · 目标环境：2 核 2G / 2 核 4G 个人云服务器 · Docker + Nginx
> 日期：2026-10-26

---

## 0. 总体方案与技术选型

FreeShift 做一件事：**用户登记“占用”，系统求补集，按「周次 × 星期 × 时间段」聚合出空闲，并给出推荐。**

- 不是自动排班系统：不产生“谁该值班”的分配结果，只回答“谁有空、哪里更适合”。
- 单实例、低并发、小数据量（典型 5~50 人 × 7 天 × 5~12 格 × 20 周），因此不引入 Redis / 消息队列，SQLite + 进程内计算足够。

| 层 | 选型 | 理由 |
| --- | --- | --- |
| 前端 | React 18 + TypeScript + Vite + Tailwind CSS + TanStack Query + React Router + Radix Primitives | 轻量、可控样式、现代简约风格；无重型 UI 框架 |
| 后端 | Node.js 22 + TypeScript + Fastify + Zod | 内存占用小、启动快、JSON Schema 校验、REST 清晰 |
| 数据库 | SQLite（WAL）+ Node 24 内置 node:sqlite + 轻量参数化 SQL 封装 | 单文件、零运维、无原生编译依赖、适配 2C2G；SQL 尽量保持标准，便于迁 MySQL |
| 部署 | 多阶段 Dockerfile + docker-compose（api + nginx） | Nginx 托管静态资源并反代 /api，内存可控 |
| 测试 | Vitest（后端集成 + 算法单测）、Playwright（关键页面冒烟，可选） | 覆盖聚合、冲突、算法三类核心逻辑 |
| 工期 | 约 6 人日，分 5 个阶段 | 先核心后进阶，每阶段可验收 |

目录规划（pnpm workspace 单仓）：

~~~text
FreeShift/
  apps/server/          # Fastify API + 迁移 + 种子
  apps/web/             # React 前端
  packages/shared/      # 前后端共享类型、算法常量、周次工具
  deploy/nginx/         # nginx.conf
  docs/                 # 设计文档
  scripts/              # 备份、导入样例
  docker-compose.yml
  README.md
~~~

---

## 1. 数据库设计

### 1.1 实体关系

~~~mermaid
erDiagram
    slot_template ||--o{ time_slot : "包含"
    slot_template ||--o| semester : "当前模板"
    semester ||--o{ schedule : "学期内安排"
    semester ||--o{ schedule_occurrence : "物化展开"
    app_user ||--o{ schedule : "拥有"
    time_slot ||--o{ schedule : "指向格子"
    schedule ||--o{ schedule_occurrence : "1 对 N 展开"
~~~

三条关键设计决策：

1. **原始安排 + 物化展开双表**：schedule 保存“第 1~16 周、单周、周一第 1-2 节”这类人类可编辑的区间记录；schedule_occurrence 保存按周展开后的“占用点”。聚合查询直接命中 occurrence，避免每次递归展开周次。
2. **占用点主键即聚合索引**：occurrence 的复合主键 (semester_id, week_no, weekday, slot_id, user_id) 同时承担“同一用户同一格不可重复占用”的唯一约束（冲突的数据库兜底）。
3. **学期作用域贯穿**：schedule 与 occurrence 都带 semester_id，换学期不清空历史，互不串数据。

### 1.2 表结构

#### semester（学期设置，当前生效一条）

| 字段 | 类型 | 约束/说明 |
| --- | --- | --- |
| id | INTEGER | PK 自增 |
| name | TEXT | 如“2026 春季学期” |
| start_date | TEXT | 第 1 周周一，YYYY-MM-DD |
| total_weeks | INTEGER | 1~60 |
| week1_parity | TEXT | odd / even，决定第 1 周是单周还是双周 |
| active_template_id | INTEGER | FK -> slot_template(id)，当前时间段模板 |
| is_active | INTEGER | 0/1，部分唯一索引保证只有一个生效学期 |
| created_at / updated_at | TEXT | ISO8601 UTC |

#### slot_template（时间段模板）

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | INTEGER PK | |
| name | TEXT UNIQUE | 如“大学两节连排”“半天制” |
| description | TEXT | 备注 |
| is_preset | INTEGER | 预设模板只读，可克隆为自定义模板 |
| created_at | TEXT | |

预设种子：
- 大学两节连排：08:00-09:40 / 10:00-11:40 / 14:00-15:40 / 16:00-17:40 / 19:00-20:40（5 格）
- 大学小节：8 格 × 45 分钟（08:00 起）
- 半天制：09:00-12:00 / 13:30-18:00（2 格）
- 自定义：空模板，由用户逐格添加

#### time_slot（时间段）

| 字段 | 类型 | 约束/说明 |
| --- | --- | --- |
| id | INTEGER PK | |
| template_id | INTEGER | FK -> slot_template ON DELETE CASCADE |
| label | TEXT | “第 1-2 节”或“08:00-10:00” |
| start_time / end_time | TEXT | HH:MM，可空 |
| day_part | TEXT | morning / afternoon / evening |
| duration_min | INTEGER | 5~720，缺省 90，公平性统计使用 |
| sort_order | INTEGER | 同模板内唯一，决定表格行序 |

#### app_user（用户）

| 字段 | 类型 | 约束/说明 |
| --- | --- | --- |
| id | INTEGER PK | |
| name | TEXT UNIQUE | 昵称/姓名 |
| color | TEXT | #RRGGBB，前端展示色 |
| note | TEXT | 备注（班级/部门，可空） |
| is_active | INTEGER | 0=停用（软删除，保留历史安排） |
| sort_order | INTEGER | 手排顺序 |
| created_at / updated_at | TEXT | |

#### schedule（用户安排原始记录）

| 字段 | 类型 | 约束/说明 |
| --- | --- | --- |
| id | INTEGER PK | |
| semester_id | INTEGER | FK -> semester ON DELETE CASCADE |
| user_id | INTEGER | FK -> app_user ON DELETE CASCADE |
| weekday | INTEGER | 1~7（周一=1） |
| slot_id | INTEGER | FK -> time_slot ON DELETE RESTRICT |
| start_week / end_week | INTEGER | 1<=start<=end<=60 |
| parity | TEXT | all / odd / even |
| note | TEXT | 如“高数课” |
| created_at / updated_at | TEXT | |

一条记录覆盖连续多周，单双周由 parity 表达；写入时展开为 occurrence。

#### schedule_occurrence（按周展开的占用点）

| 字段 | 类型 | 约束/说明 |
| --- | --- | --- |
| semester_id | INTEGER | 复合主键 1 |
| week_no | INTEGER | 复合主键 2 |
| weekday | INTEGER | 复合主键 3 |
| slot_id | INTEGER | 复合主键 4 |
| user_id | INTEGER | 复合主键 5 |
| schedule_id | INTEGER | FK -> schedule ON DELETE CASCADE，支持溯源与整条删除 |

PRIMARY KEY (semester_id, week_no, weekday, slot_id, user_id) + WITHOUT ROWID。该主键顺序 = 聚合查询的覆盖索引，能同时服务“某周格子占用/空闲”与“某用户第 N 周占用”。

#### algo_config（算法权重，单行）

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | INTEGER PK | 恒为 1 |
| weights_json | TEXT | 权重、时段友好度、历史窗口等配置的 JSON |
| updated_at | TEXT | |

默认值：

~~~json
{
  "weights": { "freeRatio": 0.35, "continuity": 0.25, "history": 0.20, "friendliness": 0.10, "recentLoad": 0.10 },
  "dayPart": { "morning": 0.90, "afternoon": 0.80, "evening": 0.50 },
  "historyWeeks": 4,
  "recentWindow": 1
}
~~~

#### 初始化与升级

启动时执行 db/schema.sql（全部 CREATE TABLE IF NOT EXISTS，幂等）并写入预设模板/默认学期种子，无需单独迁移命令。后续结构升级可在 schema.sql 追加 ALTER 语句或在 db 层增加版本化迁移（如新增“假期跳过周”表）。

### 1.3 DDL（SQLite）

~~~sql
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;

CREATE TABLE slot_template (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT    NOT NULL UNIQUE,
  description TEXT    NOT NULL DEFAULT '',
  is_preset   INTEGER NOT NULL DEFAULT 0 CHECK (is_preset IN (0, 1)),
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE time_slot (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  template_id  INTEGER NOT NULL REFERENCES slot_template(id) ON DELETE CASCADE,
  label        TEXT    NOT NULL,
  start_time   TEXT,
  end_time     TEXT,
  day_part     TEXT    NOT NULL DEFAULT 'morning' CHECK (day_part IN ('morning', 'afternoon', 'evening')),
  duration_min INTEGER NOT NULL DEFAULT 90 CHECK (duration_min BETWEEN 5 AND 720),
  sort_order   INTEGER NOT NULL,
  UNIQUE (template_id, sort_order),
  UNIQUE (template_id, label)
);
CREATE INDEX ix_time_slot_template ON time_slot(template_id, sort_order);

CREATE TABLE semester (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  name               TEXT    NOT NULL,
  start_date         TEXT    NOT NULL,
  total_weeks        INTEGER NOT NULL CHECK (total_weeks BETWEEN 1 AND 60),
  week1_parity       TEXT    NOT NULL DEFAULT 'odd' CHECK (week1_parity IN ('odd', 'even')),
  active_template_id INTEGER REFERENCES slot_template(id) ON DELETE RESTRICT,
  is_active          INTEGER NOT NULL DEFAULT 0 CHECK (is_active IN (0, 1)),
  created_at         TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at         TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE UNIQUE INDEX ux_semester_active ON semester(is_active) WHERE is_active = 1;

CREATE TABLE app_user (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT    NOT NULL UNIQUE,
  color      TEXT    NOT NULL DEFAULT '#6366F1' CHECK (length(color) = 7),
  note       TEXT    NOT NULL DEFAULT '',
  is_active  INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX ix_app_user_active ON app_user(is_active, sort_order);

CREATE TABLE schedule (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  semester_id INTEGER NOT NULL REFERENCES semester(id) ON DELETE CASCADE,
  user_id     INTEGER NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  weekday     INTEGER NOT NULL CHECK (weekday BETWEEN 1 AND 7),
  slot_id     INTEGER NOT NULL REFERENCES time_slot(id) ON DELETE RESTRICT,
  start_week  INTEGER NOT NULL CHECK (start_week >= 1),
  end_week    INTEGER NOT NULL CHECK (end_week >= start_week AND end_week <= 60),
  parity      TEXT    NOT NULL DEFAULT 'all' CHECK (parity IN ('all', 'odd', 'even')),
  note        TEXT    NOT NULL DEFAULT '',
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX ix_schedule_user_week ON schedule(semester_id, user_id, weekday, start_week, end_week);
CREATE INDEX ix_schedule_slot ON schedule(slot_id);

CREATE TABLE schedule_occurrence (
  semester_id INTEGER NOT NULL REFERENCES semester(id) ON DELETE CASCADE,
  week_no     INTEGER NOT NULL CHECK (week_no >= 1),
  weekday     INTEGER NOT NULL CHECK (weekday BETWEEN 1 AND 7),
  slot_id     INTEGER NOT NULL REFERENCES time_slot(id) ON DELETE CASCADE,
  user_id     INTEGER NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  schedule_id INTEGER NOT NULL REFERENCES schedule(id) ON DELETE CASCADE,
  PRIMARY KEY (semester_id, week_no, weekday, slot_id, user_id)
) WITHOUT ROWID;
CREATE INDEX ix_occ_schedule ON schedule_occurrence(schedule_id);
CREATE INDEX ix_occ_user_week ON schedule_occurrence(semester_id, user_id, week_no);

CREATE TABLE algo_config (
  id           INTEGER PRIMARY KEY CHECK (id = 1),
  weights_json TEXT NOT NULL,
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
INSERT INTO algo_config (id, weights_json) VALUES (1, '{"weights":{"freeRatio":0.35,"continuity":0.25,"history":0.2,"friendliness":0.1,"recentLoad":0.1},"dayPart":{"morning":0.9,"afternoon":0.8,"evening":0.5},"historyWeeks":4,"recentWindow":1}');
~~~

### 1.4 索引与性能

- 聚合主路径：(semester_id, week_no, weekday, slot_id) 是 occurrence 主键前缀，单周聚合为索引范围扫描。
- 个人视图：ix_occ_user_week 覆盖某学期某用户的全部周次。
- 冲突检测：按 user + 周区间扫描 occurrence，或直接对 schedule 做区间重叠查询，索引 ix_schedule_user_week 覆盖。
- 数据量估算：10 用户 × 7 天 × 5 格 × 20 周 ≈ 7000 行；50 用户满排 ≈ 3.5 万行。SQLite 在本机毫秒级完成，无需缓存层。
- 写放大约束：仅写 schedule 时事务内删旧 occurrence、插新 occurrence（O(周数) 行），并依赖主键唯一约束兜底重复。

### 1.5 切换 MySQL（可选）

当前使用 node:sqlite 与参数化 SQL，未引入 ORM。切 MySQL 时需要：替换 db 层驱动（如 mysql2）、把 TEXT 时间改 DATETIME、去掉 WITHOUT ROWID、把 semester 的部分唯一索引改为生成列 active_key 上的唯一索引；occ 主键与业务 SQL 基本不变。聚合查询逻辑与算法均在应用层，可复用。

---

## 2. 后端 API

### 2.1 约定

- Base：/api/v1，JSON/UTF-8，同源部署（Nginx 反代），无跨域。
- 成功：200/201 + { "data": ... }；列表附 { "meta": { "total": n } }。
- 失败：4xx/5xx + { "error": { "code", "message", "details" } }。
  - 404 NOT_FOUND；409 SCHEDULE_CONFLICT / TEMPLATE_IN_USE / SLOT_IN_USE；422 VALIDATION_ERROR（details 为字段数组）。
- 时间：全部 ISO8601；业务日期用 YYYY-MM-DD；默认时区 Asia/Shanghai。
- 认证：MVP 不做应用内账号，部署时由 Nginx Basic Auth / Cloudflare Access 保护（见第 6 节）。

### 2.2 学期与周次

| 方法 | 路径 | 说明 | 参数 | 返回 |
| --- | --- | --- | --- | --- |
| GET | /semester | 当前学期 + 周历 | – | semester + weeks[]（week_no/parity/start_date/end_date/is_current） |
| PUT | /semester | 更新学期 | name, start_date, total_weeks, week1_parity | semester；起止周变化时事务内重建 occurrence |
| GET | /semester/weeks | 单独取周历 | – | weeks[] |
| POST | /semester | 新建学期（预留多学期） | 同上 | 201 semester（自动置为 active） |

### 2.3 时间段模板

| 方法 | 路径 | 说明 | 参数 | 返回 |
| --- | --- | --- | --- | --- |
| GET | /templates | 模板列表 | include_slots? | templates[]（含 slotCount、isActive） |
| GET | /templates/:id | 模板 + 时间段 | – | template + slots[] |
| POST | /templates | 新建/克隆 | name, description, clone_from? | 201 template |
| PATCH | /templates/:id | 改名/描述 | – | template |
| DELETE | /templates/:id | 删除 | – | 204；预设 409 / 当前使用中 409 |
| POST | /templates/:id/activate | 设为当前模板 | force? | semester；旧模板已有安排时 409 并返回安排条数 |
| PUT | /templates/:id/slots | 全量替换时间段（编辑网格） | slots[] | slots[]；模板已有安排时 409 |
| POST | /templates/:id/slots | 追加单格 | label, start_time, end_time, day_part, sort_order | 201 slot |
| PATCH | /slots/:id | 修改单格 | 同上 | slot |
| DELETE | /slots/:id | 删除单格 | – | 204；被安排引用时 409 |

### 2.4 用户

| 方法 | 路径 | 说明 | 参数 | 返回 |
| --- | --- | --- | --- | --- |
| GET | /users | 用户列表 | include_inactive? | users[] |
| POST | /users | 新增 | name, color?, note? | 201 user |
| PATCH | /users/:id | 修改 | name/color/note/is_active | user |
| DELETE | /users/:id | 停止使用 | – | 204（软删除，安排保留） |
| DELETE | /users/:id?hard=1 | 彻底删除 | – | 204（级联删除该用户安排，前端二次确认） |
| PUT | /users/order | 排序 | ids[] | users[] |

### 2.5 安排（录入/编辑/冲突）

| 方法 | 路径 | 说明 | 参数 | 返回 |
| --- | --- | --- | --- | --- |
| GET | /schedules | 原始安排列表 | user_id, from_week, to_week, weekday | schedules[] |
| GET | /schedules/:id | 单条 | – | schedule |
| POST | /schedules | 新增（单条） | user_id, weekday, slot_id, start_week, end_week, parity, note | 201 schedule；冲突 409 + conflicts[] |
| POST | /schedules/batch | 批量框选保存 | user_id, cells[{weekday,slot_ids[]}], weeks{start,end,parity}, mode=strict/skip | 201 { created, skipped, conflicts[] } |
| PATCH | /schedules/:id | 修改（区间/周几/格子） | 同 POST | schedule；冲突 409 |
| DELETE | /schedules/:id | 删除 | – | 204（级联 occurrence） |
| POST | /schedules/check | 冲突预检（保存前调用） | user_id, weekday, slot_ids[], start_week, end_week, parity, exclude_id? | { conflicts[] } |

批量语义：cells 与 weeks 做笛卡尔积后按单双周展开逐格校验；strict 模式任一冲突则整体 409 不落库；skip 模式跳过冲突格，返回冲突明细，前端高亮提示。

### 2.6 主界面聚合与个人视图

| 方法 | 路径 | 说明 | 参数 | 返回 |
| --- | --- | --- | --- | --- |
| GET | /board/aggregate | 主聚合（一次拿全表） | week?, user_ids?, day_parts?, filter=all/full_free/partial | week + slots[] + users[] + cells[] |
| GET | /board/cell | 单格详情（抽屉刷新/深链） | week, weekday, slot_id | cell + freeUsers[] + occupiedUsers[] |
| GET | /board/user/:id | 个人安排视图 | week? | slots[] + cells[]（含 scheduleId/占用标记） |
| GET | /board/user/:id/schedules | 个人区间安排列表（编辑用） | from_week, to_week | schedules[] |

聚合返回示例（客户端点击格子无需再发请求）：

~~~json
{
  "data": {
    "week": { "week_no": 3, "parity": "odd", "start_date": "2026-03-02", "end_date": "2026-03-08" },
    "total_users": 5,
    "slots": [{ "id": 101, "label": "第1-2节", "start_time": "08:00", "end_time": "09:40", "day_part": "morning", "sort_order": 1 }],
    "users": [{ "id": 1, "name": "小林", "color": "#6366F1" }],
    "cells": [{ "weekday": 1, "slot_id": 101, "free_count": 3, "total_users": 5, "free_user_ids": [1, 2, 5], "occupied_user_ids": [3, 4] }]
  }
}
~~~

### 2.7 智能算法

| 方法 | 路径 | 说明 | 参数 | 返回 |
| --- | --- | --- | --- | --- |
| POST | /recommend/common-free | 多人最佳共同空闲块 | week, user_ids[], top_k?, require_time_adjacent? | blocks[]（weekday、slot 序列、起止时间、长度、分钟数） |
| POST | /recommend/scored | 多因子加权推荐 | week, user_ids?, filters{day_parts, weekdays, all_free_only, min_free_ratio}, weights?, top_k? | ranked[]（cell + score + 各因子归一化值） |
| POST | /recommend/alternatives | 冲突最小化替代时段 | user_id, weekday, slot_id, weeks{start,end,parity}, top_k? | candidates[]（冲突人数、空闲人数、分数、建议周次） |
| GET | /recommend/config | 读取权重 | – | weights + dayPart + 窗口 |
| PUT | /recommend/config | 保存权重（归一化后存储） | weights, dayPart 等 | config |
| GET | /stats/fairness | 公平性统计 | from_week?, to_week? | perUser[]（占用格数/分钟/连续块）、gini、variance、hints[] |

### 2.8 导入导出与运维

| 方法 | 路径 | 说明 | 参数 | 返回 |
| --- | --- | --- | --- | --- |
| GET | /export/schedules | 导出安排 CSV（Excel 可开） | format=csv, from_week, to_week | text/csv 附件 |
| GET | /export/board | 导出某周聚合表 CSV | week | text/csv 附件 |
| POST | /import/schedules | CSV 导入（先 dry_run） | multipart file, dry_run=1 | { created, skipped, errors[] } |
| GET | /healthz | 健康检查 | – | { status, db, version } |
| GET | /meta | 版本/时区/库类型 | – | { version, builtAt, db, timezone } |

CSV 列：user,weekday,slot_label,start_week,end_week,parity,note。导入按 user 名与 slot label 匹配，缺失项进入 errors 不中断。

---

## 3. 聚合查询与算法逻辑

### 3.1 周次展开（写入路径）

定义第 week 周的奇偶性：

~~~text
isOdd(week) = week1_parity === 'odd' ? week % 2 === 1 : week % 2 === 0
weekParity(week) = isOdd(week) ? 'odd' : 'even'
include(week) = parity === 'all' || parity === weekParity(week)
~~~

新增/修改安排的事务步骤：

1. 校验 user、slot、weekday、周区间与 parity；
2. 求目标周集合 targetWeeks（含 parity 过滤）；
3. 查用户在这些周的既有占用点，与目标格子求交集，非空则 409 返回冲突明细（dry-run 接口复用同一函数）；
4. 插入 schedule（触发 occurrence 级联）→ 删除旧 occurrence（编辑时）→ 批量插入新 occurrence（依赖主键唯一约束兜底）；
5. 返回 schedule 与展开后的周次列表。

### 3.2 主界面聚合 SQL

~~~sql
-- 1) 每个格子的空闲/占用人数：以「时间段 × 星期 × 用户」为网格左连占用点
WITH grid AS (
  SELECT w.d AS weekday, ts.id AS slot_id
  FROM (SELECT 1 d UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4
        UNION ALL SELECT 5 UNION ALL SELECT 6 UNION ALL SELECT 7) w
  CROSS JOIN time_slot ts
  WHERE ts.template_id = :template_id
)
SELECT g.weekday,
       g.slot_id,
       COUNT(*)                   AS total_users,
       COUNT(*) - COUNT(o.user_id) AS free_count
FROM grid g
CROSS JOIN app_user u
LEFT JOIN schedule_occurrence o
       ON o.semester_id = :semester_id
      AND o.week_no     = :week
      AND o.weekday     = g.weekday
      AND o.slot_id     = g.slot_id
      AND o.user_id     = u.id
WHERE u.is_active = 1
GROUP BY g.weekday, g.slot_id;
~~~

~~~sql
-- 2) 本周占用明细（一次取回，服务格子抽屉与个人视图）
SELECT o.weekday, o.slot_id, o.user_id, o.schedule_id
FROM schedule_occurrence o
WHERE o.semester_id = :semester_id AND o.week_no = :week;
~~~

第一段 SQL 出人数（SQLite 单周约 0.2ms），第二段取本周全部占用点（≤ 用户数 × 7 × 格数，量级几百行），在内存中做集合补集得到“空闲用户 ID 列表”。**人数与名单同源，避免二次请求**；列表接口按 user_ids 过滤时在 WHERE 追加 o.user_id IN (...)。

个人视图：

~~~sql
SELECT s.id, s.weekday, s.slot_id, s.start_week, s.end_week, s.parity, s.note
FROM schedule s
JOIN time_slot ts ON ts.id = s.slot_id
WHERE s.semester_id = :semester_id
  AND s.user_id = :user_id
  AND ts.template_id = :template_id
  AND s.start_week <= :week AND s.end_week >= :week
  AND (s.parity = 'all' OR s.parity = :week_parity)
ORDER BY s.weekday, ts.sort_order;
~~~

区间重叠 + 单双周条件直接命中 ix_schedule_user_week，个人视图无需 occurrence。

### 3.3 最佳共同空闲时段（算法 1）

1. 取所选用户在第 W 周的占用点集合 O（并可取非所选用户，用于冲突提示）；
2. 全员空闲格 F = 网格全集 − O；按 weekday 分组、按 sort_order 升序；
3. 连续区间合并：排序后扫描，sort_order 相邻即候选；若开启时间连续（默认），还要求后格开始时间不早于前格结束时间且间隔 ≤20 分钟（容忍课间），否则按顺序相邻合并；
4. 块按长度降序、起始时间升序、空闲人数降序排序，返回 Top-K，附起止时间与分钟数。

复杂度 O(7 × 格数 log 格数)，典型 35 格，可忽略。

### 3.4 多因子加权推荐（算法 2）

对候选格 c（默认 = 当周未被所选用户占用的格子）：

~~~text
freeRatio(c)     = free_count(c) / total_users
continuity(c)    = 所在空闲块长度 / 当周最大空闲块长度
history(c)       = 1 - (前 historyWeeks 周内所选用户在该格占用次数) / (人数 × 周数)
friendliness(c)  = dayPart[c.day_part]（morning 0.90 / afternoon 0.80 / evening 0.50）
recentLoad(c)    = 1 - (第 W-1..W+1 周该格占用次数) / (人数 × 3)，截断到 [0,1]
~~~

各因子在当周候选集内做 min-max 归一化（全相等时取 1 或 0.5），权重从 algo_config 读取后按 Σw 归一并加权求和：

~~~text
score(c) = Σ w_i × norm_i(c) / Σ w_i
~~~

返回排序后的 Top-K，并返回每个因子归一化值，前端展示“推荐理由”（如“全员空闲 / 连续 3 节 / 上午友好”）。权重修改即时生效，无需重启。

### 3.5 冲突最小化替代时段（算法 3）

用户 U 想在 (weekday=d, slot=s, weeks) 加安排时：

~~~sql
SELECT slot_id, COUNT(DISTINCT user_id) AS occupied_users
FROM schedule_occurrence
WHERE semester_id = :sid
  AND week_no BETWEEN :from_week AND :to_week
  AND weekday = :weekday
GROUP BY slot_id;
~~~

候选 = 同一批周次内 U 无占用的格子（含其他星期），按 occupied_users 升序、free_count 降序、算法 2 分数降序排序，返回前 K 个并提示“比原时段少 X 人冲突”。若原时段本身全空闲，则返回“无冲突，可放心添加”。

### 3.6 公平性统计（算法 4）

- 每人占用时长 x_i = Σ（occurrence 数 × 对应 time_slot.duration_min）；
- 基尼系数 G = Σ_i Σ_j |x_i − x_j| / (2 n^2 μ)，μ 为均值；G 越接近 0 越均衡；
- 方差与标准差用于辅助展示；
- 连续占用：按周统计每人相邻占用格构成的最大连续块（分钟），指出“连续占用过长”的成员；
- 提示规则：G > 0.25 输出不均衡提示，并列出最高/最低者与差值；样本少于 3 人时不判定。

---

## 4. 前端设计

### 4.1 技术结构

React 18 + TypeScript + Vite；Tailwind 定义设计 token；TanStack Query 管理服务端状态（聚合/用户/模板各一组 queryKey，刷新按钮 invalidate 全部）；React Router 6；Radix 提供 Dialog/Drawer/Tooltip/Select 无障碍基础；lucide-react 图标；无重型组件库。

~~~text
apps/web/src/
  main.tsx
  App.tsx                     # 路由 + AppShell
  api/client.ts               # fetch 封装、错误归一化
  api/{semester,users,templates,schedules,board,recommend}.ts
  types/                      # 与 packages/shared 对齐
  hooks/useSemester.ts useWeek.ts useBoard.ts useConflicts.ts
  components/layout/{AppShell,SideNav,TopBar,WeekSwitcher,RefreshButton}
  components/schedule/{AggregateGrid,GridCell,GridLegend,CellDrawer,
                       PersonalGrid,BatchSelectBar,ScheduleFormDialog,ConflictBanner}
  components/users/{UserList,UserFormDialog,UserChip}
  components/slots/{TemplatePicker,SlotEditorTable}
  components/recommend/{CommonFreePanel,ScoredList,FactorBars,WeightEditor}
  components/stats/{FairnessChart,LoadTable}
  pages/{Dashboard,UsersPage,SlotsPage,RecommendPage,StatsPage,SettingsPage}
  styles/tokens.css
~~~

### 4.2 页面与交互

**主界面 /**：顶部栏（学期 + 周次切换 + 单双周标记 + 刷新 + 视图切换）；主体为「时间段 × 星期」7 列表格；每格只显示“空闲 N 人”与热度底色，点击右侧抽屉展示空闲名单（头像色点 + 名字）与已占用名单，并可直接给某人补录安排。筛选：全部 / 全空闲 / 部分空闲。个人视图切换到某用户，格子显示占用（带备注 tooltip）与空闲，点击格子即进入新增/编辑安排。

批量录入：进入“批选模式”后拖动框选多个格子，弹出侧栏选择周次区间与单双周，调用 batch 接口；冲突时高亮冲突格并给出“跳过冲突保存 / 返回修改”。

**推荐页 /recommend**：选人 → 共同空闲块时间轴（按天分组，块宽表示时长）；多因子推荐列表带因子条与权重滑杆（保存到 algo_config）；冲突最小化入口可从主界面格子抽屉“换个时间”直接跳转。

**统计页 /stats**：每人占用柱状图、基尼系数与均衡提示、连续占用明细。

### 4.3 视觉规范（现代简约）

| 元素 | 规范 |
| --- | --- |
| 背景/表面 | 页面 #F6F7F9，卡片 #FFFFFF，分隔线 #E6E8EC |
| 文字 | 主 #1C1F23，次 #6B7280，弱 #9CA3AF |
| 主色 | Indigo #4F46E5（主按钮、选中态、焦点环），悬浮 #4338CA |
| 语义色 | 空闲青 #0F766E，注意琥珀 #B45309，危险 #B91C1C |
| 空闲热度 | 0 人 #F3F4F6；<50% #ECFDF5；50-75% #D1FAE5；75-100% #A7F3D0；全员空闲 #6EE7B7（文字统一 #065F46） |
| 圆角 | 卡片 12px，控件 8px，徽标 6px |
| 阴影 | 仅 0 1px 2px rgba(16,24,40,.06)，禁止多层重阴影 |
| 字体 | Inter + Noto Sans SC；正文 14/22，辅助 12/18，数字 tabular-nums |
| 间距 | 4px 栅格，内容区最大 1200px，卡片内边距 16/20 |
| 动效 | 120–160ms ease-out，仅用于抽屉/悬浮反馈，不做弹跳 |

无障碍：对比度 ≥ 4.5:1；格子为 button 且支持 Enter/Space；抽屉焦点陷阱；表格首列（时间段）在横向滚动时 sticky；窄屏 &lt; 1024px 时表格横向滚动 + 顶部提示，&lt; 640px 改为按天分组的卡片列表。

空态：无用户时主区域引导“先添加成员”，无安排时格子显示柔和占位，避免大段说明文字。

---

## 5. 分阶段开发计划

| 阶段 | 内容 | 验收标准 | 预估 |
| --- | --- | --- | --- |
| P0 脚手架 | monorepo、TS 配置、Fastify 骨架、Vite、Tailwind token、建表与种子、共享类型 | pnpm dev 同时起前后端，GET /healthz 通，建表可重复执行 | 0.5 天 |
| P1 数据内核 | 学期/模板/时间段/用户 CRUD、schedule 增删改、occurrence 展开、冲突检测、batch 保存 | 用 REST 建学期与 3 用户并录入跨周安排；重复格子返回 409 明细；改周设置后 occurrence 正确重建 | 1.5 天 |
| P2 主界面 | 聚合接口与主表格、周次切换、刷新、格子抽屉、个人视图、筛选、批选录入 | 第 N 周每个格子人数与名单正确；点击抽屉无需二次请求；刷新即时反映写入 | 1.5 天 |
| P3 智能算法 | 共同空闲块、加权推荐、冲突最小化、公平性统计、权重配置接口与页面 | 构造 5 人数据集，算法结果可手算验证；权重调整改变排序；单测覆盖区间合并与归一化 | 1.5 天 |
| P4 交付 | CSV 导入导出、Dockerfile、compose、Nginx、README、种子数据、备份脚本、端到端冒烟 | docker compose up 后浏览器全流程可用；2G 内存限制下稳定；README 可按步骤复现 | 1 天 |

每个阶段结束提交可运行版本并跑测试；P2 前可用 seed 脚本造 5 人 × 20 周演示数据。

### 风险与对策

| 风险 | 对策 |
| --- | --- |
| SQLite 并发写锁 | WAL + busy_timeout 5s；写操作短事务；单实例部署 |
| 时间段模板切换导致旧安排不可见 | 切换前检查旧模板安排条数，有数据时 409 并提示“新建学期/清理后再切换”；历史模板保留可切回 |
| 小内存 OOM | API 内存上限 320M；Nginx 限制 worker；禁用 source map 与开发依赖进镜像 |
| 时区导致“本周”错位 | 服务端统一 Asia/Shanghai 计算周次，前端只读服务端周历 |

---

## 6. 部署方案（Docker + Nginx）

~~~text
浏览器 → Nginx(80) ─┬─ /            → /usr/share/nginx/html（Vite 构建产物）
                    └─ /api/*       → api:3000（Fastify）
                                      └─ /data/freeshift.db（volume）
~~~

- api 镜像：node:22-bookworm-slim，多阶段构建，生产依赖 + 编译产物，非 root 用户，HEALTHCHECK 打 /healthz，memory limit 320M。
- web 镜像：nginx:1.27-alpine，静态产物 + nginx.conf；gzip、静态资源 immutable 缓存、SPA fallback、/api 反代、client_max_body_size 10m（导入）。
- compose：两个服务 + 命名 volume，restart: unless-stopped，TZ=Asia/Shanghai，api 只暴露内网端口。
- 安全：应用自身不实现登录，部署时 Nginx Basic Auth（推荐 bcrypt htpasswd）或 Cloudflare Tunnel/Access；HTTPS 由外层反代或 certbot 负责。
- 备份：每日 sqlite3 .backup + gzip 到 /backups，保留 7 份；README 给出 cron 与恢复命令。

关键环境变量：DATABASE_PATH=/data/freeshift.db、PORT=3000、TZ=Asia/Shanghai、LOG_LEVEL=info、BASIC_AUTH（可选，由 Nginx 使用）。

---

## 7. 已确认的口径

1. 数据库默认 **SQLite**（零运维、适配 2C2G）；Kysely 未使用，改为轻量 SQL 封装（Node 24 原生 node:sqlite）。
2. 技术栈 Node 24 + Fastify 5 + React 18 + Vite + Tailwind —— 已采用。
3. 冲突策略：**阻止重复保存并返回明细**（409 + ConflictDetail[]）—— 已采用。
4. 同一时间仅一个启用学期；切换模板时旧模板若被当前学期安排引用则需 force —— 已采用。
5. 应用内不做登录（已确认不需要账号），公网部署依赖 Nginx Basic Auth / Cloudflare Access。
6. 导入导出采用 **CSV**（UTF-8 BOM，Excel 可直接打开），不提供 xlsx。
7. 算法默认权重 0.35/0.25/0.20/0.10/0.10，时段友好度早 0.9 / 午 0.8 / 晚 0.5，可在设置页调整。

> 实现进度：P0~P4 已完成并进入联调验收，详见 README。