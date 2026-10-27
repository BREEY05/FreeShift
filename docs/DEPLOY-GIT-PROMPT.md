# FreeShift 部署提示词（GitHub 拉取 + 子域名 HTTPS）

> 给服务器上的 AI 助手整段复制即可，替代 docs/DEPLOY-PROMPT.md 里的 tarball 方案。
> 默认子域名 freeshift.ainavi.online；请把 <我的邮箱> 替换成真实邮箱（用于 Let's Encrypt 到期提醒）。

```text
你是我的服务器运维助手。请在这台 Ubuntu 24.04 服务器上，用 GitHub 拉取代码的方式部署 FreeShift（空闲排班），然后挂到子域名并启用 HTTPS。

一、项目信息
- 仓库：https://github.com/BREEY05/FreeShift.git（公开仓库，默认分支 main，当前提交 5519c7f）
- 技术栈：pnpm monorepo；后端 Node 24 + Fastify + SQLite（node:sqlite 内置，不需要 sqlite3 命令）；前端 React + Vite，构建产物在 apps/web/dist。
- 单机形态：API 只监听 127.0.0.1:3100；前端静态文件由现有 Nginx 托管并反代 /api；数据文件 /data/freeshift/freeshift.db。
- 目标访问地址：https://freeshift.ainavi.online（若我改成别的子域名，以我说的为准）

二、环境事实（已体检）
- Ubuntu 24.04，2 核 / 1.9G 内存 / 1.9G swap / 39G 可用磁盘，时区 Asia/Shanghai。
- 现有 Nginx 1.24 占用 80、443，已有站点 ainavi.online / study.ainavi.online / game.ainavi.online；现有 node 站点占用 3000、3001、3002。
- MySQL 仅监听 127.0.0.1:3306。8080 空闲。没有 Docker（也不装）。没有 certbot。系统 node 版本不满足要求，不能用来跑本项目。
- 现有证书只覆盖 ainavi.online / www.ainavi.online，不包含子域名，所以必须用 certbot 新签。

三、硬性约束（必须遵守）
1. 只允许改动：/opt/freeshift（代码）、/data/freeshift（数据与备份）、/opt/node24（独立 Node 24）、/etc/systemd/system/freeshift-api.service、/etc/nginx/conf.d/freeshift.conf、/etc/nginx/freeshift.htpasswd、/var/www/letsencrypt、ubuntu 用户 crontab；apt 只允许安装 certbot。
2. 绝对不要改动现有 80/443 站点配置、/var/www 下其他站点、MySQL、SSH 配置；不要动系统 node；不要重启服务器。
3. 不安装 Docker；Node 24 只解压到 /opt/node24，不写 /usr/local、不改 alternatives。
4. 不要修改云厂商安全组与 DNS（我在控制台做）；你只在服务器本地验证。
5. 每次改 Nginx 配置前先备份 /etc/nginx/conf.d 到 /root/nginx-conf.d.bak-<时间戳>；nginx -t 不通过就立即恢复备份并停止后续步骤。
6. 不要把密码、私钥写进日志或聊天记录；最终凭据写入 /root/freeshift-credentials.txt（chmod 600），报告里只告诉我用户名和文件位置。
7. 遇到不确定的选择先问我，不要猜；失败时保留现场、把关键日志行发我，不要反复重试、不要杀别的服务。

四、开工前预检（先只做这一步，报告后等我确认）
a) git ls-remote --heads https://github.com/BREEY05/FreeShift.git；能拉到 main 说明网络通，拉不到就停下报告，不要改用 tarball。
b) df -h / ; free -h ; swapon --show ; nginx -v ; ls /etc/nginx/conf.d/ /etc/nginx/sites-enabled/
c) 确认 8080 空闲（ss -lntp | grep 8080）、/opt/freeshift 与 /data/freeshift 不存在或为空（已存在就停，不要覆盖）。
d) dig +short freeshift.ainavi.online，确认已解析到本机公网 IP；没解析就停下让我添加 A 记录（类型 A、主机记录 freeshift、值 服务器公网 IP、TTL 600；域名若在 Cloudflare，先临时切灰云 DNS only）。
e) 问我：要不要写 5 位成员的演示数据（默认不写）；Basic Auth 用户名默认 freeshift，密码我下一步给你或你自动生成。

五、执行步骤

第 1 步：安装独立 Node 24（固定版本，不取 latest，不覆盖系统 node）
先确认镜像上有没有这个确切版本：
curl -fsI https://npmmirror.com/mirrors/node/v24.11.0/node-v24.11.0-linux-x64.tar.xz | head -1
若返回 200 就按下面执行；返回 404 不要自己挑最新版，把可用的 v24.x 版本列表发我（优先 v24.10.0 / v24.11.0），等我确认。
mkdir -p /tmp/freeshift-setup && cd /tmp/freeshift-setup
F=node-v24.11.0-linux-x64.tar.xz
curl -fLO "https://npmmirror.com/mirrors/node/v24.11.0/$F" || curl -fLO "https://nodejs.org/dist/v24.11.0/$F"
sudo mkdir -p /opt/node24 && sudo tar -xJf "$F" -C /opt/node24 --strip-components=1
sudo chown -R ubuntu:ubuntu /opt/node24
/opt/node24/bin/node -v          # 必须精确输出 v24.11.0
/opt/node24/bin/node -e "const {DatabaseSync}=require('node:sqlite');new DatabaseSync(':memory:');console.log('sqlite-ok')"
/opt/node24/bin/npm install -g pnpm@11.28.5
/opt/node24/bin/pnpm -v          # 必须精确输出 11.28.5
不要用 apt 装 nodejs，不要写 /usr/local，不要改 alternatives，不要改全局默认 node：系统 node 必须保持 v20.20.2 供现有站点使用。/opt/node24 只通过 PATH 前缀与 systemd ExecStart 绝对路径使用。
两种下载源都失败就停止并告诉我，绝对不要用系统 node 顶替。

第 2 步：拉代码并构建
sudo mkdir -p /opt/freeshift /data/freeshift /data/freeshift/backups
sudo chown -R ubuntu:ubuntu /opt/freeshift /data/freeshift
git clone https://github.com/BREEY05/FreeShift.git /opt/freeshift
cd /opt/freeshift && git log --oneline -1
export PATH=/opt/node24/bin:$PATH
pnpm install --frozen-lockfile
NODE_OPTIONS=--max-old-space-size=1024 pnpm build
ls -l apps/web/dist/index.html
构建 OOM 或失败：保留现场，把最后 30 行日志发我，不要反复重试、不要杀现有进程。
构建完成后通读 /opt/freeshift/docs 与 deploy/native 下的文件；与本提示词冲突时以本提示词为准。

第 3 步：systemd 服务
sudo cp /opt/freeshift/deploy/native/freeshift-api.service /etc/systemd/system/freeshift-api.service
sudo systemctl daemon-reload
sudo systemctl enable --now freeshift-api
sleep 2 && systemctl --no-pager --full status freeshift-api | head -20
curl -s http://127.0.0.1:3100/healthz
失败就 journalctl -u freeshift-api -n 50 --no-pager 发我并暂停，不要继续 Nginx。

第 4 步：演示数据（仅当我选“是”）
cd /opt/freeshift && DATABASE_PATH=/data/freeshift/freeshift.db /opt/node24/bin/node apps/server/src/db/seed.ts

第 5 步：Basic Auth
sudo cp -a /etc/nginx/conf.d /root/nginx-conf.d.bak-$(date +%Y%m%d%H%M%S)
AUTH_USER=freeshift
AUTH_PASS=$(openssl rand -hex 12)
sudo AUTH_USER="$AUTH_USER" AUTH_PASS="$AUTH_PASS" sh -c 'printf "%s:%s\n" "$AUTH_USER" "$(openssl passwd -apr1 "$AUTH_PASS")" > /etc/nginx/freeshift.htpasswd'
sudo chown root:www-data /etc/nginx/freeshift.htpasswd && sudo chmod 640 /etc/nginx/freeshift.htpasswd
sudo AUTH_USER="$AUTH_USER" AUTH_PASS="$AUTH_PASS" sh -c 'printf "url=https://freeshift.ainavi.online\nuser=%s\npass=%s\n" "$AUTH_USER" "$AUTH_PASS" > /root/freeshift-credentials.txt'
sudo chmod 600 /root/freeshift-credentials.txt
unset AUTH_PASS
sudo chmod -R o+rX /opt/freeshift/apps/web/dist
sudo chmod o+x /opt/freeshift /opt/freeshift/apps
sudo -u www-data test -r /opt/freeshift/apps/web/dist/index.html && echo www-data-readable-ok

第 6 步：先只放 80 端口验证块，再用 certbot 签发
sudo apt-get update && sudo apt-get install -y certbot
sudo mkdir -p /var/www/letsencrypt && sudo chown -R www-data:www-data /var/www/letsencrypt
cat <<'EOF' | sudo tee /etc/nginx/conf.d/freeshift.conf
server {
    listen 80;
    server_name freeshift.ainavi.online;
    location /.well-known/acme-challenge/ { root /var/www/letsencrypt; }
    location / { return 301 https://$host$request_uri; }
}
EOF
sudo nginx -t && sudo systemctl reload nginx
sudo certbot certonly --webroot -w /var/www/letsencrypt -d freeshift.ainavi.online --email <我的邮箱> --agree-tos --no-eff-email --deploy-hook "systemctl reload nginx"
证书应出现在 /etc/letsencrypt/live/freeshift.ainavi.online/{fullchain.pem,privkey.pem}。
HTTP-01 失败（超时或被 Cloudflare 代理拦）时不要反复重试：把 nginx error.log 与 certbot 输出关键行发我，再决定走 DNS-01 还是让我临时关代理。

第 7 步：换成完整 80+443 配置
sudo cp /opt/freeshift/deploy/native/nginx-freeshift-subdomain.conf /etc/nginx/conf.d/freeshift.conf
sudo sed -i 's|__DOMAIN__|freeshift.ainavi.online|g; s|__CERT__|/etc/letsencrypt/live/freeshift.ainavi.online/fullchain.pem|g; s|__KEY__|/etc/letsencrypt/live/freeshift.ainavi.online/privkey.pem|g' /etc/nginx/conf.d/freeshift.conf
sudo nginx -t && sudo systemctl reload nginx
（若 nginx >= 1.25.1，把 listen 443 ssl http2; 改成 listen 443 ssl; 并加 http2 on;）

第 8 步：验收（逐条把结果贴给我）
curl -sI http://freeshift.ainavi.online/ | head -3                                              # 期望 301
curl -sI https://freeshift.ainavi.online/ | head -5                                             # 期望 401
curl -s -o /dev/null -w '%{http_code}\n' -u freeshift:<密码> https://freeshift.ainavi.online/   # 期望 200
curl -s -u freeshift:<密码> https://freeshift.ainavi.online/api/v1/semester | head -c 300        # 期望 totalWeeks 20
curl -sI https://freeshift.ainavi.online/api/v1/meta | head -3                                  # 期望 401
echo | openssl s_client -connect freeshift.ainavi.online:443 -servername freeshift.ainavi.online 2>/dev/null | openssl x509 -noout -subject -dates -ext subjectAltName
ss -lntp | grep -E ':80 |:443 |:8080 |:3100 '
sudo certbot renew --dry-run
systemctl show freeshift-api -p MemoryCurrent
期望：301 / 401 / 200、totalWeeks=20、证书 SAN 含该子域名、80 与 443 由 nginx 监听、8080 无监听、3100 只监听 127.0.0.1。

第 9 步：备份 cron（幂等）
( crontab -l 2>/dev/null | grep -v 'freeshift/scripts/backup.mjs' ; echo "30 3 * * * cd /opt/freeshift && DATABASE_PATH=/data/freeshift/freeshift.db BACKUP_DIR=/data/freeshift/backups /opt/node24/bin/node scripts/backup.mjs 7 >> /data/freeshift/backup.log 2>&1" ) | crontab -
crontab -l | tail -3
cd /opt/freeshift && DATABASE_PATH=/data/freeshift/freeshift.db BACKUP_DIR=/data/freeshift/backups /opt/node24/bin/node scripts/backup.mjs 7
ls -lh /data/freeshift/backups

六、报告要求
1. 状态表：Node / 服务 / Nginx / API / HTTPS / 证书 / 数据库 / 备份，逐项 OK 或失败原因。
2. 证书：来源、到期日期、续期方式（certbot timer 是否存在、dry-run 结果）。
3. 凭据：用户名 + /root/freeshift-credentials.txt 位置（不要贴完整密码）。
4. 常用命令：重启服务、看日志、更新代码、手动备份。
5. 资源占用：MemoryCurrent、磁盘增量。
6. 需要我在控制台做的事：Cloudflare 若切过灰云要改回橙云并把 SSL 模式设为 Full (strict)；安全组关闭 8080；观察 1~2 天后再启用 HSTS；建议关掉 SSH 密码登录。
7. 未完成事项与风险。

七、更新流程（部署成功后写进报告备用）
cd /opt/freeshift && git pull --ff-only && PATH=/opt/node24/bin:$PATH pnpm install --frozen-lockfile && PATH=/opt/node24/bin:$PATH NODE_OPTIONS=--max-old-space-size=1024 pnpm build && sudo systemctl restart freeshift-api

八、回滚
sudo systemctl disable --now freeshift-api
sudo rm -f /etc/nginx/conf.d/freeshift.conf
sudo cp -a /root/nginx-conf.d.bak-<时间戳>/. /etc/nginx/conf.d/
sudo nginx -t && sudo systemctl reload nginx
保留 /opt/freeshift 与 /data/freeshift 供排查；删除 /opt/node24 或卸载 certbot 前先问我；证书可用 sudo certbot delete --cert-name freeshift.ainavi.online 清理。

请先只做“四、开工前预检”，把结果发我，等我确认后从第 1 步依次执行；每完成一步贴一次关键输出。
```
