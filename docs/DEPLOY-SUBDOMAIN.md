# FreeShift 挂载子域名 + HTTPS

> 前置：已按 docs/DEPLOY-NATIVE.md 完成原生部署（API 127.0.0.1:3100 正常、前端 dist 已构建、8080 可访问）。
> 本文把访问地址从 http://IP:8080 升级为 https://<子域名>，并关闭 8080 公网入口。
> 默认子域名示例：freeshift.ainavi.online（换成你自己的）。

## 0. 先确认两件事

1. **DNS**：在域名控制台加一条 A 记录，例如 freeshift.ainavi.online → 服务器公网 IP，TTL 600。
   验证：dig +short freeshift.ainavi.online 应返回服务器 IP。
2. **证书方案**：先看现有证书是否覆盖该子域名（决定了走路线 A 还是 B）。

## 1. 诊断命令（服务器上执行）

~~~bash
# 现有证书覆盖哪些域名（SAN）
for f in /etc/ssl/certs/ainavi.online_chain.crt /etc/nginx/ssl/ainavi.online_bundle.crt; do
  if [ -f "$f" ]; then echo "== $f =="; openssl x509 -in "$f" -noout -subject -ext subjectAltName; fi
done

# 现有站点正在使用的证书路径
grep -rhE 'ssl_certificate(_key)? ' /etc/nginx/sites-enabled/ /etc/nginx/conf.d/ 2>/dev/null | sort -u

# nginx 版本（决定 http2 写法）
nginx -v

# 子域名解析
dig +short freeshift.ainavi.online
~~~

判断：

- SAN 里有 *.ainavi.online（或明确包含 freeshift.ainavi.online）→ **路线 A：复用现有证书**，不用装任何软件。
- 没有覆盖 → **路线 B：用 certbot 免费签发**（apt 安装 certbot，HTTP-01 验证）。
- 域名在 Cloudflare 且开了橙云代理 → 先临时改灰云（DNS only）签发，完成后再开橙云并把 SSL 模式设为 Full (strict)。

## 2. 路线 A：复用现有通配符证书

假设现有证书为 /etc/ssl/certs/xxx_chain.crt、私钥 /etc/ssl/private/xxx.key：

~~~bash
# 备份现有配置（保留时间戳）
sudo cp -a /etc/nginx/conf.d /root/nginx-conf.d.bak-$(date +%Y%m%d%H%M%S)
# 用模板生成新配置（替换 __DOMAIN__/__CERT__/__KEY__）
sudo cp /opt/freeshift/deploy/native/nginx-freeshift-subdomain.conf /etc/nginx/conf.d/freeshift.conf
sudo sed -i 's|__DOMAIN__|freeshift.ainavi.online|g; s|__CERT__|/etc/ssl/certs/xxx_chain.crt|g; s|__KEY__|/etc/ssl/private/xxx.key|g' /etc/nginx/conf.d/freeshift.conf
sudo nginx -t && sudo systemctl reload nginx
~~~

## 3. 路线 B：certbot 签发新证书（推荐，自动续期）

### 3.1 安装 certbot 并准备验证目录

~~~bash
sudo apt-get update
sudo apt-get install -y certbot
sudo mkdir -p /var/www/letsencrypt
sudo chown -R www-data:www-data /var/www/letsencrypt
~~~

### 3.2 先只放 80 端口验证块

编辑 /etc/nginx/conf.d/freeshift.conf，暂时只写 80 端口 server（先不要 443，否则没有证书 nginx -t 会失败）：

~~~nginx
server {
    listen 80;
    server_name freeshift.ainavi.online;

    location /.well-known/acme-challenge/ {
        root /var/www/letsencrypt;
    }

    location / {
        return 301 https://$host$request_uri;
    }
}
~~~

~~~bash
sudo nginx -t && sudo systemctl reload nginx
~~~

### 3.3 签发证书

~~~bash
sudo certbot certonly --webroot -w /var/www/letsencrypt \
  -d freeshift.ainavi.online \
  --email 你的邮箱@example.com --agree-tos --no-eff-email \
  --deploy-hook "systemctl reload nginx"
~~~

成功后证书在：

- /etc/letsencrypt/live/freeshift.ainavi.online/fullchain.pem
- /etc/letsencrypt/live/freeshift.ainavi.online/privkey.pem

### 3.4 换用完整 HTTPS 配置

~~~bash
sudo cp /opt/freeshift/deploy/native/nginx-freeshift-subdomain.conf /etc/nginx/conf.d/freeshift.conf
sudo sed -i 's|__DOMAIN__|freeshift.ainavi.online|g; s|__CERT__|/etc/letsencrypt/live/freeshift.ainavi.online/fullchain.pem|g; s|__KEY__|/etc/letsencrypt/live/freeshift.ainavi.online/privkey.pem|g' /etc/nginx/conf.d/freeshift.conf
sudo nginx -t && sudo systemctl reload nginx
~~~

注意：如果 nginx 版本 >= 1.25.1，把 listen 443 ssl http2; 改成 listen 443 ssl; 并加一行 http2 on;。

### 3.5 续期检查

~~~bash
systemctl list-timers | grep certbot
sudo certbot renew --dry-run
~~~

## 4. 验收

~~~bash
curl -sI http://freeshift.ainavi.online/ | head -3                 # 期望 301 到 https
curl -sI https://freeshift.ainavi.online/ | head -5                # 期望 401（Basic Auth）
curl -s -o /dev/null -w '%{http_code}\n' -u freeshift:<密码> https://freeshift.ainavi.online/        # 200
curl -s -u freeshift:<密码> https://freeshift.ainavi.online/api/v1/semester | jq '.data.semester.totalWeeks'  # 20
echo | openssl s_client -connect freeshift.ainavi.online:443 -servername freeshift.ainavi.online 2>/dev/null | openssl x509 -noout -subject -ext subjectAltName
ss -lntp | grep -E ':80 |:443 '
~~~

浏览器确认：

- 地址栏锁标志正常，无证书警告；
- 登录 Basic Auth 后主界面可用，周次切换、点击格子抽屉正常；
- 开发者工具里 /api 请求为 https 且无 4xx/5xx。

## 5. 收尾

- 在云控制台安全组**关闭 8080**（80/443 保持开放）；服务器上不再有 8080 监听。
- 观察 1~2 天无问题后，再启用 HSTS（取消模板中的注释）。
- 如果后面还要加更多子域名，复制本模板改 __DOMAIN__ 与证书路径即可。
- 备份 cron 与 systemd 服务不受影响。

## 6. 回滚

~~~bash
sudo rm -f /etc/nginx/conf.d/freeshift.conf
sudo cp -a /root/nginx-conf.d.bak-<时间戳>/. /etc/nginx/conf.d/
sudo nginx -t && sudo systemctl reload nginx
# 恢复 8080 访问（旧配置），或继续用 IP:8080
~~~

证书不需要删除；想清理时 sudo certbot delete --cert-name freeshift.ainavi.online。

## 7. 给服务器 AI 的提示词

~~~text
你是我的服务器运维助手。FreeShift 已经按原生方式部署在这台服务器上（API 127.0.0.1:3100，现有 Nginx 在 8080 托管前端并反代 /api，Basic Auth 已启用）。
现在我要把它挂到子域名 freeshift.ainavi.online 上，并启用 HTTPS。

前置事实：Ubuntu 24.04、现有 Nginx 占 80/443、已有站点 ainavi.online / study.ainavi.online / game.ainavi.online 不能动；服务器有 /etc/ssl 下的现有证书；没有 certbot；我有云控制台权限加 DNS 记录与安全组。

硬性约束：
1. 只改 /etc/nginx/conf.d/freeshift.conf（可新增），不要改其他站点配置；每次改前备份 /etc/nginx/conf.d。
2. 不要动 MySQL、SSH、现有 node 站点与系统 node；不要重启服务器。
3. nginx -t 不通过就立即恢复备份并停止。
4. 不输出私钥内容；证书路径可以报告。
5. 没有我的确认，不要动 DNS 与安全组（我在控制台做）。

请按顺序执行：
1) 检查 DNS：dig +short freeshift.ainavi.online 是否已指向本机公网 IP；没有就先停下来让我加 A 记录。
2) 诊断现有证书：openssl x509 -in <现有证书> -noout -subject -ext subjectAltName；列出 nginx 正在使用的证书路径；判断是否覆盖 *.ainavi.online。
3) 如果覆盖，走复用：备份 conf.d，复制 deploy/native/nginx-freeshift-subdomain.conf 到 /etc/nginx/conf.d/freeshift.conf，替换 __DOMAIN__/__CERT__/__KEY__，nginx -t、reload。
4) 如果不覆盖，走 certbot：apt 安装 certbot，建 /var/www/letsencrypt，先只配 80 端口验证块并 reload，然后
   certbot certonly --webroot -w /var/www/letsencrypt -d freeshift.ainavi.online --email <我的邮箱> --agree-tos --no-eff-email --deploy-hook "systemctl reload nginx"
   成功后换成完整 80+443 配置，nginx -t、reload。
5) 验收：http 301 → https；https 无认证返回 401；带认证访问 / 返回 200；/api/v1/semester 返回 20 周；证书 SAN 包含该子域名；8080 已无监听。
6) 报告：证书来源与到期时间、续期方式（systemd timer / certbot renew --dry-run 结果）、需要我在安全组关闭 8080 的事、回滚命令、以及常用变更命令。

如果证书签发失败（HTTP-01 超时/被 Cloudflare 代理拦截），不要反复重试，把 nginx 与 certbot 日志关键行发我，再决定用 DNS-01 还是临时关代理。
~~~
