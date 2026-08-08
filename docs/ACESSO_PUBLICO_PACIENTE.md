# Acesso público do paciente (link do WhatsApp)

O paciente **não faz login**. Ele abre o formulário de sinais vitais por um link
público com token seguro:

```
https://SEU-DOMINIO-DE-PRODUCAO/registro-sinais/<TOKEN>
```

A rota `/registro-sinais/:token` (alias antigo: `/r/:token`) fica **fora** do
`Layout`/`PermissionGuard`, não exige sessão do Supabase Auth e nunca redireciona
para `/login`. A validação acontece por token via RPCs `SECURITY DEFINER`
(`get_patient_by_token` / `submit_vital_record`), sem expor `service_role`.

Se o paciente **ainda** cai numa tela de acesso/login, quase sempre **não é o
código** — é a plataforma. Siga os dois pontos abaixo.

---

## 1. Vercel Deployment Protection (a "tela de acesso da Vercel")

Quando aparece uma tela da **Vercel** pedindo login/acesso *antes* do app
carregar, é a proteção de deployment, não o VitalSync.

Vercel → **Project → Settings → Deployment Protection**. Verifique:

- **Vercel Authentication** — se estiver como *All Deployments*, **até a produção
  fica atrás de login**. Para a demo pública, mude para **Standard Protection
  (somente Preview)** ou desative. Assim o **domínio de produção fica público** e
  os previews continuam protegidos.
- **Password Protection** — se ligada, desligue (ou informe a senha à equipe; o
  paciente nunca deve precisar dela).
- **Trusted IPs / SSO** — não devem cobrir o domínio de produção da demo.

> Regra: o **domínio de produção** precisa estar **acessível publicamente**.

## 2. Use o domínio de PRODUÇÃO, nunca o de Preview

Todo deployment de **branch/preview** (ex.:
`https://vital-sync-frontend-git-minha-branch-usuario.vercel.app`) costuma vir
com Deployment Protection ligada. Se o link do paciente apontar para um desses,
ele bate na parede da Vercel.

✅ Correto (produção):
```
https://vital-sync-frontend-iota.vercel.app/registro-sinais/<TOKEN>
```

❌ Errado (preview protegido):
```
https://vital-sync-frontend-git-branch-usuario.vercel.app/registro-sinais/<TOKEN>
```

Vercel → **Project → Deployments**: o deployment marcado como **Production** é o
que tem o domínio público. Use esse domínio.

### Como o app garante isso

O link do paciente é montado por `frontend/src/lib/publicUrl.ts` a partir de
**`VITE_PUBLIC_APP_URL`** (e não de `window.location.origin`, que refletiria o
preview que o admin estiver navegando).

Configure na Vercel → **Settings → Environment Variables**, escopo **Production**:

```
VITE_PUBLIC_APP_URL = https://vital-sync-frontend-iota.vercel.app
```

(Substitua pelo domínio de produção real, ou pelo domínio próprio, ex.
`https://vitalsync.com.br`.) Depois **redeploy** para a variável valer no build.

Em **dev local** pode deixar a variável vazia: o app cai em
`window.location.origin` (ex.: `http://localhost:5173`), o que é o esperado.

---

## 3. Fallback de SPA (404 em deep link)

Já configurado em `vercel.json` (raiz):

```json
{ "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }] }
```

Sem isso, abrir `/registro-sinais/<TOKEN>` direto resultava em 404 / queda para
`/login`. **Só passa a valer após um novo deploy.**

---

## Checklist rápido

1. `VITE_PUBLIC_APP_URL` definida (Production) com o domínio de produção. ✅
2. Deployment Protection: produção **pública** (Vercel Authentication só em Preview). ✅
3. Link enviado usa o **domínio de produção**, não preview. ✅
4. `vercel.json` com `rewrites` para `/index.html`. ✅
5. Abrir o link em **aba anônima**: deve abrir o formulário **sem login**. ✅
