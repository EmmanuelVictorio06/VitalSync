<#
  VitalSync - Restaura os dados locais a partir de um backup (backup_local.ps1).
  À PROVA DE FALHA: limpeza + recarga rodam em UMA transação (--single-transaction).
  Se qualquer passo falhar, tudo volta atrás (rollback) e o banco NÃO fica vazio.
  So mexe no banco LOCAL.

  Uso:
    ./restore_local.ps1                      # usa supabase/_backups/latest.sql
    ./restore_local.ps1 -File C:\tmp\x.sql
    ./restore_local.ps1 -Yes                 # nao pergunta confirmacao
#>
param(
  [string]$File      = "",
  [string]$Container = "",
  [switch]$Yes
)
$ErrorActionPreference = "Stop"

function Get-DbContainer([string]$name) {
  if ($name) { return $name }
  $c = docker ps --filter "name=supabase_db_" --format "{{.Names}}" | Select-Object -First 1
  if (-not $c) { throw "Container do banco nao encontrado. O Supabase local esta de pe? (supabase start)" }
  return $c
}

$Container = Get-DbContainer $Container
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $File) { $File = Join-Path $scriptDir "..\_backups\latest.sql" }
if (-not (Test-Path $File)) { throw "Backup nao encontrado: $File. Rode backup_local.ps1 primeiro." }

if (-not $Yes) {
  Write-Host "Vou recarregar os dados locais a partir de:" -ForegroundColor Yellow
  Write-Host "  $File"
  Write-Host "(Roda em transacao unica: se falhar, o banco fica como esta - nada e perdido.)"
  $ans = Read-Host "Continuar? (s/N)"
  if ($ans -ne "s") { Write-Host "Abortado."; exit 0 }
}

# 1) Limpeza: DELETE (nao TRUNCATE CASCADE, p/ nao apagar storage.objects = fotos)
#    sob session_replication_role=replica (desliga FK/triggers sem precisar de owner).
$clean = @'
set session_replication_role = replica;
do $$
declare r record;
begin
  for r in select tablename from pg_tables where schemaname = 'public' loop
    execute format('delete from public.%I', r.tablename);
  end loop;
  delete from auth.identities;
  delete from auth.users;
end $$;
'@

Write-Host "-> Enviando dados ao container..." -ForegroundColor Cyan
$clean | docker exec -i $Container sh -c 'cat > /tmp/vsclean.sql'
docker cp $File "${Container}:/tmp/vsrestore_raw.sql"

# 2) Tira do dump as linhas 'ALTER TABLE ... DISABLE/ENABLE TRIGGER' (exigem ser
#    dono da tabela; o papel postgres do Supabase NAO e dono de auth.*). O replica
#    setado no clean.sql cobre a mesma funcao. (Comprovado em Postgres de teste.)
docker exec $Container sh -c "grep -vE '^ALTER TABLE .*(DISABLE|ENABLE) TRIGGER' /tmp/vsrestore_raw.sql > /tmp/vsrestore.sql || true"

# 2b) Normaliza o auth apos carregar: colunas de token com NULL fazem o GoTrue
#     dar 500 no login (erro que aparece como toast vazio {}). Os usuarios vindos
#     do backup (criados pelas RPCs do app) costumam ter esses campos NULL.
#     Tambem confirma o email e garante senha123 nos usuarios-semente.
$normalize = @'
do $$
declare col text;
begin
  foreach col in array array['confirmation_token','recovery_token','email_change',
      'email_change_token_new','email_change_token_current','phone_change',
      'phone_change_token','reauthentication_token'] loop
    begin
      execute format('update auth.users set %I = coalesce(%I, %L) where %I is null', col, col, '', col);
    exception when undefined_column then null;
    end;
  end loop;
end $$;
update auth.users set email_confirmed_at = coalesce(email_confirmed_at, now());
-- pgcrypto vive no schema 'extensions' (migration 0001); qualificamos por isso.
update auth.users set encrypted_password = extensions.crypt('senha123', extensions.gen_salt('bf'))
 where email in ('admin@vitalsync.com','cirurgiao@vitalsync.com','medico@vitalsync.com');
'@
$normalize | docker exec -i $Container sh -c 'cat > /tmp/vsnormalize.sql'

# 3) Tudo numa transacao unica: erro em qualquer ponto = rollback total.
Write-Host "-> Restaurando (transacao unica; rollback automatico se falhar)..." -ForegroundColor Cyan
docker exec $Container psql -U postgres -d postgres --single-transaction -v ON_ERROR_STOP=1 -f /tmp/vsclean.sql -f /tmp/vsrestore.sql -f /tmp/vsnormalize.sql
if ($LASTEXITCODE -ne 0) { throw "Restore falhou (exit $LASTEXITCODE). O banco foi MANTIDO como estava (rollback) - nada foi perdido." }
docker exec $Container rm -f /tmp/vsclean.sql /tmp/vsrestore.sql /tmp/vsrestore_raw.sql /tmp/vsnormalize.sql

Write-Host "OK Restore concluido. Login e pacientes restaurados." -ForegroundColor Green
Write-Host "   Entre com admin@vitalsync.com / senha123 (ou seu usuario)."
