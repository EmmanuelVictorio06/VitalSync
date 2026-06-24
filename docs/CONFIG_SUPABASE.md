# Configuração do Supabase (frontend)

O frontend usa **Supabase direto** (Auth + Database + Storage). Sem essas
variáveis, o login falha e o console mostra:

```
Supabase não configurado: defina VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY (.env.local / Vercel).
POST https://placeholder.supabase.co/auth/v1/token?grant_type=password net::ERR_NAME_NOT_RESOLVED
```

`placeholder.supabase.co` é só um **fallback** para o app não quebrar; nenhuma
requisição real é feita para ele (os serviços checam `isSupabaseConfigured`
antes). Para o login funcionar, preencha as variáveis reais.

## 1. Onde achar as chaves

Supabase → **Project Settings → API**:

- **Project URL** → `VITE_SUPABASE_URL` (ex.: `https://xxxxxxxx.supabase.co`)
- **anon public** (ou *publishable*) → `VITE_SUPABASE_ANON_KEY`

> ⚠️ **Nunca** use a chave `service_role` no frontend — ela é secreta.

## 2. Local (`frontend/.env.local`)

Crie/edite `frontend/.env.local` (já está no `.gitignore`):

```env
VITE_SUPABASE_URL=https://xxxxxxxxxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOi...
VITE_PUBLIC_APP_URL=http://localhost:5173
```

Regras: **sem aspas**, **sem espaços** ao redor do `=`, **uma** variável por
linha. Use `frontend/.env.example` como modelo.

Reinicie o Vite (ele só lê o `.env` no boot):

```bash
cd D:\VitalSync\frontend
# Pare o servidor atual com Ctrl + C, depois:
npm run dev
```

## 3. Produção (Vercel)

**Project → Settings → Environment Variables** → adicione (escopo Production e
Preview):

| Variável                 | Valor                                              |
| ------------------------ | -------------------------------------------------- |
| `VITE_SUPABASE_URL`      | URL do projeto Supabase                             |
| `VITE_SUPABASE_ANON_KEY` | chave pública `anon`/`publishable`                  |
| `VITE_PUBLIC_APP_URL`    | domínio público de produção (ex.: `https://...vercel.app`) |

Depois de salvar, faça um **novo deploy** (variáveis `VITE_*` entram no bundle
em build time; redeploy é obrigatório).

## 4. Checklist de validação

- [ ] Console **não** mostra mais `placeholder.supabase.co`.
- [ ] As requisições de login vão para a URL real do projeto Supabase.
- [ ] `frontend/.env.local` existe e está preenchido.
- [ ] Servidor Vite reiniciado após editar o `.env.local`.
- [ ] Variáveis cadastradas na Vercel (+ redeploy).
- [ ] Nenhuma chave secreta (`service_role`) commitada.
- [ ] `npm run build` continua funcionando.

### Como interpretar o resultado do login

- **`E-mail ou senha incorretos.`** → conexão com o Supabase OK; usuário/senha
  errados ou ainda não criados no Supabase Auth.
- **`Supabase não configurado. Verifique as variáveis...`** → o `.env.local`
  não foi lido (vazio/placeholder) ou o Vite não foi reiniciado.
