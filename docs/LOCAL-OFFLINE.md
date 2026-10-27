# FreeShift 离线本地版

> 解压即用，不联网、不装 Node、不装数据库。数据存在本地 `data/freeshift.db`，删掉这个文件就重置。

## 一次准备（只做一次）

1. 下载 Windows 便携版 Node 24（选 v24 的 x64 zip）：
   https://nodejs.org/dist/latest-v24.x/
   例如 `node-v24.11.0-win-x64.zip`（`nodejs.org` 打不开可用镜像 https://npmmirror.com/mirrors/node/latest-v24.x/）
2. 解压后把里面的文件夹**重命名为 `node`**，放到本目录下，要求存在 `node\node.exe`。

目录结构应该是：

```
freeshift-local/
  start.bat
  node\node.exe                  <- 你手动放的
  apps\server\src\
  apps\server\node_modules\      <- 依赖已随包附带，不用 npm install
  apps\web\dist\
  packages\shared\
  data\                          <- 首次启动自动创建
```

## 启动

双击 `start.bat`。浏览器会自动打开 http://127.0.0.1:5180 。
黑窗口不要关，关掉就停止服务。

- 改端口：右键编辑 `start.bat`，改 `set PORT=5180` 那一行。
- 局域网共享（手机/另一台电脑访问）：把 `set HOST=127.0.0.1` 改成 `set HOST=0.0.0.0`，
  然后访问 http://<你的电脑IP>:5180 （注意 Windows 防火墙要放行）。

## 数据与备份

- 数据库：`data\freeshift.db`（SQLite 单文件）
- 备份：直接复制这个文件即可。建议定期复制一份到别的目录或网盘。
- 重置：关闭程序，删除 `data` 文件夹，下次启动自动建库并写入默认模板与学期。

## 和线上版的关系

- 两个版本共用同一套接口与数据结构。
- 线上版：https://freeshift.ainavi.online （Nginx 托管前端，API 在 127.0.0.1:3100）
- 本地版：一个 node 进程同时提供页面和 API，端口 5180，纯本机。
- CSV 导出/导入两边通用，可以用来互相搬运数据。

## 常见问题

**双击后提示未找到 node\node.exe**
说明 Node 便携版没放对位置，见上面“一次准备”。

**提示端口被占用**
改 `start.bat` 里的 `set PORT=` 为 5181 或别的空闲端口。

**杀毒软件报警**
`start.bat` 会启动本地的 node 程序，属正常行为；介意可先手动运行
`node\node.exe apps\server\src\index.ts` 看看。