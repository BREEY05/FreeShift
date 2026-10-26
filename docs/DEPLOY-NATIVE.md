# FreeShift 原生部署（无 Docker，推荐用于本服务器）

> 适用场景：服务器无法访问 Docker Hub、内存 2GB 左右、已有 Nginx 占用 80/443。
> 本方案不安装 Docker、不改动现有站点，使用独立 Node 24 + systemd + 现有 Nginx 的 8080 端口。
> 已按实际体检结果适配：Ubuntu 24.04 / 2 核 / 1.9G 内存 / 39G 可用磁盘 / 8080 空闲 / 现有 Nginx 占 80、443、3000。

## 0. 架构

~~~text
浏览器 → 宿主机 Nginx:8080 ─┬─ /        /opt/freeshift/apps/web/dist（静态）
                             └─ /api/*   127.0.0.1:3100（FreeShift API）
                                            └─ /data/freeshift/freeshift.db
~~~

- Node 24 安装在 /opt/node24，不覆盖系统或 /var/www 下其他 Node 站点。
- API 只监听 127.0.0.1:3100，不占 3000（已被现有 node 站点占用）。
- 数据与备份在 /data/freeshift，与代码分离，更新代码不影响数据。

## 1. 上传代码

本机（Windows PowerShell，仓库根目录执行）：

~~~powershell
tar --exclude=node_modules --exclude=.git --exclude=data --exclude=.shots -czf freeshift.tgz .
scp freeshift.tgz ubuntu@<服务器IP>:/tmp/
~~~

服务器：

~~~bash
sudo mkdir -p /opt/freeshift /data/freeshift
sudo chown -R ubuntu:ubuntu /opt/freeshift /data/freeshift
tar -xzf /tmp/freeshift.tgz -C /opt/freeshift
ls /opt/freeshift
~~~

也可以先推送到私有 Git 仓库，再在服务器 git clone 到 /opt/freeshift。

## 2. 安装独立 Node 24（不动现有 node）

~~~bash
VER=$(curl -s https://npmmirror.com/mirrors/node/index.json | jq -r '[.[] | select(.version | startswith("v24."))][0].version')
echo "Node 版本: $VER"
cd /tmp
curl -fLO "https://npmmirror.com/mirrors/node/$VER/node-$VER-linux-x64.tar.xz"
sudo mkdir -p /opt/node24
sudo tar -xJf node-$VER-linux-x64.tar.xz -C /opt/node24 --strip-components=1
/opt/node24/bin/node -v
/opt/node24/bin/npm install -g pnpm@11.28.5
/opt/node24/bin/pnpm -v
~~~

验证不影响现有站点：

~~~bash
node -v          # 仍应是系统原有版本
ls /var/www      # 现有站点目录保持不变
~~~

如果 npmmirror 也慢，可在本机下载同版本 linux-x64 压缩包后 scp 上传。

## 3. 构建

~~~bash
cd /opt/freeshift
export PATH=/opt/node24/bin:$PATH
pnpm install --frozen-lockfile
pnpm build
~~~

产物：apps/web/dist（静态站点）。首次安装依赖约 500MB，构建峰值内存约 700MB；服务器已有 1.9G swap，一般可过。若构建被 OOM，加：

~~~bash
NODE_OPTIONS=--max-old-space-size=1024 pnpm build
~~~

## 4. 初始化数据

统一使用环境变量 DATABASE_PATH，避免落到代码目录：

~~~bash
cd /opt/freeshift
export DATABASE_PATH=/data/freeshift/freeshift.db
/opt/node24/bin/node apps/server/src/index.ts
# 看到 listening 后按 Ctrl+C；本次启动已自动建表并写入预设模板与默认学期
~~~

可选：写入 5 位成员的演示数据（真实使用可跳过）：

~~~bash
cd /opt/freeshift
DATABASE_PATH=/data/freeshift/freeshift.db /opt/node24/bin/node apps/server/src/db/seed.ts
~~~

## 5. systemd 服务

~~~bash
sudo cp deploy/native/freeshift-api.service /etc/systemd/system/freeshift-api.service
sudo systemctl daemon-reload
sudo systemctl enable --now freeshift-api
systemctl status freeshift-api --no-pager
curl -s http://127.0.0.1:3100/healthz
~~~

查看日志：

~~~bash
journalctl -u freeshift-api -f
~~~

## 6. 现有 Nginx 增加 8080 站点

生成 Basic Auth 密码（不安装 apache2-utils，直接用 openssl）：

~~~bash
read -r -p "用户名 [freeshift]: " FU; FU=${FU:-freeshift}
read -r -s -p "密码: " FP; echo
printf '%s:%s\n' "$FU" "$(openssl passwd -apr1 "$FP")" | sudo tee /etc/nginx/freeshift.htpasswd
sudo chmod 640 /etc/nginx/freeshift.htpasswd
sudo chown root:www-data /etc/nginx/freeshift.htpasswd
~~~

上部命令注意：如果提示词或复制环境对变量转义敏感，可改用交互方式分别执行：

~~~bash
sudo sh -c 'printf "freeshift:%s\n" "$(openssl passwd -apr1)" > /etc/nginx/freeshift.htpasswd'
# 会提示输入密码两次
~~~

部署配置（仓库内已提供 deploy/native/nginx-freeshift.conf）：

~~~bash
sudo cp deploy/native/nginx-freeshift.conf /etc/nginx/conf.d/freeshift.conf
sudo nginx -t
sudo systemctl reload nginx
~~~

确认静态资源权限（Nginx 以 www-data 读取）：

~~~bash
sudo chmod -R o+rX /opt/freeshift/apps/web/dist
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8080/
~~~

未带认证时返回 401 属正常；带认证测试：

~~~bash
curl -s -u freeshift:<密码> http://127.0.0.1:8080/api/v1/semester | head -c 200; echo
~~~

## 7. 放行 8080

- 腾讯云控制台 → 安全组 → 入站规则放行 TCP 8080。建议来源限制为你自己的出口 IP；确定长期公开再放开。
- 服务器内 iptables 目前只封禁了少量恶意来源的 22 端口，不需要为 8080 额外加规则；若以后启用 ufw：sudo ufw allow 8080/tcp。

## 8. 备份（每日，保留 7 份）

~~~bash
sudo mkdir -p /data/freeshift/backups
sudo chown -R ubuntu:ubuntu /data/freeshift
crontab -e
~~~

加入一行：

~~~cron
30 3 * * * cd /opt/freeshift && DATABASE_PATH=/data/freeshift/freeshift.db BACKUP_DIR=/data/freeshift/backups /opt/node24/bin/node scripts/backup.mjs 7 >> /data/freeshift/backup.log 2>&1
~~~

注意：备份与数据同盘，仍有单盘故障风险；建议再用 rclone / rsync 同步到对象存储或另一台机器。

手动备份：

~~~bash
cd /opt/freeshift && DATABASE_PATH=/data/freeshift/freeshift.db BACKUP_DIR=/data/freeshift/backups /opt/node24/bin/node scripts/backup.mjs 7
~~~

## 9. 更新

~~~bash
# 本机重新打包上传后
cd /opt/freeshift
tar -xzf /tmp/freeshift.tgz --overwrite
export PATH=/opt/node24/bin:$PATH
pnpm install --frozen-lockfile
pnpm build
sudo systemctl restart freeshift-api
~~~

数据在 /data/freeshift，不受代码覆盖影响。

## 10. 之后补 HTTPS（可选）

当前是 http://IP:8080 + Basic Auth，凭据经明文 HTTP 传输，仅适合临时访问或受限来源。三种升级方式：

1. 新子域名（如 freeshift.ainavi.online）：DNS 指向服务器 → 安装 acme.sh/certbot 申请证书 → 在现有 Nginx 加 443 server 块反代 127.0.0.1:8080（或直接托管静态 + 反代 3100）。注意 80 已被现有站点占用，需用 webroot 或 DNS-01 验证。
2. Cloudflare：域名接入 Cloudflare，解析子域名并开启代理（橙云），源站仍走 8080 HTTP，边缘提供 HTTPS；再配合 Cloudflare Access 做登录保护。
3. 内网/VPN 访问：安全组只放行自己，不暴露公网。

## 11. 与 Docker 方案的关系

本项目 Dockerfile / compose 仍然保留，可在能访问镜像源的机器上使用。本服务器因 Docker Hub 超时、内存偏紧，建议优先原生部署；若坚持 Docker，需先配置 registry mirror 或离线导入镜像，细节见 docs/SERVER-CHECK.md 第五节。

## 12. 快速验收清单

- [ ] /opt/node24/bin/node -v 为 v24.x
- [ ] systemctl status freeshift-api 为 active，curl 127.0.0.1:3100/healthz 返回 ok
- [ ] sudo nginx -t 通过，8080 返回 401/登录页
- [ ] 登录后 /api/v1/semester 返回 20 周学期
- [ ] 主界面可切换周次、点击格子看到名单
- [ ] /data/freeshift/freeshift.db 存在，备份 cron 执行后 backups 出现新文件
