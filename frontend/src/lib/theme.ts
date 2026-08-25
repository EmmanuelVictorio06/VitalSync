/**
 * Lógica pura de resolução de tema (claro/escuro/sistema). Sem acesso a
 * localStorage/matchMedia aqui — isso fica no ThemeContext, que é quem lida
 * com o mundo real; aqui só a regra "escolha + preferência do SO → tema
 * efetivo", que é o que precisa ser testado.
 */

/** Escolha do usuário — 'sistema' é o padrão de quem nunca escolheu. */
export type Tema = 'claro' | 'escuro' | 'sistema';

/** Tema realmente aplicado na tela (já resolvido, sem o valor 'sistema'). */
export type TemaEfetivo = 'claro' | 'escuro';

/** Chave namespaced do projeto em localStorage. */
export const TEMA_STORAGE_KEY = 'vitalsync:tema';

const TEMAS_VALIDOS: readonly Tema[] = ['claro', 'escuro', 'sistema'];

/** Valida um valor lido de localStorage; qualquer coisa fora do esperado cai no padrão 'sistema'. */
export function lerTemaSalvo(valorBruto: string | null): Tema {
  return TEMAS_VALIDOS.includes(valorBruto as Tema) ? (valorBruto as Tema) : 'sistema';
}

/** Resolve o tema efetivo a partir da escolha do usuário e da preferência atual do SO. */
export function resolverTemaEfetivo(escolha: Tema, sistemaPrefereEscuro: boolean): TemaEfetivo {
  if (escolha === 'sistema') return sistemaPrefereEscuro ? 'escuro' : 'claro';
  return escolha;
}

/** Cor de `theme-color` (meta tag do navegador/barra de status mobile) para cada tema efetivo. */
export function themeColorPara(temaEfetivo: TemaEfetivo): string {
  return temaEfetivo === 'escuro' ? '#0f172a' : '#0B63EE';
}
