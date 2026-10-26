param(
  [string]$Output = "freeshift.tgz"
)
$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$root = Split-Path -Parent $PSScriptRoot
Push-Location $root
try {
  if (Test-Path $Output) { Remove-Item $Output -Force }
  tar --exclude=node_modules --exclude=.git --exclude=data --exclude=.shots --exclude=apps/web/dist --exclude=$Output -czf $Output .
  $file = Get-Item $Output
  $hash = (Get-FileHash -Path $Output -Algorithm SHA256).Hash
  Write-Host ""
  Write-Host ("已生成: " + $file.FullName)
  Write-Host ("大小: " + [math]::Round($file.Length / 1MB, 2) + " MB")
  Write-Host ("SHA256: " + $hash)
  Write-Host ""
  Write-Host "上传到服务器（把 <SERVER_IP> 换成你的 IP）:"
  Write-Host ("scp " + $Output + " ubuntu@<SERVER_IP>:/tmp/")
} finally {
  Pop-Location
}
