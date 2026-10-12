# Copies the proxy's CURATOR_KEY from Railway into ~/.void/curator.key, where
# scripts/curator.mjs reads it. Run after the key file is lost (it used to live in
# E:/tmp and was deleted with the temp files). Needs `railway login`.
$ErrorActionPreference = 'Stop'
$dir = Join-Path $HOME '.void'
New-Item -ItemType Directory -Force $dir | Out-Null
Push-Location 'E:\The Void\void-proxy'
try {
  $line = railway variables --kv | Select-String '^CURATOR_KEY='
} finally {
  Pop-Location
}
if (-not $line) { Write-Host 'CURATOR_KEY not found on Railway (is `railway login` done?)'; exit 1 }
$key = $line.Line.Substring('CURATOR_KEY='.Length).Trim()
$file = Join-Path $dir 'curator.key'
Set-Content -Path $file -Value $key -NoNewline -Encoding ascii
$code = try {
  (Invoke-WebRequest -UseBasicParsing -Method Post -Uri 'https://void-proxy-production.up.railway.app/curated/ingest' -Headers @{ 'x-curator-key' = $key } -ContentType 'application/json' -Body '{"generated":"probe","items":"x"}').StatusCode
} catch { [int]$_.Exception.Response.StatusCode }
Write-Host "saved $file ($((Get-Item $file).Length) chars)"
if ($code -eq 401) { Write-Host 'proxy says: bad key (401)' } else { Write-Host "proxy accepts the key (HTTP $code)" }
