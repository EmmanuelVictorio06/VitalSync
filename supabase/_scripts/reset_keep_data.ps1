<#
  VitalSync - Reset que PRESERVA seus dados locais.
  Faz, em sequencia:  1) backup  ->  2) supabase db reset  ->  3) restore.
  Resultado: migrations reaplicadas do zero, MAS seu login e seus pacientes
  ficticios continuam la.

  Uso (na raiz do repo ou em qualquer lugar):
    ./supabase/_scripts/reset_keep_data.ps1

  Requer: Docker + Supabase CLI, com o banco local de pe (supabase start).
#>
param([string]$Container = "")
$ErrorActionPreference = "Stop"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot  = Resolve-Path (Join-Path $scriptDir "..\..")

Write-Host "== 1/3 Backup dos dados atuais ==" -ForegroundColor Cyan
& (Join-Path $scriptDir "backup_local.ps1") -Container $Container

Write-Host "== 2/3 supabase db reset (reaplica migrations + seed) ==" -ForegroundColor Cyan
Push-Location $repoRoot
try {
  supabase db reset
  if ($LASTEXITCODE -ne 0) { throw "supabase db reset falhou (exit $LASTEXITCODE)." }
} finally { Pop-Location }

Write-Host "== 3/3 Restaurando seus dados por cima ==" -ForegroundColor Cyan
& (Join-Path $scriptDir "restore_local.ps1") -Container $Container -Yes

Write-Host ""
Write-Host "OK Pronto: schema atualizado E seus dados preservados." -ForegroundColor Green
