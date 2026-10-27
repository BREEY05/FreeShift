# 生成本地离线版（Windows PowerShell）
# 用法：在仓库根目录执行  ./scripts/package-local.ps1
# 产出：dist-local/freeshift-local-<版本>.zip
#       解压后把 Windows 便携版 Node 24 放到 node\ ，双击 start.bat 即可，无需联网、无需 npm install。
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$pkg = Get-Content package.json -Raw | ConvertFrom-Json
$version = $pkg.version
$outDir = Join-Path $root 'dist-local'
$stage = Join-Path $outDir 'stage'
if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
New-Item -ItemType Directory -Path $stage -Force | Out-Null

Write-Host '[1/5] 构建共享包与前端...'
& pnpm build
if ($LASTEXITCODE -ne 0) { throw '构建失败' }

Write-Host '[2/5] 收集程序文件...'
$keep = @(
  'apps/server/src',
  'apps/server/package.json',
  'apps/web/dist',
  'scripts/backup.mjs',
  'docs/LOCAL-OFFLINE.md'
)
foreach ($item in $keep) {
  $src = Join-Path $root $item
  if (-not (Test-Path $src)) { Write-Warning "缺少 $item，跳过"; continue }
  $dst = Join-Path $stage $item
  New-Item -ItemType Directory -Path (Split-Path -Parent $dst) -Force | Out-Null
  if ((Get-Item $src).PSIsContainer) { Copy-Item $src $dst -Recurse -Force }
  else { Copy-Item $src $dst -Force }
}

Write-Host '[3/5] 安装生产依赖（含 @freeshift/shared）...'
$sharedDir = Join-Path $stage 'packages\shared'
New-Item -ItemType Directory -Path $sharedDir -Force | Out-Null
Copy-Item (Join-Path $root 'packages/shared/dist') (Join-Path $sharedDir 'dist') -Recurse -Force
Copy-Item (Join-Path $root 'packages/shared/src') (Join-Path $sharedDir 'src') -Recurse -Force
$sharedPkg = Get-Content (Join-Path $root 'packages/shared/package.json') -Raw | ConvertFrom-Json
$sharedPkg | Add-Member -NotePropertyName version -NotePropertyValue '1.0.0' -Force
$sharedPkg | ConvertTo-Json -Depth 10 | Set-Content (Join-Path $sharedDir 'package.json') -Encoding utf8

$serverPkgPath = Join-Path $stage 'apps\server\package.json'
$serverPkg = Get-Content $serverPkgPath -Raw
$serverPkg = $serverPkg -replace '"@freeshift/shared":\s*"workspace:\*"', '"@freeshift/shared": "file:../../packages/shared"'
Set-Content -Path $serverPkgPath -Value $serverPkg -Encoding utf8

Push-Location (Join-Path $stage 'apps\server')
& pnpm install --prod --config.node-linker=hoisted --ignore-scripts
$code = $LASTEXITCODE
Pop-Location
if ($code -ne 0) { throw '依赖安装失败' }

Write-Host '[4/5] 生成启动脚本与说明...'
$launcher = @'
@echo off
setlocal
cd /d "%~dp0"
set NODE_ENV=production
set PORT=5180
set HOST=127.0.0.1
set DATABASE_PATH=%~dp0data\freeshift.db
if not exist "data" mkdir data
if not exist "node\node.exe" (
  echo [ERROR] node\node.exe not found.
  echo Please unzip Windows portable Node 24 into a folder named "node" here:
  echo   https://nodejs.org/dist/latest-v24.x/   ^(mirror: https://npmmirror.com/mirrors/node/latest-v24.x/^)
  echo See docs\LOCAL-OFFLINE.md for details.
  pause
  exit /b 1
)
echo FreeShift starting ...  http://127.0.0.1:5180
start "" http://127.0.0.1:5180
"node\node.exe" apps\server\src\index.ts
pause
'@
Set-Content -Path (Join-Path $stage 'start.bat') -Value $launcher -Encoding OEM

Write-Host '[5/5] 打包...'
$zip = Join-Path $outDir "freeshift-local-$version.zip"
if (Test-Path $zip) { Remove-Item $zip -Force }
Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $zip -CompressionLevel Optimal
Remove-Item $stage -Recurse -Force
$size = [math]::Round((Get-Item $zip).Length / 1MB, 2)
Write-Host "完成：$zip ($size MB)"
