# FreeShift 部署前服务器检查

> 目标：在 2 核 2G / 2 核 4G 小服务器上用 Docker + Nginx 部署 FreeShift。
> 本文提供「给 AI 助手的检查提示词」和「人工一键采集脚本」，只读检查，不做任何变更。

## 一、使用方法

1. SSH 登录服务器，确认有 Docker 或 sudo 权限（只读检查不需要 sudo，部分防火墙信息需要）。
2. 把下面「提示词」整段粘贴给服务器上的 AI 助手（如 Claude Code / Codex CLI / Cursor 远程终端）。
3. 或者直接运行仓库里的采集脚本，把输出贴回来：

~~~bash
bash scripts/server-check.sh
~~~

4. 检查只读、无副作用；不要让它执行安装、重启、删文件等操作。

---

## 二、检查提示词（复制给服务器上的 AI 助手）

~~~text
你是我的服务器运维助手。我准备在这台服务器上用 Docker + Nginx 部署一个叫 FreeShift 的小型 Web 项目。
项目情况：Node.js 24 + SQLite 单实例，docker-compose 两个服务（api + nginx），运行内存约 100~200MB，
镜像构建期间约需 1.5~2GB 磁盘和 1GB 左右内存；需要持久化 SQLite 数据并每日备份；
默认对外端口 8080（也可用 80/443）；时区需要 Asia/Shanghai（用于计算“本周”）。

请执行一次“只读体检”：只采集信息、不安装、不启动/停止、不修改任何文件或配置。
任何需要变更的操作（装 docker、改防火墙、建 swap、改端口）请只给出命令和风险，等我确认后再执行。
如果某条命令没有权限或不存在，跳过并说明即可，不要尝试提权安装。

请收集并报告：

1. 系统与硬件
- 发行版与版本、内核版本、CPU 架构（x86_64 还是 arm64）
- CPU 核数；内存总量与当前可用；swap 大小与是否启用
- 根分区、/var/lib/docker 所在分区的可用空间
- 系统时间、时区、NTP 同步状态

2. Docker 环境
- docker 版本、compose 版本（v2 插件或独立 docker-compose）
- docker info 是否正常（Server Version、Storage Driver、Cgroup、Docker Root Dir）
- 当前运行的容器、占用的端口和大致资源
- 能否访问 Docker Hub / npm registry（只做 HEAD 请求，不要 pull 镜像）
- 是否配置了镜像加速或代理

3. 网络与端口
- 80 / 443 / 8080 / 3000 端口是否被监听、被哪个进程占用
- 本机防火墙状态（ufw / firewalld / iptables）与已放行端口
- 是否已有 Nginx / Caddy / Apache 在跑，监听什么端口、有无站点和证书
- 是否有域名解析到本机（可以只回答有/无，不要输出公网 IP）

4. 权限与工具
- 当前用户、是否 Docker 组成员、sudo 是否可用（只检测，不修改）
- git、curl、ss、tar、systemctl 等基础工具是否齐全
- 是否有 systemd（决定容器开机自启方式）
- 是否已存在 freeshift 目录、容器、数据卷或 8080 占用

5. 备份与安全
- 是否有独立磁盘或目录可用于数据与备份（项目需要持久化目录 + 每日备份保留 7 份）
- SSH 端口、是否允许 root 登录、是否密码登录（只报告风险，不要贴任何密钥/密码）
- 是否已有 HTTPS 证书（certbot / 云厂商证书）

6. 结论
按以下 FreeShift 最低要求逐项给 PASS / WARN / FAIL：
- CPU >= 2 核，内存 >= 2GB（推荐 4GB），可用磁盘 >= 10GB
- 内存 2GB 时建议 swap >= 1GB（构建前端依赖时可能用到）
- Docker >= 24 且 compose v2 可用
- 能访问 Docker Hub 与 npm registry（构建需要）
- 计划对外端口（默认 8080）空闲；80/443 可选
- 时区为 Asia/Shanghai 或可设置
- 有持久化目录/卷和备份位置

输出格式：
1) 一张 Markdown 表格：检查项 | 实际值 | 结论(PASS/WARN/FAIL) | 建议
2) 最终结论：可以部署 / 需要先处理
3) 必须处理的问题清单（按优先级，给出具体命令但不执行）
4) 建议部署参数：对外端口、数据目录、内存限制、swap 大小、是否复用已有 Nginx、镜像加速
5) 敏感信息用 <redacted> 代替，不要输出公网 IP、密码、私钥
~~~

---

## 三、FreeShift 部署合格线

| 项目 | 最低 | 推荐 | 说明 |
| --- | --- | --- | --- |
| CPU | 2 核 | 2 核+ | 构建与运行都够用 |
| 内存 | 2GB | 4GB | 运行约 150MB，构建时 pnpm + vite 峰值较高 |
| Swap | 0（2G 内存时建议 1~2GB） | 2GB | 防止构建 OOM |
| 可用磁盘 | 10GB | 20GB+ | 镜像 + 构建缓存约 2~3GB，其余留给数据与备份 |
| Docker | 24+ | 最新稳定版 | 需要 compose v2 插件 |
| 网络 | 能访问 Docker Hub / npm | 配置镜像加速 | 构建阶段必须联网 |
| 端口 | 8080 空闲 | 80/443 + 域名 | 也可接在已有 Nginx 后面 |
| 时区 | 可设 Asia/Shanghai | 系统时区即上海 | compose 已注入 TZ |
| 备份 | 有可写目录/卷 | 独立磁盘或对象存储 | 每日 VACUUM INTO 快照 |

---

## 四、人工一键采集脚本

仓库内已提供 [scripts/server-check.sh](../scripts/server-check.sh)，只读执行：

~~~bash
bash scripts/server-check.sh
~~~

把输出整段贴回来，我可以直接判断能否部署并给出对应参数。

---

## 五、常见不合格项与处理

| 检查结果 | 处理建议 |
| --- | --- |
| 未安装 Docker | 用发行版仓库安装 docker-ce + compose 插件；确认 cgroup v2；安装前先看磁盘与内核 |
| Docker 无法拉镜像 | 配置 registry mirror，或在构建机打包镜像后 docker save/load 到服务器 |
| 内存 2G 且无 swap | 建 1~2GB swapfile 再 build，构建完成后可保留 1GB |
| 磁盘不足 | docker system prune -a、迁移 /var/lib/docker 到大盘、或扩盘 |
| 8080 被占用 | 部署时改 WEB_PORT（如 8090），或停掉冲突服务 |
| 80/443 被现有 Nginx 占用 | 把 compose 的 web 端口改为 127.0.0.1:8080，由宿主 Nginx 反代并复用现有证书 |
| npm 拉取慢 | 构建参数或 .npmrc 配镜像源；Docker build 需要容器内可访问该源 |
| 时区不对 | compose 已设置 TZ=Asia/Shanghai；宿主时区仅影响日志时间 |
| 没有域名/HTTPS | 先用 IP:8080 + Nginx Basic Auth 或 Cloudflare Tunnel；再补证书 |
| 2G 内存构建失败 | 增加 swap；或在本地构建好镜像后导出到服务器加载 |
