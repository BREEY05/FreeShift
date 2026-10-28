# 升级到「管理员授权名单」版本

本版改动：未授权的邮箱**无法登录**；管理员在左侧「访问授权」页维护名单、指派管理员；看板默认打开真实时间的当前周。

- 版本提交：`a0975ca` feat: 管理员授权名单与访问授权页面
- 新增环境变量：`ADMIN_EMAIL`（默认 `380154843@qq.com`）
- 数据库：`auth_account` 新增 `role`、`added_by`、`last_login_at` 三列，服务启动时**自动迁移**，无需手工 SQL
- 测试：服务端 99 个用例全绿（含 14 个授权用例）

---

## 给服务器 AI 的指令（整段复制）

```text
请把已在 https://freeshift.ainavi.online 运行的 FreeShift 升级到最新提交 a0975ca（管理员授权名单版本）。

硬性约束（不得违反）：
1. 只动 /opt/freeshift、/data/freeshift 和 freeshift-api.service，绝不修改 Nginx 现有站点
   （ainavi.online、study.ainavi.online、game.ainavi.online）、/var/www、MySQL、SSH、系统自带 node。
2. 不使用 Docker，不安装除现有之外的软件包。
3. Node 一律用 /opt/node24/bin/node（v24.11.0），不要用系统 node v20。
4. 真实 SMTP 授权码不要写进仓库、不要提交 git、不要贴到聊天里；只写入 /data/freeshift/auth.env。
5. 迁移是自动的；升级前先备份数据库。

步骤：
1. 备份：cp /data/freeshift/freeshift.db /data/freeshift/freeshift-$(date +%F-%H%M).db
2. 升级代码：
   cd /opt/freeshift
   git fetch origin && git status --short   # 若有本地改动先报告，不要强拉
   git reset --hard origin/main             # 或 git pull --ff-only
   /opt/node24/bin/corepack pnpm install --frozen-lockfile
   NODE_OPTIONS=--max-old-space-size=1024 /opt/node24/bin/corepack pnpm build
3. 配置环境变量（沿用已有的 SMTP 配置，缺的补上）：
   cat /data/freeshift/auth.env   # 确认已有 SMTP_HOST= smtp.qq.com / SMTP_PORT=465 /
                                  # SMTP_USER=380154843@qq.com / SMTP_PASS=<授权码> / SMTP_FROM=380154843@qq.com
   若没有 ADMIN_EMAIL 就追加一行：
   echo 'ADMIN_EMAIL=380154843@qq.com' >> /data/freeshift/auth.env
   chmod 600 /data/freeshift/auth.env && chown ubuntu:ubuntu /data/freeshift/auth.env
   （可选：AUTH_ENABLED=false 只用于本机离线调试；线上保持 true 或不写）
4. 重启并确认迁移：
   sudo systemctl restart freeshift-api
   sleep 3; sudo systemctl status freeshift-api --no-pager | head -20
   curl -s http://127.0.0.1:3100/api/v1/auth/session
   期望：{"data":{"enabled":true,"email":null,"role":null}}
   再查表结构确认迁移生效：
   /opt/node24/bin/node -e "const {DatabaseSync}=require('node:sqlite');const d=new DatabaseSync('/data/freeshift/freeshift.db');console.log(d.prepare('PRAGMA table_info(auth_account)').all().map(c=>c.name));console.log(d.prepare('SELECT email,role FROM auth_account').all());"
   期望列包含 email, role, created_at, added_by, last_login_at；管理员邮箱 380154843@qq.com 的 role 应为 admin。
5. 验证授权拦截生效：
   curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3100/api/v1/users
   期望 401（说明所有业务接口都要求登录）。
6. 用公网域名自查：
   curl -s https://freeshift.ainavi.online/api/v1/auth/session
   打开 https://freeshift.ainavi.online ，应看到登录页（输入邮箱→收验证码）；
   用 380154843@qq.com 登录后，左侧应出现「访问授权」菜单。
7. 输出报告：git 版本、构建结果、systemctl 状态、上述 curl 结果、auth_account 表结构与名单、
   以及有没有异常日志（sudo journalctl -u freeshift-api -n 50 --no-pager）。
   若任何一步失败，立刻说清楚失败点，并给出回滚命令：
   cd /opt/freeshift && git reset --hard <上一个提交> && pnpm install --frozen-lockfile && pnpm build && sudo systemctl restart freeshift-api
   （数据库如需回滚，先停服再覆盖 /data/freeshift/freeshift.db 的备份）
```

## 升级后使用说明

1. 打开 `https://freeshift.ainavi.online`，用自己的邮箱收验证码登录（`380154843@qq.com` 是默认管理员）。
2. 左侧菜单 → **访问授权**：
   - 输入同学邮箱 → 选"成员" → 添加。**添加即等于对方已完成注册**，对方直接输邮箱收码就能登录。
   - 需要找助手的人勾"管理员"，他也能进这个页面加人/删人。
   - 移出名单后，对方当前的登录立即失效，也收不到验证码。
3. 保护规则：不能改自己的角色、不能删自己、至少保留一位管理员。
4. 未授权的人输入邮箱点"发送验证码"会直接提示"该邮箱尚未获得访问授权，请联系管理员"。

## 常见问题

- **登录页一直显示"尚未获得访问授权"**：该邮箱不在名单，或管理员误删；让管理员在 /access 添加即可。
- **收不到验证码**：检查 /data/freeshift/auth.env 里的 SMTP_PASS 是否是 QQ 邮箱的"授权码"（不是登录密码），并且 `journalctl -u freeshift-api` 里没有 `MAIL_UNAVAILABLE`。
- **看板周次不对**：看板默认显示真实时间的当前周；可通过顶部周次切换器看其它周，接口层对超出学期的周次做了边界钳制。
