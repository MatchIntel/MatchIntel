$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$client = Join-Path $root "client"
$artifacts = Join-Path $root "artifacts"
$temp = Join-Path $artifacts "MatchIntel.zip"
$opk = Join-Path $artifacts "MatchIntel.opk"
New-Item -ItemType Directory -Force -Path $artifacts | Out-Null
Remove-Item $temp,$opk -Force -ErrorAction SilentlyContinue
Compress-Archive -Path "$client\*" -DestinationPath $temp -CompressionLevel Optimal
Rename-Item $temp $opk
Write-Host "Created $opk" -ForegroundColor Green
