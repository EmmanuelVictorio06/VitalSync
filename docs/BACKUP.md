# Backup do banco — o que existe e o que ainda precisa ser decidido

## Situação atual

| | |
|---|---|
| **Antes** | `backup_vitalsync.sh`, manual: alguém precisava lembrar de rodar e colar a connection string |
| **Agora** | `.github/workflows/backup.yml` — diário às 03:10 (America/Sao_Paulo) + sob demanda (Actions → *Run workflow*) |
| Cifragem | GPG simétrico AES256, em fluxo (o dump **nunca** toca o disco em texto claro) |
| Destino | Artefato do GitHub Actions, retenção de 7 dias |

### Secrets necessários

Em *Settings → Secrets and variables → Actions*:

| Secret | O que é |
|---|---|
| `SUPABASE_DB_URL` | Connection string do Session pooler (Supabase → Project Settings → Database → URI) |
| `BACKUP_PASSPHRASE` | Senha da cifragem GPG. **Guarde fora do GitHub** — quem tem só o artefato não restaura nada sem ela, e quem perde a senha perde o backup |

O workflow **aborta** se qualquer um dos dois faltar: um backup em texto claro é
pior do que backup nenhum, porque dá falsa segurança.

---

## 🚩 Decisão pendente — implicação de LGPD

**O dump cifrado fica como artefato do GitHub Actions.** Isso funciona e é muito
melhor que o estado anterior, mas significa que **dado de saúde de pacientes
brasileiros passa pela infraestrutura do GitHub** (Microsoft, servidores fora do
país). Mesmo cifrado:

- há transferência internacional de dado pessoal sensível (LGPD, art. 33);
- o controlador (hospital) precisa estar ciente e de acordo — isso entra no DPA;
- a retenção efetiva depende da política do GitHub, não da nossa.

### Alternativas, em ordem de preferência

1. **Point-in-Time Recovery do Supabase** (plano pago). Melhor tecnicamente
   (granularidade de segundos, sem cópia saindo da infra do banco) e
   contratualmente (fica sob o DPA que já se tem com o Supabase). Custa dinheiro.
2. **Bucket privado sob controle da empresa** (S3/GCS/Supabase Storage em região
   brasileira), com o workflow fazendo upload em vez de artefato. Exige criar e
   guardar mais credenciais, mas mantém o dado sob contrato próprio.
3. **Artefato do GitHub** — o que está implementado. Aceitável para o piloto,
   mas deve ser revisto antes de escalar o número de pacientes.

**Esta é decisão de negócio, não de engenharia.** A implementação atual é a
opção 3 porque era a que dava para entregar sem depender de conta paga nem de
credencial nova — não porque seja a mais correta.

---

## Restauração

Procedimento completo em `docs/RUNBOOK_PILOTO.md`, seção 6. O resumo:

```bash
gpg --decrypt --batch --passphrase "$BACKUP_PASSPHRASE" \
    vitalsync-backup-AAAA-MM-DD.sql.gpg > restore.sql
psql "$URL_DO_BANCO_DE_TESTE" -f restore.sql
```

> **Backup nunca restaurado não é backup.** Restaure num banco descartável pelo
> menos uma vez e anote a data no runbook. Enquanto essa linha estiver em
> branco, o que existe é um arquivo cifrado de utilidade não comprovada.

### O que o dump NÃO cobre

`pg_dump` salva o banco. **Não** salva:

- objetos do Storage (fotos de ferida/dreno);
- secrets do Vault (`project_url`, `service_role_key`) e das Edge Functions;
- configuração de Auth (usuários ficam em `auth.users`, que o dump com
  `--no-owner --no-privileges` de um usuário comum pode não incluir integralmente).

Restaurar num projeto novo exige reconfigurar esses itens à mão — vale testar o
procedimento inteiro uma vez antes de precisar dele de verdade.
