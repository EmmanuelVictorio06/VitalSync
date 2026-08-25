<#
  VitalSync - Conserta o login local (DEV).
  Causa: usuarios com colunas de token em NULL fazem o GoTrue dar 500
  ("converting NULL to string is unsupported"). Este script poe '' nesses campos,
  confirma o e-mail e garante senha123 nos usuarios-semente. NAO apaga dados.

  Uso:  ./supabase/_scripts/fix_login.ps1
#>
param([string]$Container = "")
$ErrorActionPreference = "Stop"
if (-not $Container) { $Container = docker ps --filter "name=supabase_db_" --format "{{.Names}}" | Select-Object -First 1 }
if (-not $Container) { throw "Container do banco nao encontrado. O Supabase local esta de pe? (supabase start)" }

$sql = @'
set session_replication_role = replica;
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
update auth.users set encrypted_password = extensions.crypt('senha123', extensions.gen_salt('bf'))
 where email in ('admin@vitalsync.com','cirurgiao@vitalsync.com','medico@vitalsync.com');
select 'usuarios com token OK: ' || count(*) as resultado
  from auth.users where confirmation_token is not null;
'@

Write-Host "-> Corrigindo auth.users (tokens NULL -> '') no container '$Container'..." -ForegroundColor Cyan
$sql | docker exec -i $Container psql -U postgres -d postgres -v ON_ERROR_STOP=1
if ($LASTEXITCODE -ne 0) { throw "Falhou (exit $LASTEXITCODE)." }

Write-Host "OK Login corrigido. Entre com admin@vitalsync.com / senha123." -ForegroundColor Green
