# Build the server release bundle (run from repo root on Windows)
# Usage: powershell -File scripts/package-release-api.ps1
# Output: dist-release/freeshift-api-server.tgz
# Server: extract into /opt/freeshift, no pnpm install and no build needed
#   mkdir -p /opt/freeshift && tar -xzf freeshift-api-server.tgz -C /opt/freeshift
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$version = (Get-Content package.json -Raw | ConvertFrom-Json).version
$outDir = Join-Path $root 'dist-release'
$stage = Join-Path $outDir 'stage'
$tar = Join-Path $outDir 'freeshift-api-server.tgz'
New-Item -ItemType Directory -Path $outDir -Force | Out-Null
if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }

Write-Host '[1/3] build shared + web'
& pnpm build
if ($LASTEXITCODE -ne 0) { throw 'build failed' }

Write-Host '[2/3] stage runtime files'
New-Item -ItemType Directory -Path $stage -Force | Out-Null
& pnpm --filter @freeshift/server deploy --prod --legacy --config.node-linker=hoisted (Join-Path $stage 'apps/server')
if ($LASTEXITCODE -ne 0) { throw 'pnpm deploy failed' }
# drop test/build-only files
foreach ($drop in @('test', 'vitest.config.ts', 'tsconfig.json')) {
  $p = Join-Path $stage "apps/server/$drop"
  if (Test-Path $p) { Remove-Item $p -Recurse -Force }
}
New-Item -ItemType Directory -Path (Join-Path $stage 'apps/web') -Force | Out-Null
Copy-Item (Join-Path $root 'apps/web/dist') (Join-Path $stage 'apps/web/dist') -Recurse -Force
foreach ($item in @('deploy/native/freeshift-api.service', 'docs/DEPLOY-UPDATE.md')) {
  if (-not (Test-Path (Join-Path $root $item))) { continue }
  $dst = Join-Path $stage $item
  New-Item -ItemType Directory -Path (Split-Path -Parent $dst) -Force | Out-Null
  Copy-Item (Join-Path $root $item) $dst -Force
}
"build=$version  $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')" | Set-Content (Join-Path $stage 'BUILD_INFO.txt') -Encoding utf8

Write-Host '[3/3] 打包...'
if (Test-Path $tar) { Remove-Item $tar -Force }
tar -czf $tar -C $stage .
if ($LASTEXITCODE -ne 0) { throw 'tar failed' }
Remove-Item $stage -Recurse -Force
$hash = (Get-FileHash $tar -Algorithm SHA256).Hash
$size = [math]::Round((Get-Item $tar).Length / 1MB, 2)
Write-Host "done: $tar ($size MB)"
Write-Host "SHA256: $hash"
