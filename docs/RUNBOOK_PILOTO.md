# Runbook do Piloto — VitalSync / CuraPath

Uma página. Para consultar às 2h da manhã, não para ler antes de dormir.

> **Antes de cadastrar o primeiro paciente real**, rode
> `supabase/_scripts/preflight_primeiro_paciente.sql` no SQL Editor. Só libere
> com todas as linhas em `[ OK ]`. A checagem nº 1 (modo homologação) é a que
> mais causa dano: ligada, os alertas do paciente real viram
> `SKIPPED_TEST_MODE` e **ninguém é avisado**.

---

## 1. Quem olha o quê, e quando

| Quando | Quem | O quê |
|---|---|---|
| 08:30 e 18:30 | Enfermagem de plantão | Abrir plantão no app. Sem plantão aberto, ninguém recebe oferta de alerta. |
| Ao longo do turno | Enfermagem | Fila de triagem no Dashboard (ofertados / fila aberta / em análise) |
| 10:30 e 20:30 | Enfermagem | Seção "Contato ativo — sem medição hoje": ligar para quem não registrou |
| 1×/dia | Admin | Configurações → Homologação → **Falhas de envio** |
| 1×/semana | Admin | `preflight_primeiro_paciente.sql` |

**Preencha antes do piloto:** telefone humano de plantão → `__________`.
É o número que o paciente liga quando o app não funciona, e o mesmo que
aparece no fallback de erro da tela dele (`VITE_SUPPORT_CONTACT_PHONE`).

---

## 2. "O WhatsApp parou de enviar"

Sintoma: alertas criados, mas ninguém recebe mensagem.

1. **Modo homologação está ligado?** Configurações → Homologação. Se estiver, os
   envios viram `SKIPPED_TEST_MODE`. Esta é a causa mais comum.
2. **O número está na whitelist?** Em homologação, só a whitelist recebe.
3. **Credenciais da Meta:** sem `WHATSAPP_API_TOKEN`/`WHATSAPP_PHONE_NUMBER_ID`,
   a Edge Function grava `logged` (simulado) em vez de enviar. Confira em
   Configurações → Homologação se os envios aparecem como `logged`.
4. **Token da Meta expirou?** Tokens temporários duram ~24h. O de produção tem
   que ser de System User (ver `docs/CONFIG_WHATSAPP_CLOUD_API.md`, Passo 4).
5. **Logs da Edge Function:** Supabase → Functions → `send-whatsapp-alert`.

```sql
-- Estado dos envios recentes
select status, count(*) from public.notification_logs
 where created_at > now() - interval '24 hours' group by status;
```

## 3. Reenviar uma notificação manualmente

**Pela tela (preferível):** Configurações → Homologação → Falhas de envio →
**Reenviar**.

**Pelo SQL:**
```sql
select public.alert_resend_notification('<alert_id>');
```

O retry automático já tenta 3 vezes (5, 15 e 60 min). Depois disso a linha fica
marcada como esgotada e **só o reenvio manual resolve** — se a mensagem
continuar falhando, ligue.

## 4. "O sistema está fora do ar"

1. **Vercel** (frontend) e **Supabase** (banco/Edge) têm páginas de status
   próprias — verifique qual dos dois caiu.
2. Enquanto estiver fora: **o paciente não consegue registrar**. O protocolo
   clínico não para — a enfermagem liga e registra pelo telefone, e lança no
   sistema depois pelo botão "Lançar medição" (só o período de hoje).
3. **O paciente liga para quem?** → telefone de plantão da seção 1.

## 5. Tela branca / erro no app

Erros de JavaScript são gravados em `client_error_logs` (só Admin lê):

```sql
select occurred_at, contexto, route_pattern, message
  from public.client_error_logs
 order by occurred_at desc limit 20;
```

O conteúdo é **redigido no cliente** (token, CPF, e-mail e telefone viram
`[REDIGIDO]`) e a rota é gravada como padrão (`/registro-sinais/:token`), nunca
como URL real — a URL do paciente contém a credencial de acesso dele.

Se aparecerem muitas linhas do contexto `registro-paciente`, é o pior caso:
pacientes tentando registrar e não conseguindo. Priorize.

## 6. Restauração de backup

O backup roda diariamente (`.github/workflows/backup.yml`) e também sob demanda
(Actions → Backup → *Run workflow*). O dump é cifrado com GPG simétrico.

```bash
# 1. Baixe o artefato da execução do workflow e descriptografe
gpg --decrypt --batch --passphrase "$BACKUP_PASSPHRASE" \
    vitalsync-backup-AAAA-MM-DD.sql.gpg > restore.sql

# 2. Restaure num banco DESCARTÁVEL primeiro — nunca direto em produção
psql "$URL_DO_BANCO_DE_TESTE" -f restore.sql

# 3. Confira que veio dado de verdade
psql "$URL_DO_BANCO_DE_TESTE" -c "select count(*) from public.patients;"
```

> **Backup nunca restaurado não é backup.**
>
> Última restauração testada: `____/____/______` por `____________`
>
> Preencha esta linha. Se estiver em branco, você tem um arquivo, não um backup.

## 7. Escalonamento humano

| Situação | Ação |
|---|---|
| Alerta vermelho sem atendimento > 30 min | Ligar para o Cirurgião Principal da equipe |
| Paciente relata piora grave por telefone | Orientar a procurar o pronto-socorro **imediatamente**; registrar contato na timeline; escalar no app |
| Falha de envio em alerta vermelho | Não espere o retry: ligue para a equipe |
| Suspeita de vazamento de dado | Congelar acesso do usuário, `select` em `patient_access_logs`, avisar o responsável pela LGPD |

---

## Pendências que ainda não têm dono definido

Ver `docs/PONTOS_PENDENTES.md`. As que bloqueiam paciente real:

- **Responsável Técnico com COREN** para o protocolo de teleconsulta de enfermagem.
- **DPA/contrato de operador** com o hospital (dado de saúde, art. 11 da LGPD).
- **Divergência da pressão sistólica** (protocolo > 160 vs. código ≥ 140).
- **Retenção do backup**: hoje o dump cifrado fica como artefato do GitHub.
  Ver o trade-off em `docs/BACKUP.md`.
