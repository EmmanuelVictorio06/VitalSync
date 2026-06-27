/**
 * Utilitários de CPF para o frontend (apenas UX).
 *
 * IMPORTANTE: aqui NÃO há hash nem criptografia — o pepper/chave vivem só na
 * Edge Function. Estas funções servem para formatar, mascarar e dar feedback
 * imediato ao usuário; a validação autoritativa acontece no servidor.
 */

/** Remove tudo que não for dígito. */
export function normalizeCpf(cpf: string): string {
  return (cpf ?? '').replace(/\D/g, '');
}

/**
 * Valida CPF: 11 dígitos, não-repetidos e dígitos verificadores corretos.
 * Mesma regra do servidor (supabase/functions/_shared/cpf.ts).
 */
export function validateCpf(cpf: string): boolean {
  const c = normalizeCpf(cpf);
  if (c.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(c)) return false;

  const digit = (sliceLen: number): number => {
    let sum = 0;
    for (let i = 0; i < sliceLen; i++) sum += Number(c[i]) * (sliceLen + 1 - i);
    const rest = (sum * 10) % 11;
    return rest === 10 ? 0 : rest;
  };

  return digit(9) === Number(c[9]) && digit(10) === Number(c[10]);
}

/** Formata para 000.000.000-00 (parcial enquanto digita). */
export function formatCpf(cpf: string): string {
  const c = normalizeCpf(cpf).slice(0, 11);
  return c
    .replace(/^(\d{3})(\d)/, '$1.$2')
    .replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/^(\d{3})\.(\d{3})\.(\d{3})(\d)/, '$1.$2.$3-$4');
}

/** Mascara para exibição: •••.•••.123-45 (preserva só os 5 últimos). */
export function maskCpf(cpf: string): string {
  const c = normalizeCpf(cpf);
  if (c.length !== 11) return '•••.•••.•••-••';
  return `•••.•••.${c.slice(6, 9)}-${c.slice(9, 11)}`;
}
