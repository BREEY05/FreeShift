# FreeShift 原生部署执行提示词（给服务器上的 AI 助手）

> 前置：本机已生成 freeshift.tgz 并上传到服务器 /tmp/freeshift.tgz。
> 本提示词按实际体检结果编写：Ubuntu 24.04 / 2 核 / 1.9G 内存 / 39G 可用 / 现有 Nginx 占 80、443、3000 / 8080 空闲。
> 目标：不装 Docker，Node 24 放在 /opt/node24，API 监听 127.0.0.1:3100，现有 Nginx 在 8080 托管前端并反代 /api。

## 本机打包上传

PowerShell（仓库根目录）：

~~~powershell
./scripts/package-release.ps1
scp freeshift.tgz ubuntu@<服务器IP>:/tmp/
~~~

## 提示词正文（整段复制给服务器上的 AI）

~~~text
你是我的服务器运维助手。请在这台 Ubuntu 24.04 服务器上原生部署 FreeShift。
代码包已上传到 /tmp/freeshift.tgz（由我的 Windows 本机打包，含 docs/ 与 deploy/native/）。
环境事实：2 核 / 1.9G 内存 / 1.9G swap / 39G 可用磁盘 / 时区 Asia/Shanghai；
现有 Nginx 占用 80、443；现有 node 站点占用 3000、3001、3002；MySQL 仅监听 127.0.0.1:3306；8080 空闲。
FreeShift 是 Node 24 + SQLite 单机应用：API 只监听 127.0.0.1:3100，前端静态文件由现有 Nginx 在 8080 托管并反代 /api，数据在 /data/freeshift。

硬性约束（必须遵守）：
1. 只允许改动：/opt/freeshift（代码）、/data/freeshift（数据/备份）、/opt/node24（独立 Node）、/etc/systemd/system/freeshift-api.service、/etc/nginx/conf.d/freeshift.conf、/etc/nginx/freeshift.htpasswd、ubuntu 用户的 crontab。
2. 绝对不要修改现有 Nginx 的 80/443 站点、/var/www 下的 node 站点、MySQL、SSH 配置；不要动系统 node（PATH 里的 node 保持原样）。
3. 不安装 Docker，不 apt 安装任何软件；Node 24 只解压到 /opt/node24，不写入 /usr/local。
4. 不修改云厂商安全组（8080 由我在控制台放行）；本次只在服务器本地验证。
5. 每次改 Nginx 前先备份；nginx -t 不通过就恢复并停止后续步骤。
6. 不把密码、私钥写进日志；最终凭据写入 /root/freeshift-credentials.txt（chmod 600）并只展示一次。
7. 遇到不确定的选择先问我，不要猜；失败时保留现场并报告，不要反复重试、不要杀其他服务、不要重启服务器。

开工前先做预检并回答我：
a) 检查 /tmp/freeshift.tgz 是否存在且能解压，计算并报告 SHA256。
b) 确认 8080 空闲、/opt/freeshift 与 /data/freeshift 不存在或为空；已存在则停止并报告，不要覆盖。
c) 报告 df -h / 与 free -h；若可用内存 < 900MB 且 swap 已用超过 1G，先提醒风险再继续。
d) 告诉我你准备使用的 Basic Auth 用户名（默认 freeshift），密码我会在下一步给你；若我希望自动生成，则用 openssl rand -hex 12 生成。
e) 问我要不要写入 5 位成员的演示数据（默认不写）。

执行步骤：

1. 解压与权限
sudo mkdir -p /opt/freeshift /data/freeshift /data/freeshift/backups
sudo chown -R ubuntu:ubuntu /opt/freeshift /data/freeshift
sudo tar -xzf /tmp/freeshift.tgz -C /opt/freeshift
ls /opt/freeshift
然后阅读 /opt/freeshift/docs/DEPLOY-NATIVE.md 与 deploy/native/ 下两个模板；如与本提示词冲突，以本提示词为准。

2. 安装 Node 24（独立目录，不覆盖系统 node）
VER=$(curl -s https://npmmirror.com/mirrors/node/index.json | jq -r '[.[] | select(.version | startswith("v24."))][0].version')
echo "准备安装 Node $VER"
cd /tmp && curl -fLO "https://npmmirror.com/mirrors/node/$VER/node-$VER-linux-x64.tar.xz"
sudo mkdir -p /opt/node24
sudo tar -xJf node-$VER-linux-x64.tar.xz -C /opt/node24 --strip-components=1
sudo chown -R ubuntu:ubuntu /opt/node24
/opt/node24/bin/node -v
/opt/node24/bin/npm install -g pnpm@11.28.5
/opt/node24/bin/pnpm -v
/opt/node24/bin/node -e "const {DatabaseSync}=require('node:sqlite'); console.log('sqlite-ok')"
如果 npmmirror 下载失败，尝试 https://nodejs.org/dist/$VER/node-$VER-linux-x64.tar.xz；都失败就停止并告诉我，不要用系统 node 替代。

3. 构建（在服务器上）
cd /opt/freeshift
export PATH=/opt/node24/bin:$PATH
pnpm install --frozen-lockfile
NODE_OPTIONS=--max-old-space-size=1024 pnpm build
如果构建 OOM 或失败：保留现场，把最后 30 行日志发我，不要杀现有进程、不要反复重试。

4. 安装并启动 systemd 服务
sudo cp /opt/freeshift/deploy/native/freeshift-api.service /etc/systemd/system/freeshift-api.service
sudo systemctl daemon-reload
sudo systemctl enable --now freeshift-api
sleep 2
systemctl --no-pager --full status freeshift-api | head -20
curl -s http://127.0.0.1:3100/healthz
如果失败：journalctl -u freeshift-api -n 50 --no-pager 发我，然后暂停，不要继续 Nginx。

5. 演示数据（仅当我在预检里选择“是”）
cd /opt/freeshift && DATABASE_PATH=/data/freeshift/freeshift.db /opt/node24/bin/node apps/server/src/db/seed.ts

6. Basic Auth 与 Nginx
sudo cp -a /etc/nginx/conf.d /root/nginx-conf.d.bak-$(date +%Y%m%d%H%M%S)
AUTH_USER=freeshift
AUTH_PASS=$(openssl rand -hex 12)
sudo AUTH_USER="$AUTH_USER" AUTH_PASS="$AUTH_PASS" sh -c 'printf "%s:%s
" "$AUTH_USER" "$(openssl passwd -apr1 "$AUTH_PASS")" > /etc/nginx/freeshift.htpasswd'
sudo chown root:www-data /etc/nginx/freeshift.htpasswd
sudo chmod 640 /etc/nginx/freeshift.htpasswd
sudo AUTH_USER="$AUTH_USER" AUTH_PASS="$AUTH_PASS" sh -c 'printf "user=%s
pass=%s
" "$AUTH_USER" "$AUTH_PASS" > /root/freeshift-credentials.txt'
sudo chmod 600 /root/freeshift-credentials.txt
sudo cp /opt/freeshift/deploy/native/nginx-freeshift.conf /etc/nginx/conf.d/freeshift.conf
sudo chmod -R o+rX /opt/freeshift/apps/web/dist
sudo chmod o+x /opt/freeshift /opt/freeshift/apps
sudo -u www-data test -r /opt/freeshift/apps/web/dist/index.html && echo "www-data-readable-ok"
sudo nginx -t
如 nginx -t 失败：删除新配置、恢复备份、reload，然后停止并报告。

7. 本地验收（安全组放行前）
curl -s -o /dev/null -w 'no-auth=%{http_code}
' http://127.0.0.1:8080/
curl -s -o /dev/null -w 'auth=%{http_code}
' -u "$AUTH_USER:$AUTH_PASS" http://127.0.0.1:8080/
curl -s -u "$AUTH_USER:$AUTH_PASS" http://127.0.0.1:8080/api/v1/semester | jq '.data.semester.totalWeeks'
curl -s -u "$AUTH_USER:$AUTH_PASS" http://127.0.0.1:8080/ | grep -o '<title>[^<]*</title>'
ss -lntp | grep 8080
systemctl show freeshift-api -p MemoryCurrent
期望：no-auth=401，auth=200，totalWeeks=20，标题为 FreeShift · 空闲排班，8080 由 nginx 监听。
注意：AUTH_PASS 只在当前 shell；结束时 unset AUTH_PASS，不要写进 shell history 或日志。

8. 备份 cron（幂等）
( crontab -l 2>/dev/null | grep -v 'freeshift/scripts/backup.mjs' ; echo "30 3 * * * cd /opt/freeshift && DATABASE_PATH=/data/freeshift/freeshift.db BACKUP_DIR=/data/freeshift/backups /opt/node24/bin/node scripts/backup.mjs 7 >> /data/freeshift/backup.log 2>&1" ) | crontab -
crontab -l | tail -3
cd /opt/freeshift && DATABASE_PATH=/data/freeshift/freeshift.db BACKUP_DIR=/data/freeshift/backups /opt/node24/bin/node scripts/backup.mjs 7
ls -lh /data/freeshift/backups

9. 输出报告
- 状态表：服务 / Nginx / API / 前端 / 数据库 / 备份
- 访问地址：http://<服务器公网IP>:8080 （提醒我需要在安全组放行 8080）
- 凭据文件位置 /root/freeshift-credentials.txt（不要在报告里重复完整密码）
- 常用命令：重启、日志、更新、手动备份
- 资源占用：systemd MemoryCurrent、磁盘增量
- 未完成事项：安全组放行、HTTPS、SSH 加固、异地备份
- 回滚命令

回滚（部署失败时）：
sudo systemctl disable --now freeshift-api
sudo rm -f /etc/nginx/conf.d/freeshift.conf
sudo cp -a /root/nginx-conf.d.bak-<时间戳>/. /etc/nginx/conf.d/
sudo nginx -t && sudo systemctl reload nginx
保留 /opt/freeshift 与 /data/freeshift 供排查；删除 /opt/node24 前先问我。
~~~
