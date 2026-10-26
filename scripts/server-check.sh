#!/usr/bin/env bash
# FreeShift 部署前只读体检（不做任何修改）
# 用法：bash scripts/server-check.sh
set +e

hr() { printf '\n===== %s =====\n' "$1"; }

hr "系统"
if [ -f /etc/os-release ]; then . /etc/os-release; echo "OS: $PRETTY_NAME"; fi
echo "Kernel: $(uname -srm)"
echo "Arch: $(uname -m)"

hr "CPU / 内存 / Swap"
echo "CPU 核数: $(nproc 2>/dev/null || echo unknown)"
free -h 2>/dev/null
if command -v swapon >/dev/null 2>&1; then swapon --show 2>/dev/null || echo "未启用 swap"; fi

hr "磁盘"
df -h / 2>/dev/null
df -h /var/lib/docker 2>/dev/null

hr "时间与时区"
date 2>/dev/null
timedatectl 2>/dev/null | head -6

hr "Docker"
docker --version 2>/dev/null || echo "Docker 未安装"
docker compose version 2>/dev/null || docker-compose --version 2>/dev/null || echo "Compose 未安装"
docker info --format 'Server {{.ServerVersion}} | Driver {{.Driver}} | Root {{.DockerRootDir}}' 2>/dev/null || echo "Docker daemon 不可用"
docker ps --format 'table {{.Names}} | {{.Ports}} | {{.Status}}' 2>/dev/null

hr "端口占用（80/443/8080/3000）"
ss -lntp 2>/dev/null | grep -E ':(80|443|8080|3000) ' || echo "以上端口均未监听"

hr "防火墙"
if command -v ufw >/dev/null 2>&1; then sudo -n ufw status 2>/dev/null || echo "ufw: 无免密权限或未启用"; fi
if command -v firewall-cmd >/dev/null 2>&1; then sudo -n firewall-cmd --state 2>/dev/null || echo "firewalld: 无免密权限或未启用"; fi

hr "已有 Web 服务器"
for svc in nginx caddy apache2 httpd; do
  if systemctl list-unit-files 2>/dev/null | grep -q "^$svc"; then
    echo "$svc: $(systemctl is-active $svc 2>/dev/null)"
  fi
done

hr "外网连通性"
curl -sI --max-time 8 https://registry-1.docker.io/v2/ 2>/dev/null | head -1
curl -sI --max-time 8 https://registry.npmjs.org/ 2>/dev/null | head -1
curl -sI --max-time 8 https://nodejs.org/ 2>/dev/null | head -1

hr "工具链"
for c in git curl ss systemctl tar rsync; do
  if command -v $c >/dev/null 2>&1; then echo "$c: $(command -v $c)"; else echo "$c: 缺失"; fi
done

hr "当前用户与权限"
id 2>/dev/null
sudo -n true 2>/dev/null && echo "sudo: 免密可用" || echo "sudo: 需要密码或无权限"

hr "FreeShift 相关残留"
ls -ld /opt/freeshift /root/freeshift "$HOME/freeshift" 2>/dev/null
docker volume ls 2>/dev/null | grep -i freeshift || echo "无 freeshift 数据卷"
