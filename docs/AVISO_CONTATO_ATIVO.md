# Aviso de contato ativo ao paciente

## Por que isto existe

Quando um sinal vital sai fora do esperado, um profissional de enfermagem liga
ou manda mensagem para o paciente. No Brasil, contato de número desconhecido
que **já sabe a pressão, a cirurgia e o nome** do paciente é indistinguível de
golpe — e a reação correta de um idoso orientado a desconfiar é bloquear.

Avisar **antes** é o que torna o contato ativo possível. Sem isso, a triagem de
enfermagem inteira (migrations 0063–0069) não funciona na prática.

---

## 1. No aplicativo — já implementado

Componente `frontend/src/components/patient-measurement/ContatoAtivoAviso.tsx`,
exibido em dois pontos:

- **Primeiro acesso** — tela de confirmação de CPF (`VitalsRegisterPage`), antes
  de o paciente registrar qualquer coisa.
- **Após enviar a medição** — tela de sucesso (`MeasurementSuccess`).

Texto exibido:

> Se algum valor estiver fora do esperado, um profissional de enfermagem da
> equipe pode entrar em contato pelo WhatsApp oficial **{número}**.
> **Nunca pediremos senha, PIX ou dados bancários.**

O número vem de `VITE_WHATSAPP_OFICIAL` (ver `frontend/.env.example`). **Se a
variável não estiver configurada, o aviso aparece sem o número** — inventar ou
deixar um placeholder seria pior do que omitir.

> ⚠️ Configure `VITE_WHATSAPP_OFICIAL` com o mesmo número verificado usado pelas
> Edge Functions de WhatsApp. Um número diferente do que aparece na tela do
> paciente destrói exatamente a confiança que este aviso constrói.

---

## 2. No TCLE — pendente, é documento externo

O sistema guarda apenas a **data** de assinatura (`patients.tcle_accepted_at`).
O termo em si não vive neste repositório, então esta cláusula precisa ser
inserida por quem mantém o documento.

**Parágrafo a incluir no TCLE:**

> **Contato durante o acompanhamento.** Durante os 10 dias de acompanhamento
> pós-alta, caso alguma das medições registradas por você apresente valor fora
> do esperado, um profissional de enfermagem da equipe poderá entrar em contato
> por telefone ou WhatsApp, a partir do número oficial ______________________,
> para verificar como você está e orientar a conduta. Esse contato faz parte do
> acompanhamento e não tem qualquer custo. A equipe **nunca** solicitará senhas,
> transferências, PIX ou dados bancários. Em caso de dúvida sobre a
> autenticidade de um contato, ligue para ______________________.

Preencha os dois números antes de imprimir.

---

## 3. O que NÃO mudar

Os templates aprovados na Meta (`alerta_clinico_vitalsync`,
`lembrete_medicao_vitalsync`, `alerta_medicao_esquecida_vitalsync`) **não foram
alterados**. Mudar o corpo de um template exige nova aprovação e **derruba o
envio até ser aprovado** — o que criaria um período sem nenhuma notificação
funcionando, justamente o oposto do objetivo aqui.
