/**
 * Sanitização de HTML gerado pelo editor rich text (RichTextField, ver ui.tsx).
 * Allowlist restrita de tags/atributos — o conteúdo é gerado via
 * document.execCommand, mas também passa por aqui na colagem (paste) e antes
 * de renderizar em telas de leitura, já que é exibido para outros usuários
 * (proteção contra HTML malicioso colado no editor).
 */

const ALLOWED_TAGS = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'UL', 'LI', 'BR', 'DIV', 'P', 'SPAN', 'FONT']);

// Removidos por completo (com os filhos) — nunca faz sentido "desembrulhar" estes.
const REMOVE_ENTIRELY = new Set([
  'SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'SVG', 'IMG', 'LINK', 'META',
  'FORM', 'INPUT', 'BUTTON', 'TEXTAREA', 'SELECT', 'VIDEO', 'AUDIO', 'SOURCE',
]);

function sanitizeStyle(style: string): string {
  const match = /text-align\s*:\s*(left|center|right)/i.exec(style);
  return match?.[1] ? `text-align: ${match[1].toLowerCase()}` : '';
}

function cleanElement(el: Element): void {
  if (REMOVE_ENTIRELY.has(el.tagName)) {
    el.remove();
    return;
  }

  Array.from(el.childNodes).forEach((child) => {
    if (child.nodeType === Node.ELEMENT_NODE) {
      cleanElement(child as Element);
    } else if (child.nodeType === Node.COMMENT_NODE) {
      child.remove();
    }
  });

  if (!ALLOWED_TAGS.has(el.tagName)) {
    // Tag não reconhecida (ex.: A, TABLE): desembrulha mantendo o texto/filhos.
    const parent = el.parentNode;
    if (parent) {
      while (el.firstChild) parent.insertBefore(el.firstChild, el);
      parent.removeChild(el);
    }
    return;
  }

  Array.from(el.attributes).forEach((attr) => {
    const name = attr.name.toLowerCase();
    if (el.tagName === 'FONT' && name === 'size' && /^[1-7]$/.test(attr.value)) return;
    if (name === 'style') {
      const cleaned = sanitizeStyle(attr.value);
      if (cleaned) el.setAttribute('style', cleaned);
      else el.removeAttribute('style');
      return;
    }
    el.removeAttribute(attr.name);
  });
}

/** Sanitiza um trecho de HTML (editor rich text) contra uma allowlist de tags/atributos. */
export function sanitizeRichText(html: string): string {
  const template = document.createElement('template');
  template.innerHTML = html;
  Array.from(template.content.childNodes).forEach((child) => {
    if (child.nodeType === Node.ELEMENT_NODE) cleanElement(child as Element);
    else if (child.nodeType === Node.COMMENT_NODE) child.remove();
  });
  return template.innerHTML;
}

const NBSP = String.fromCharCode(160);

/**
 * Tags que representam uma quebra visual no editor (blocos e <br>). Fonte única
 * do "o que separa uma linha da outra" — usada aqui e por `parseComorbidities`
 * (lib/comorbidities.ts), para que texto puro e lista salva quebrem igual.
 */
export const BLOCK_BREAK_TAG = /<\s*\/?\s*(?:br|div|p|li|ul|ol)\b[^>]*>/gi;

/**
 * Extrai texto puro (sem tags) de um HTML do editor — usado para campos que não
 * persistem formatação e para decidir "está vazio?".
 *
 * `textContent` sozinho NÃO insere separador entre blocos: o contentEditable
 * gera <div>/<p>/<li> a cada Enter, então `<div>a</div><div>b</div>` viraria
 * "ab" (itens grudados). Por isso as quebras viram "\n" ANTES da extração.
 */
export function richTextToPlainText(html: string): string {
  const template = document.createElement('template');
  template.innerHTML = html.replace(BLOCK_BREAK_TAG, '\n');
  return (template.content.textContent ?? '').split(NBSP).join(' ');
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Converte texto de colagem (clipboard "text/plain") em HTML seguro, preservando quebras de linha. */
export function plainTextToHtml(text: string): string {
  return escapeHtml(text).replace(/\r\n|\r|\n/g, '<br>');
}
