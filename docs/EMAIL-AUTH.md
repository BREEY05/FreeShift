# 邮箱注册与设备登录

Web 版默认启用邮箱登录。输入邮箱并获取六位验证码，首次验证成功自动注册；已有账户在新设备上也要验证。当前浏览器保持登录 30 天，退出、清除 Cookie 或过期后需重新验证。所有注册邮箱访问现有共享排班空间，排班成员与登录账户独立。

验证码有效期 10 分钟，60 秒重发间隔，每邮箱每小时最多 5 封、每来源 IP 每小时最多 20 封，连续输错 5 次失效。验证码与会话令牌仅以哈希形式保存；会话 Cookie 使用 HttpOnly、SameSite=Lax，生产环境启用 Secure。

## 服务器升级

先备份数据库，再执行：

```bash
cd /opt/freeshift
export PATH=/opt/node24/bin:$PATH
git pull --ff-only
pnpm install --frozen-lockfile
NODE_OPTIONS=--max-old-space-size=1024 pnpm build
sudo install -m 600 -o root -g root /dev/null /data/freeshift/auth.env
sudoedit /data/freeshift/auth.env
```

若配置文件已经存在，先备份并编辑，不能用 install 清空它。写入以下配置，SMTP_PASS 填 QQ 邮箱设置里取得的 SMTP 授权码，不能填 QQ 登录密码：

```dotenv
AUTH_ENABLED=true
APP_ORIGIN=https://freeshift.ainavi.online
AUTH_COOKIE_SECURE=true
SMTP_HOST=smtp.qq.com
SMTP_PORT=465
SMTP_USER=380154843@qq.com
SMTP_FROM=380154843@qq.com
SMTP_PASS=填写授权码
```

密钥不提交 Git、不贴到日志；不使用 Nginx Basic Auth。systemd 服务模板已增加 EnvironmentFile=-/data/freeshift/auth.env。现有服务如有自定义参数，只添加 EnvironmentFile 行，保留其他配置。

```bash
sudo cp deploy/native/freeshift-api.service /etc/systemd/system/freeshift-api.service
sudo systemctl daemon-reload
sudo systemctl restart freeshift-api
curl -fsS http://127.0.0.1:3100/healthz
curl -s https://freeshift.ainavi.online/api/v1/auth/session
curl -s -o /dev/null -w '%{http_code}\n' https://freeshift.ainavi.online/api/v1/users
```

预期：healthz 正常；session 返回 enabled:true,email:null；未登录 users 返回 401。浏览器输入收件邮箱，实际验证收信、错误验证码被拒绝、正确验证码进入、刷新保留登录、退出后 API 返回 401。自动新增 auth_account/auth_otp/auth_session/auth_rate_limit 表，不清空已有排班数据。

## 开发与离线版

本机根目录 .env 可配置 SMTP（已被忽略），参考 .env.example。开发时 APP_ORIGIN 必须等于浏览器实际源地址，localhost 与 127.0.0.1 不同。

离线打包启动器显式设置 AUTH_ENABLED=false，保持断网可用，不带 SMTP 密钥。历史 v1.0.0 Release 不受本次更新影响。
