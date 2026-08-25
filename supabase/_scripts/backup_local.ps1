<#
  VitalSync - Backup dos dados locais (DEV LOCAL).
  Salva auth.users + auth.identities + TODO o schema public num arquivo .sql.

  Uso:
    ./backup_local.ps1                       # salva em supabase/_backups/ com timestamp
    ./backup_local.ps1 -OutFile C:\tmp\x.sql # salva onde voce quiser
    ./backup_local.ps1 -Container supabase_db_VitalSync

  Requer: Docker Desktop com o banco local do Supabase de pe (supabase start).
#>
param(
  [string]$Container = "",
  [string]$OutFile   = ""
)
$ErrorActionPreference = "Stop"

function Get-DbContainer([string]$name) {
  if ($name) { return $name }
  $c = docker ps --filter "name=supabase_db_" --format "{{.Names}}" | Select-Object -First 1
  if (-not $c) { throw "Container do banco nao encontrado. O Supabase local esta de pe? (supabase start)" }
  return $c
}

$Container  = Get-DbContainer $Container
$scriptDir  = Split-Path -Parent $MyInvocation.MyCommand.Path
$backupDir  = Join-Path $scriptDir "..\_backups"
New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
if (-not $OutFile) { $OutFile = Join-Path $backupDir "vitalsync_local_$stamp.sql" }

Write-Host "-> Backup do container '$Container'..." -ForegroundColor Cyan
docker exec $Container pg_dump -U postgres -d postgres `
  --data-only `
  -t 'public.*' -t 'auth.users' -t 'auth.identities' `
  -f /tmp/vsbackup.sql
if ($LASTEXITCODE -ne 0) { throw "pg_dump falhou (exit $LASTEXITCODE)." }

docker cp "${Container}:/tmp/vsbackup.sql" $OutFile
docker exec $Container rm -f /tmp/vsbackup.sql
Copy-Item $OutFile (Join-Path $backupDir "latest.sql") -Force

Write-Host "OK Backup salvo em: $OutFile" -ForegroundColor Green
Write-Host "   (copia em _backups\latest.sql - usada pelo restore por padrao)"
