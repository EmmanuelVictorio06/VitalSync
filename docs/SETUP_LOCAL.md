# Setup local do Supabase — VitalSync

Guia curto pra subir o ambiente local sem retrabalho. Com o `seed.sql` novo, o
`db reset` faz tudo de uma vez: migrations + usuários de Auth + papéis corretos +
dados de demonstração com datas atuais.

## 1. Base limpa (primeira vez ou "faxina")

```powershell
# Docker Desktop aberto
supabase start
supabase db reset      # aplica migrations 0001->0074 e roda o seed.sql
```

Isso já cria os 3 usuários e os pacientes. Login no app:

- `admin@vitalsync.com` / `senha123`  → vê tudo (ADMIN)
- `cirurgiao@vitalsync.com` / `senha123`  → Dra. Ana, equipe 01
- `medico@vitalsync.com` / `senha123`  → médico associado, equipe 01

Se o reset avisar **"Não criei os usuários de Auth automaticamente"** (versão
diferente do GoTrue): crie os 3 no Studio (http://127.0.0.1:54323 →
Authentication → Users → Add user, marcando **Auto Confirm**, senha `senha123`) e
rode o seed de novo (SQL Editor → cola `supabase/seed.sql` → Run).

## 2. Dia a dia (SEM apagar dados)

```powershell
git pull
supabase migration up   # aplica só as migrations novas, mantém dados e usuários
```

Use `migration up` no dia a dia. `db reset` só quando quiser zerar tudo — porque
ele recria o banco inteiro (inclusive o schema auth) e re-roda o seed.

## 3. Rodar o app local

```powershell
cd frontend
npm run dev
```

Garanta que o `.env` (ou `.env.local`) aponta pro Supabase **local**:
`VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` são os valores que aparecem em
`supabase status`. Se apontar pro remoto, você loga em produção sem querer.

## 4. Publicar no remoto (produção)

```powershell
supabase db push                    # envia as migrations novas
supabase functions deploy <nome>    # publica cada edge function alterada
```

`db push` NÃO publica edge function — código de função só vai pelo
`functions deploy`. `supabase link --project-ref <ref>` é só uma vez por máquina.

## 5. Conferir sincronia

```powershell
supabase migration list   # Local | Remote lado a lado
```

## Cuidados

- Os jobs do `pg_cron` (lembrete/medição esquecida) rodam sozinhos no horário.
  No local são inofensivos com homologação ligada; rode `supabase stop` quando
  não estiver usando pra eles não exercitarem as funções globais.
- O bloco 0 do `seed.sql` (criação de usuários de Auth) é **só para dev local** —
  nunca rode em produção.
- Papel errado no login (ex.: admin virando "médico associado"): é o
  `trg_protect_profile` (0006) revertendo a role no seed. O `seed.sql` novo já
  desliga essa trava só durante o upsert — se ainda ver isso, é sinal de que
  rodou uma versão antiga do seed.
