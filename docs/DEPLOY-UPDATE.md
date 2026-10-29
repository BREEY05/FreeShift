# FreeShift 服务器更新说明（发布包方式）

> 适用：线上 https://freeshift.ainavi.online ，systemd 单元 `freeshift-api`，代码在 `/opt/freeshift`。

## 为什么不再在服务器上 pnpm install + pnpm build

- 服务器 2C2G，每次更新都装一遍依赖 + 跑 vite 构建，慢且容易 OOM；
- 前端 `apps/web/dist` 是构建产物，不构建就没有新页面；
- 发布包已把「代码 + 生产依赖 + 前端产物」全部打齐，服务器只需解压 + 重启。

## 一次性准备（每个环境只做一次）

1. Nginx：让站点根目录直接走 API 进程托管的静态文件（避免两台机器的静态目录不同步）。

   `/etc/nginx/sites-enabled/freeshift.conf` 的 443 server 里，把 `root /opt/freeshift/apps/web/dist;` 保留不动即可；
   若要改成反代全部流量，可把 443 的 `location /` 改成：

   ~~~nginx
   location / { proxy_pass http://127.0.0.1:3100; }
   ~~~

2. systemd 单元加一行环境变量（本仓库里的 `deploy/native/freeshift-api.service` 已包含）：

   ~~~ini
   Environment=SERVE_STATIC=/opt/freeshift/apps/web/dist
   ~~~

   之后 API 进程自己也会托管前端，Nginx 的静态目录与它指向同一份文件。

## 每次更新（3 条命令）

本机（Windows，仓库根目录）：

~~~powershell
./scripts/package-release-api.ps1
scp dist-release/freeshift-api-server.tgz ubuntu@<服务器IP>:/tmp/
~~~

服务器：

~~~bash
sudo systemctl stop freeshift-api
sudo tar -xzf /tmp/freeshift-api-server.tgz -C /opt/freeshift
sudo chown -R ubuntu:ubuntu /opt/freeshift
sudo systemctl start freeshift-api
systemctl is-active freeshift-api
curl -s https://freeshift.ainavi.online/healthz
~~~

> 数据库在 `/data/freeshift/freeshift.db`，不在 `/opt/freeshift` 里，覆盖代码不会碰到数据。
> 解压前建议备份一次：`cp /data/freeshift/freeshift.db /data/freeshift/freeshift.db.bak-$(date +%F)`。

## 回滚

把上一个发布包解压回去再重启即可；发布包保留在本机 `dist-release/` 和 `BUILD_INFO.txt`（含构建时间与版本号）。

~~~bash
sudo systemctl stop freeshift-api
sudo tar -xzf /tmp/freeshift-api-server-previous.tgz -C /opt/freeshift
sudo systemctl start freeshift-api
~~~

## 如果你更想保留 git pull

仍可用旧方式（需要构建）：

~~~bash
cd /opt/freeshift
git pull --ff-only
pnpm install --frozen-lockfile
NODE_OPTIONS=--max-old-space-size=1024 pnpm build
sudo systemctl restart freeshift-api
~~~

注意：**必须先 build 再重启**，否则前端仍是旧产物；服务是 systemd 不是 pm2，重启命令是 `systemctl restart freeshift-api`。
