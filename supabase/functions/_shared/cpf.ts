// ============================================================================
// CPF — validação e criptografia (lado servidor / Deno).
//
// Fonte AUTORITATIVA da regra de CPF nas Edge Functions. O frontend tem uma
// cópia da validação pura (frontend/src/lib/cpfUtils.ts) só para UX; o servidor
// nunca confia no cliente e revalida aqui antes de hash/cripto.
//
// Segredos (Supabase Secrets, nunca no frontend):
//   CPF_PEPPER  → chave do HMAC do hash (qualquer string forte e estável).
//   CPF_ENC_KEY → chave da cifra AES-GCM (qualquer string forte e estável).
// ============================================================================

/** Remove tudo que não for dígito. */
export function normalizeCpf(cpf: string): string {
  return (cpf ?? '').replace(/\D/g, '');
}

/**
 * Valida CPF: 11 dígitos, não-repetidos (ex.: 000... / 111...) e dígitos
 * verificadores corretos.
 */
export function validateCpf(cpf: string): boolean {
  const c = normalizeCpf(cpf);
  if (c.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(c)) return false; // todos iguais → inválido

  const digit = (sliceLen: number): number => {
    let sum = 0;
    for (let i = 0; i < sliceLen; i++) {
      sum += Number(c[i]) * (sliceLen + 1 - i);
    }
    const rest = (sum * 10) % 11;
    return rest === 10 ? 0 : rest;
  };

  return digit(9) === Number(c[9]) && digit(10) === Number(c[10]);
}

const enc = new TextEncoder();

/** HMAC-SHA256(cpf, pepper) em hex. Determinístico → serve para unicidade. */
export async function hashCpf(cpf: string, pepper: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(pepper),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(normalizeCpf(cpf)));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Deriva uma chave AES-256 de 32 bytes a partir do segredo (SHA-256). */
async function aesKey(secret: string): Promise<CryptoKey> {
  const raw = await crypto.subtle.digest('SHA-256', enc.encode(secret));
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

/** Cifra o CPF com AES-GCM. Saída base64 de (iv[12] || ciphertext). */
export async function encryptCpf(cpf: string, secret: string): Promise<string> {
  const key = await aesKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(normalizeCpf(cpf))),
  );
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv, 0);
  out.set(ct, iv.length);
  return btoa(String.fromCharCode(...out));
}
