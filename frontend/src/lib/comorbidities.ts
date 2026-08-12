/**
 * Comorbidades: converte o HTML do editor rich text (RichTextField) na lista
 * persistida em `patients.comorbidities` — jsonb de **texto puro** (string[]).
 *
 * A coluna não guarda formatação: negrito, tamanho e alinhamento são apoio à
 * digitação e são descartados aqui, de propósito (ver migration 0052 e
 * components/alerts.tsx, que exibe a lista com `join(', ')`).
 *
 * Um item por vírgula **ou** por quebra visual — assim a lista com marcadores
 * do editor rende um item por <li>:
 *   <ul><li>diabetes</li><li>hipertensão</li></ul> → ['diabetes', 'hipertensão']
 *   diabetes, hipertensão                          → ['diabetes', 'hipertensão']
 *   diabetes⏎hipertensão                           → ['diabetes', 'hipertensão']
 *
 * Deliberadamente **sem DOM** (não usa `document`), diferente de
 * `richTextToPlainText`: o vitest do projeto roda em ambiente Node, sem jsdom,
 * então só uma função pura pode ser coberta por teste unitário. Compartilha com
 * richText.ts a regex `BLOCK_BREAK_TAG` para que "o que é uma quebra" tenha
 * fonte única.
 */
import { BLOCK_BREAK_TAG } from './richText';

const ANY_TAG = /<[^>]*>/g;
const ITEM_SEPARATOR = /[\r\n,]+/;

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

/** Decodifica as entidades que o editor/colagem podem gerar (`plainTextToHtml` escapa & < >). */
function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, code: string) => {
    const lower = code.toLowerCase();
    if (lower.startsWith('#')) {
      const isHex = lower.startsWith('#x');
      const parsed = Number.parseInt(isHex ? lower.slice(2) : lower.slice(1), isHex ? 16 : 10);
      if (!Number.isFinite(parsed) || parsed < 0 || parsed > 0x10ffff) return match;
      return String.fromCodePoint(parsed);
    }
    return NAMED_ENTITIES[lower] ?? match;
  });
}

/**
 * HTML (ou texto puro) do campo Comorbidades → lista limpa para o jsonb.
 * Itens são trimados, têm espaços internos normalizados e os vazios são descartados.
 */
export function parseComorbidities(value: string): string[] {
  const withBreaks = value.replace(BLOCK_BREAK_TAG, '\n');
  const plain = decodeEntities(withBreaks.replace(ANY_TAG, ''));
  return plain
    .split(ITEM_SEPARATOR)
    // \s cobre também o NBSP ( ) que o contentEditable insere.
    .map((item) => item.replace(/\s+/g, ' ').trim())
    .filter((item) => item.length > 0);
}
