import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type InputHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { createPortal } from 'react-dom';
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  Check,
  ChevronDown,
  Italic,
  List as ListIcon,
  Redo2,
  RemoveFormatting,
  Search,
  Type as FontSizeIcon,
  Underline,
  Undo2,
} from 'lucide-react';
import { ClinicalStatus, formatPhoneBR, onlyDigits } from '@vitalsync/shared';
import { plainTextToHtml, sanitizeRichText } from '../lib/richText';

/** Junta classes condicionalmente (equivalente leve do `cn` da referência). */
export function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ');
}

/* ---------------- Container e cabeçalho de página ---------------- */
/**
 * Wrapper padrão das telas internas: padding e centralização consistentes.
 * `size` define a largura máxima — `default` (até 6xl) para telas comuns e
 * `wide` (até 7xl) para telas densas (dashboards, listas grandes).
 */
export function PageContainer({
  size = 'default',
  className,
  children,
}: {
  size?: 'default' | 'wide';
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn('p-4 md:p-8 mx-auto w-full space-y-6', size === 'wide' ? 'max-w-7xl' : 'max-w-6xl', className)}>
      {children}
    </div>
  );
}

/** Cabeçalho padrão da página: título, subtítulo opcional e slot de ação à direita. */
export function PageHeader({
  title,
  subtitle,
  action,
  className,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 animate-entry', className)}>
      <div className="min-w-0">
        <h2 className="text-2xl md:text-3xl font-extrabold tracking-tight">{title}</h2>
        {subtitle && <p className="text-sm text-muted-foreground mt-1 max-w-2xl">{subtitle}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

/* ---------------- Status badge (semáforo) ---------------- */
const STATUS_META: Record<ClinicalStatus, { cls: string; dot: string; label: string }> = {
  GREEN: { cls: 'bg-stable/10 text-stable border border-stable/20', dot: 'bg-stable', label: 'Estável' },
  YELLOW: { cls: 'bg-warning/10 text-warning border border-warning/20', dot: 'bg-warning', label: 'Atenção' },
  RED: { cls: 'bg-alert/10 text-alert border border-alert/20', dot: 'bg-alert', label: 'Alerta' },
};

export function StatusBadge({ status, showDot = true }: { status: ClinicalStatus; showDot?: boolean }) {
  const meta = STATUS_META[status] ?? STATUS_META.GREEN;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider',
        meta.cls,
      )}
    >
      {showDot && (
        <span className={cn('size-1.5 rounded-full', meta.dot, status === ClinicalStatus.RED && 'pulse-alert')} aria-hidden />
      )}
      {meta.label}
    </span>
  );
}

/** Classe de borda lateral do card conforme o status clínico. */
export function statusBorder(status: ClinicalStatus): string {
  return status === ClinicalStatus.RED
    ? 'border-l-alert'
    : status === ClinicalStatus.YELLOW
      ? 'border-l-warning'
      : 'border-l-stable';
}

/* ---------------- Button ---------------- */
type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success' | 'whatsapp';
const VARIANT_CLS: Record<Variant, string> = {
  primary: 'bg-primary text-primary-foreground hover:bg-primary/90 shadow-lg shadow-primary/20',
  secondary: 'border border-primary/30 bg-card text-primary hover:bg-accent',
  ghost: 'border border-border bg-transparent text-foreground hover:bg-muted',
  danger: 'bg-alert text-alert-foreground hover:bg-alert/90',
  success: 'bg-stable text-stable-foreground hover:bg-stable/90 shadow-lg shadow-stable/20',
  whatsapp: 'bg-[#25D366] text-white hover:opacity-90',
};
const SIZE_CLS = {
  sm: 'px-3 py-1.5 text-xs rounded-md',
  md: 'px-4 py-2.5 text-sm rounded-lg',
  lg: 'px-6 py-3.5 text-base rounded-xl',
} as const;

interface BtnProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: 'sm' | 'md' | 'lg';
  block?: boolean;
  loading?: boolean;
}
export function Button({ variant = 'primary', size = 'md', block, loading, children, disabled, className, ...rest }: BtnProps) {
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center gap-2 font-semibold transition-colors disabled:opacity-55 disabled:cursor-not-allowed disabled:shadow-none',
        VARIANT_CLS[variant],
        SIZE_CLS[size],
        block && 'w-full',
        className,
      )}
      disabled={disabled || loading}
      {...rest}
    >
      {loading ? 'Aguarde…' : children}
    </button>
  );
}

/* ---------------- Field wrapper ---------------- */
export function Field({
  label,
  hint,
  error,
  children,
  required,
}: {
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    // `min-w-0`: como item de grid/flex o padrão é `min-width: auto`, que impede
    // encolher abaixo do conteúdo — um valor longo sem espaços (URL, e-mail ou
    // um prontuário colado sem quebras) empurrava a coluna e estourava o modal.
    <div className="block min-w-0">
      <span className="block text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5">
        {label} {required && <span className="text-alert">*</span>}
      </span>
      {children}
      {hint && !error && <span className="block text-xs text-muted-foreground mt-1">{hint}</span>}
      {error && <span className="block text-xs font-semibold text-alert mt-1">{error}</span>}
    </div>
  );
}

/* ---------------- Text input ---------------- */
interface TextProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  hint?: string;
  error?: string;
}
export function TextInput({ label, hint, error, required, className, ...rest }: TextProps) {
  return (
    <Field label={label} hint={hint} error={error} required={required}>
      <input className={cn('input', error && 'invalid', className)} {...rest} />
    </Field>
  );
}

/* ---------------- Textarea ---------------- */
interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: string;
  hint?: string;
  error?: string;
}
export function TextareaField({ label, hint, error, required, className, ...rest }: TextareaProps) {
  return (
    <Field label={label} hint={hint} error={error} required={required}>
      <textarea className={cn('input resize-none overflow-y-auto', error && 'invalid', className)} {...rest} />
    </Field>
  );
}

/* ---------------- Rich text field (editor estilo Word) ----------------
   Editor contentEditable + document.execCommand: solução deliberadamente leve
   (sem lib de rich text) já que o projeto não tem nenhuma instalada.
   Usado em Resumo de prontuário e Comorbidades (cadastro e edição de paciente).

   Nem todo campo persiste a formatação: Comorbidades usa a barra completa só
   como apoio à digitação, mas é salvo como texto puro (string[] no jsonb) por
   `parseComorbidities` (lib/comorbidities.ts) — a lista com marcadores vira um
   item por <li>. Resumo de prontuário persiste o HTML sanitizado.

   `toolbar="compact"` esconde tamanho de fonte, alinhamento e lista com
   marcadores. Mantido para campos de lista curta, mas HOJE SEM USO: os dois
   campos passaram a usar a barra completa. */
interface RichTextFieldProps {
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  value: string;
  onChange: (html: string) => void;
  toolbar?: 'full' | 'compact';
  minHeightClassName?: string;
}

export function RichTextField({ label, hint, error, required, value, onChange, toolbar = 'full', minHeightClassName }: RichTextFieldProps) {
  return (
    <Field label={label} hint={hint} error={error} required={required}>
      <RichTextEditor value={value} onChange={onChange} toolbar={toolbar} minHeightClassName={minHeightClassName} ariaLabel={label} invalid={!!error} />
    </Field>
  );
}

interface RichTextActiveState {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  list: boolean;
  alignLeft: boolean;
  alignCenter: boolean;
  alignRight: boolean;
}

const RICH_TEXT_ACTIVE_DEFAULT: RichTextActiveState = {
  bold: false,
  italic: false,
  underline: false,
  list: false,
  alignLeft: false,
  alignCenter: false,
  alignRight: false,
};

const RICH_TEXT_FONT_SIZES: Array<{ value: string; label: string }> = [
  { value: '2', label: 'Pequeno' },
  { value: '3', label: 'Normal' },
  { value: '5', label: 'Grande' },
  { value: '7', label: 'Título' },
];

function RichTextEditor({
  value,
  onChange,
  toolbar,
  minHeightClassName = 'min-h-[140px]',
  ariaLabel,
  invalid,
}: {
  value: string;
  onChange: (html: string) => void;
  toolbar: 'full' | 'compact';
  minHeightClassName?: string;
  ariaLabel: string;
  invalid?: boolean;
}) {
  const editableRef = useRef<HTMLDivElement>(null);
  const lastEmitted = useRef(value);
  const sizeWrapRef = useRef<HTMLDivElement>(null);
  const sizeBtnRef = useRef<HTMLButtonElement>(null);
  const [active, setActive] = useState<RichTextActiveState>(RICH_TEXT_ACTIVE_DEFAULT);
  const [fontSize, setFontSize] = useState('3');
  const [sizeMenuOpen, setSizeMenuOpen] = useState(false);
  const [sizeMenuStyle, setSizeMenuStyle] = useState<React.CSSProperties>({});

  // Monta o conteúdo inicial uma única vez (o efeito abaixo, que reage a `value`,
  // não dispara no primeiro render porque lastEmitted já começa igual a value).
  useEffect(() => {
    if (editableRef.current) {
      const safe = sanitizeRichText(value);
      editableRef.current.innerHTML = safe;
      lastEmitted.current = safe;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sincroniza atualizações externas (reset do formulário, carregar paciente
  // existente) sem sobrescrever o conteúdo enquanto o usuário digita.
  useEffect(() => {
    if (value !== lastEmitted.current && editableRef.current) {
      const safe = sanitizeRichText(value);
      editableRef.current.innerHTML = safe;
      lastEmitted.current = safe;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  useEffect(() => {
    if (!sizeMenuOpen) return;
    const onDocClick = (e: MouseEvent) => {
      // O menu é portado para o body, então sizeWrapRef não o contém: checa
      // também o próprio menu (data-attribute), como faz o CustomSelect.
      const t = e.target as Node | null;
      if (!t) return;
      if (sizeWrapRef.current?.contains(t)) return;
      if (t instanceof Element && t.closest?.('[data-rt-size-menu]')) return;
      setSizeMenuOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [sizeMenuOpen]);

  // Posiciona o menu de tamanho (portado para o body) em relação ao botão e abre
  // para cima quando não há espaço abaixo. O wrapper do editor usa
  // `overflow-hidden` (para arredondar a barra), então um menu `absolute` fica
  // cortado — sobretudo em campos baixos (Comorbidades, min-h-120px) e dentro do
  // modal de edição. Mesmo problema e mesma solução do CustomSelect acima.
  useEffect(() => {
    if (!sizeMenuOpen) return;
    const btn = sizeBtnRef.current;
    if (!btn) return;

    const MENU_W = 128; // w-32
    const MAX_H = 176; // 4 opções + padding, com folga
    const GAP = 4; // mt-1 / mb-1

    const place = () => {
      const r = btn.getBoundingClientRect();
      const below = window.innerHeight - r.bottom - GAP;
      const above = r.top - GAP;
      const up = below < MAX_H && above > below;
      setSizeMenuStyle({
        position: 'fixed',
        // Clampa à direita para não estourar a largura em telas estreitas.
        left: Math.max(GAP, Math.min(r.left, window.innerWidth - MENU_W - GAP)),
        ...(up ? { bottom: window.innerHeight - r.top + GAP } : { top: r.bottom + GAP }),
      });
    };

    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [sizeMenuOpen]);

  useEffect(() => {
    function onSelectionChange() {
      const el = editableRef.current;
      const sel = window.getSelection();
      if (!el || !sel || sel.rangeCount === 0 || !sel.anchorNode) return;
      if (!el.contains(sel.anchorNode)) return;
      updateActiveState();
    }
    document.addEventListener('selectionchange', onSelectionChange);
    return () => document.removeEventListener('selectionchange', onSelectionChange);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function updateActiveState() {
    try {
      setActive({
        bold: document.queryCommandState('bold'),
        italic: document.queryCommandState('italic'),
        underline: document.queryCommandState('underline'),
        list: document.queryCommandState('insertUnorderedList'),
        alignLeft: document.queryCommandState('justifyLeft'),
        alignCenter: document.queryCommandState('justifyCenter'),
        alignRight: document.queryCommandState('justifyRight'),
      });
      const size = document.queryCommandValue('fontSize');
      if (size) setFontSize(size);
    } catch {
      // queryCommandState pode lançar fora de um contexto de seleção válido.
    }
  }

  function handleInput() {
    const html = editableRef.current?.innerHTML ?? '';
    lastEmitted.current = html;
    onChange(html);
    updateActiveState();
  }

  function focusEditor() {
    if (document.activeElement !== editableRef.current) editableRef.current?.focus();
  }

  function exec(command: string, arg?: string) {
    focusEditor();
    document.execCommand(command, false, arg);
    handleInput();
  }

  function clearFormatting() {
    focusEditor();
    document.execCommand('removeFormat');
    document.execCommand('justifyLeft');
    if (document.queryCommandState('insertUnorderedList')) {
      document.execCommand('insertUnorderedList');
    }
    handleInput();
  }

  function selectFontSize(size: string) {
    focusEditor();
    document.execCommand('fontSize', false, size);
    setSizeMenuOpen(false);
    handleInput();
  }

  function handlePaste(e: React.ClipboardEvent<HTMLDivElement>) {
    e.preventDefault();
    const html = e.clipboardData.getData('text/html');
    const text = e.clipboardData.getData('text/plain');
    const toInsert = html ? sanitizeRichText(html) : plainTextToHtml(text);
    document.execCommand('insertHTML', false, toInsert);
    handleInput();
  }

  return (
    <div
      className={cn(
        'rounded-lg border border-border bg-card overflow-hidden min-w-0 transition-[border-color,box-shadow]',
        'focus-within:border-primary focus-within:shadow-[0_0_0_3px_color-mix(in_oklab,var(--primary)_20%,transparent)]',
        invalid && 'border-alert',
      )}
    >
      <div className="flex flex-wrap items-center gap-0.5 p-1 border-b border-border bg-muted/40">
        <RichTextToolbarButton icon={Bold} label="Negrito" active={active.bold} onClick={() => exec('bold')} />
        <RichTextToolbarButton icon={Italic} label="Itálico" active={active.italic} onClick={() => exec('italic')} />
        <RichTextToolbarButton icon={Underline} label="Sublinhado" active={active.underline} onClick={() => exec('underline')} />

        {toolbar === 'full' && (
          <div className="relative" ref={sizeWrapRef}>
            <button
              ref={sizeBtnRef}
              type="button"
              title="Tamanho do texto"
              aria-label="Tamanho do texto"
              aria-expanded={sizeMenuOpen}
              aria-haspopup="listbox"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setSizeMenuOpen((v) => !v)}
              className={cn(
                'inline-flex items-center gap-0.5 h-9 px-2 shrink-0 rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground',
                sizeMenuOpen && 'bg-muted text-foreground',
              )}
            >
              <FontSizeIcon className="size-4" />
              <ChevronDown className="size-3" />
            </button>
            {sizeMenuOpen &&
              createPortal(
                <div
                  data-rt-size-menu
                  role="listbox"
                  style={sizeMenuStyle}
                  className="z-[1000] w-32 rounded-lg border border-border bg-card shadow-lg overflow-hidden py-1"
                >
                  {RICH_TEXT_FONT_SIZES.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      role="option"
                      aria-selected={fontSize === opt.value}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => selectFontSize(opt.value)}
                      className={cn(
                        'w-full text-left px-3 py-2 text-sm transition-colors hover:bg-muted/60',
                        fontSize === opt.value && 'text-primary font-semibold',
                      )}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>,
                document.body,
              )}
          </div>
        )}

        {toolbar === 'full' && (
          <RichTextToolbarButton icon={ListIcon} label="Lista com marcadores" active={active.list} onClick={() => exec('insertUnorderedList')} />
        )}

        {toolbar === 'full' && (
          <>
            <span className="w-px h-6 bg-border mx-0.5 shrink-0" aria-hidden />
            <RichTextToolbarButton icon={AlignLeft} label="Alinhar à esquerda" active={active.alignLeft} onClick={() => exec('justifyLeft')} />
            <RichTextToolbarButton icon={AlignCenter} label="Centralizar" active={active.alignCenter} onClick={() => exec('justifyCenter')} />
            <RichTextToolbarButton icon={AlignRight} label="Alinhar à direita" active={active.alignRight} onClick={() => exec('justifyRight')} />
          </>
        )}

        <span className="w-px h-6 bg-border mx-0.5 shrink-0" aria-hidden />
        <RichTextToolbarButton icon={Undo2} label="Desfazer" onClick={() => exec('undo')} />
        <RichTextToolbarButton icon={Redo2} label="Refazer" onClick={() => exec('redo')} />
        <RichTextToolbarButton icon={RemoveFormatting} label="Limpar formatação" onClick={clearFormatting} />
      </div>

      <div
        ref={editableRef}
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        aria-label={ariaLabel}
        onInput={handleInput}
        onPaste={handlePaste}
        onKeyUp={updateActiveState}
        onMouseUp={updateActiveState}
        onFocus={updateActiveState}
        className={cn(
          // `wrap-anywhere` (overflow-wrap: anywhere) em vez de `break-words`
          // (break-word): os dois quebram a linha, mas só `anywhere` também
          // reduz a LARGURA MÍNIMA do elemento. Com `break-word` uma palavra
          // gigante sem espaços continuava ditando o min-content e empurrando
          // os ancestrais — era o que estourava o modal de editar paciente.
          'rich-text-input w-full bg-transparent px-3 py-2.5 text-sm outline-none overflow-y-auto wrap-anywhere',
          '[&_ul]:list-disc [&_ul]:pl-5 [&_li]:my-0.5',
          minHeightClassName,
        )}
      />
    </div>
  );
}

function RichTextToolbarButton({
  icon: Icon,
  label,
  active,
  onClick,
}: {
  icon: typeof Bold;
  label: string;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={cn(
        'inline-flex items-center justify-center size-9 shrink-0 rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground',
        active && 'bg-primary/10 text-primary',
      )}
    >
      <Icon className="size-4" />
    </button>
  );
}

/* ---------------- Phone input (máscara reutilizável) ---------------- */
export function PhoneInput({
  label = 'WhatsApp',
  value,
  onChange,
  error,
  hint = 'Ex.: (41) 99999-9999',
  required,
}: {
  label?: string;
  value: string;
  onChange: (v: string) => void;
  error?: string;
  hint?: string;
  required?: boolean;
}) {
  return (
    <Field label={label} hint={hint} error={error} required={required}>
      <input
        inputMode="numeric"
        placeholder="(00) 00000-0000"
        className={cn('input', error && 'invalid')}
        value={formatPhoneBR(value)}
        onChange={(e) => onChange(onlyDigits(e.target.value))}
      />
    </Field>
  );
}

/* ---------------- Select (dropdown reutilizável) ---------------- */
interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: string;
  hint?: string;
  error?: string;
  options: Array<{ value: string; label: string }>;
  placeholder?: string;
}
export function SelectField({ label, hint, error, options, placeholder = 'Selecione…', required, ...rest }: SelectProps) {
  return (
    <Field label={label} hint={hint} error={error} required={required}>
      <select className={cn('input', error && 'invalid')} {...rest}>
        <option value="">{placeholder}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

/* ---------------- Custom Select (listbox estilizado, não nativo) ----------------
   Diferente do SelectField (acima, <select> nativo), este renderiza um botão +
   listbox próprio, reutilizando o mesmo padrão visual do ProfessionalCombobox.
   Motivo: no mobile, o menu aberto do <select> nativo é controlado pelo SO
   (iOS/Android) e não pode ser estilizado — fica cinza escuro/fora do design.
   Aqui o menu segue o design system (fundo branco, borda suave, hover azul,
   cantos arredondados). Acessível por teclado e confortável ao toque.

   A API é compatível com a do SelectField: `onChange` recebe um evento com
   `target.value`, então a chamada `(e) => setX(e.target.value)` não muda. */
export interface CustomSelectOption {
  value: string;
  label: string;
}

export function CustomSelect({
  label,
  hint,
  error,
  options,
  placeholder = 'Selecione…',
  required,
  value,
  onChange,
  disabled,
}: {
  label: string;
  hint?: string;
  error?: string;
  options: CustomSelectOption[];
  placeholder?: string;
  required?: boolean;
  value: string;
  onChange: (e: { target: { value: string } }) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [dropUp, setDropUp] = useState(false);
  const [menuStyle, setMenuStyle] = useState<React.CSSProperties>({});
  const wrapRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const listId = useId();

  const selected = useMemo(() => options.find((o) => o.value === value) ?? null, [options, value]);

  // Fecha ao clicar fora.
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      // O listbox é portado para o body, então wrapRef não o contém. Comparamos
      // o alvo tanto com o wrapper (botão) quanto com o próprio listbox (via
      // data-attribute) para não fechar ao clicar dentro dele.
      const t = e.target as Node | null;
      if (!t) return;
      if (wrapRef.current?.contains(t)) return;
      if (t instanceof Element && t.closest?.('[data-cs-listbox]')) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  // Posiciona o listbox (portado para o body) em relação ao botão e decide
  // abrir para cima quando não há espaço abaixo. Recalcula no scroll/resize para
  // acompanhar o botão (ex.: modal rolável). Portal evita clipping por containers
  // com overflow-auto/hidden (caso do modal "Filtros avançados") e z-index alto
  // garante que fique acima do rodapé do modal.
  useEffect(() => {
    if (!open) return;
    const btn = btnRef.current;
    if (!btn) return;

    const MAX_H = 240; // max-h-60 (15rem) do <ul>
    const GAP = 4; // mt-1 / mb-1

    const place = () => {
      const r = btn.getBoundingClientRect();
      const below = window.innerHeight - r.bottom - GAP;
      const above = r.top - GAP;
      const up = below < MAX_H && above > below;
      setDropUp(up);
      setMenuStyle({
        position: 'fixed',
        left: r.left,
        width: r.width,
        ...(up ? { bottom: window.innerHeight - r.top - GAP } : { top: r.bottom + GAP }),
      });
    };

    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open]);

  const prevOpen = useRef(open);

  // Reseta o destaque ao abrir e devolve o foco ao botão ao fechar.
  // prevOpen evita que o focus dispare no mount inicial (onde open é false),
  // o que antes fazia o último CustomSelect da página roubar o scroll.
  useEffect(() => {
    if (open) {
      setHighlight(0);
    } else if (prevOpen.current) {
      btnRef.current?.focus();
    }
    prevOpen.current = open;
  }, [open]);

  function choose(v: string) {
    onChange({ target: { value: v } });
    setOpen(false);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      setHighlight((h) => Math.min(h + 1, options.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      const o = options[highlight];
      if (o) choose(o.value);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
    }
  }

  return (
    <Field label={label} hint={hint} error={error} required={required}>
      <div className="relative" ref={wrapRef}>
        <button
          ref={btnRef}
          type="button"
          disabled={disabled}
          onClick={() => setOpen((v) => !v)}
          onKeyDown={onKeyDown}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={listId}
          className={cn(
            'input flex items-center justify-between gap-2 text-left',
            error && 'invalid',
            disabled && 'opacity-55 cursor-not-allowed',
          )}
        >
          <span className={cn('truncate', !selected && 'text-muted-foreground')}>{selected ? selected.label : placeholder}</span>
          <ChevronDown className={cn('size-4 text-muted-foreground shrink-0 transition-transform', open && 'rotate-180')} />
        </button>

        {open &&
          createPortal(
            <div
              data-cs-listbox
              className={cn(
                'z-[1000] rounded-lg border border-border bg-card shadow-lg overflow-hidden',
                dropUp ? 'animate-dropup' : 'animate-entry',
              )}
              style={menuStyle}
            >
              <ul id={listId} role="listbox" className="max-h-60 overflow-y-auto py-1">
                {options.length === 0 ? (
                  <li className="px-3 py-3 text-sm text-muted-foreground text-center">Sem opções</li>
                ) : (
                  options.map((o, i) => {
                    const active = o.value === value;
                    return (
                      <li key={o.value} role="option" aria-selected={active}>
                        <button
                          type="button"
                          onClick={() => choose(o.value)}
                          onMouseEnter={() => setHighlight(i)}
                          className={cn(
                            'w-full text-left px-3 py-2.5 flex items-center gap-2 transition-colors',
                            i === highlight ? 'bg-primary/10' : 'hover:bg-muted/60',
                            active && 'text-primary font-semibold',
                          )}
                        >
                          <span className="text-sm truncate flex-1">{o.label}</span>
                          {active && <Check className="size-4 text-primary shrink-0" />}
                        </button>
                      </li>
                    );
                  })
                )}
              </ul>
            </div>,
            document.body,
          )}
      </div>
    </Field>
  );
}

/* ---------------- Overlay compartilhado de modais/drawers ----------------

   TODO modal, drawer, sheet e lightbox do app monta o scrim por aqui. O que o
   wrapper resolve de uma vez só (antes cada tela repetia a `div` na mão e
   nenhuma tinha estes comportamentos):

   1. PORTAL para o <body>. Obrigatório, não é preferência de estilo: qualquer
      ancestral com `transform` vira containing block de `position: fixed`, e o
      scrim para de cobrir a viewport — passa a cobrir só aquele bloco, o que
      "lava" o conteúdo e descentraliza o modal. Vários containers do app usam
      `animate-entry`, cuja animação tem `fill-mode: both` e deixa um
      `transform: matrix(...)` residual; foi assim que o bug apareceu na aba
      Configurações → Regras Clínicas.
   2. `w-screen` (100vw) junto do `inset-0`: com o scroll travado a barra de
      rolagem some, e um `right: 0` pararia ~15px antes da borda, deixando uma
      faixa clara sem escurecer.
   3. TRAVA DE SCROLL no elemento que REALMENTE rola. Aqui o `html` tem
      `overflow-x: clip`, então é ele (não o `body`) o scroller. A folga da
      barra é MEDIDA depois de travar, nunca presumida — descontá-la às cegas
      encolhe o conteúdo, que é justamente o "pulo" que ela deveria evitar.
      Aninhamento funciona: cada camada salva e restaura o valor anterior.
   4. ESC e clique no fundo fecham (ambos desligáveis).
   5. Foco inicial opcional: o primeiro `[data-autofocus]` de dentro do modal.

   O `className` recebe z-index, cor/blur do scrim e alinhamento do painel —
   assim cada tela mantém o visual que já tinha e só o comportamento é comum.
*/
/**
 * Pilha de overlays abertos. O ESC é um listener de `document`, então com dois
 * modais abertos (drawer + lightbox, drawer + confirmação) TODOS ouviriam a
 * tecla e fechariam juntos. Só o topo da pilha responde.
 */
const overlayStack: symbol[] = [];

/**
 * Estado da trava de scroll, guardado FORA do componente e liberado só quando a
 * pilha esvazia.
 *
 * Não dá para cada camada salvar/restaurar o valor anterior por conta própria:
 * quando um modal e o seu filho (prontuário + "Descartar alterações?") somem no
 * MESMO commit, o React roda a limpeza do pai antes da do filho — o pai
 * destravava e o filho, logo depois, restaurava o `hidden` que tinha herdado,
 * deixando a página presa. Contando as camadas, a ordem deixa de importar.
 */
let scrollLock: { scroller: HTMLElement; overflow: string; padding: string } | null = null;

function travarScroll() {
  if (scrollLock) return; // já travado por uma camada de fora
  const { body } = document;
  const scroller = (document.scrollingElement ?? document.documentElement) as HTMLElement;
  const larguraAntes = scroller.clientWidth;
  scrollLock = { scroller, overflow: scroller.style.overflow, padding: body.style.paddingRight };
  scroller.style.overflow = 'hidden';
  // A folga da barra é MEDIDA depois de travar, nunca presumida: aqui o `html`
  // tem `overflow-x: clip` e é ele o scroller, então descontar a largura da
  // barra às cegas encolheria o conteúdo — o "pulo" que se quer evitar.
  const folga = scroller.clientWidth - larguraAntes;
  if (folga > 0) body.style.paddingRight = `${folga}px`;
}

function destravarScroll() {
  if (overlayStack.length > 0 || !scrollLock) return; // ainda há modal aberto
  scrollLock.scroller.style.overflow = scrollLock.overflow;
  document.body.style.paddingRight = scrollLock.padding;
  scrollLock = null;
}

export function ModalOverlay({
  onClose,
  className,
  closeOnBackdrop = true,
  closeOnEsc = true,
  ariaLabel,
  ariaLabelledBy,
  children,
}: {
  /** Fecha o modal — usado pelo ESC e pelo clique no fundo. */
  onClose: () => void;
  /** Classes do scrim: z-index, cor/blur e alinhamento/padding do painel. */
  className?: string;
  closeOnBackdrop?: boolean;
  closeOnEsc?: boolean;
  ariaLabel?: string;
  ariaLabelledBy?: string;
  children: ReactNode;
}) {
  const scrimRef = useRef<HTMLDivElement>(null);
  // onClose costuma vir como arrow inline: guardar em ref mantém o efeito
  // rodando UMA vez só (senão ele re-focaria o campo a cada tecla digitada).
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const escRef = useRef(closeOnEsc);
  escRef.current = closeOnEsc;

  useEffect(() => {
    const id = Symbol('modal-overlay');
    overlayStack.push(id);

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || !escRef.current) return;
      if (overlayStack[overlayStack.length - 1] !== id) return; // só o modal do topo
      closeRef.current();
    };
    document.addEventListener('keydown', onKeyDown);

    travarScroll();

    scrimRef.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus();

    return () => {
      const i = overlayStack.lastIndexOf(id);
      if (i >= 0) overlayStack.splice(i, 1);
      document.removeEventListener('keydown', onKeyDown);
      destravarScroll();
    };
  }, []);

  return createPortal(
    <div
      ref={scrimRef}
      className={cn('fixed inset-0 w-screen flex', className)}
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy}
      // Compara com o currentTarget: só o clique no PRÓPRIO scrim fecha, então
      // o painel não precisa mais de `stopPropagation` para se defender.
      onClick={closeOnBackdrop ? (e) => { if (e.target === e.currentTarget) closeRef.current(); } : undefined}
    >
      {children}
    </div>,
    document.body,
  );
}

/* ---------------- Confirm modal (ação destrutiva) ---------------- */
export function ConfirmModal({
  title,
  message,
  confirmLabel = 'Confirmar',
  requireText,
  onConfirm,
  onCancel,
  busy,
  confirmInput,
  onConfirmInputChange,
}: {
  title: string;
  message: string;
  confirmLabel?: string;
  requireText?: string; // se definido, exige digitar este texto para habilitar
  onConfirm: () => void;
  onCancel: () => void;
  busy?: boolean;
  confirmInput?: string;
  onConfirmInputChange?: (v: string) => void;
}) {
  const enabled = !requireText || confirmInput?.trim().toUpperCase() === requireText.toUpperCase();

  // Foco inicial (`data-autofocus`): o campo de confirmação quando existe — ele
  // vem antes no DOM —, senão o botão primário.
  return (
    <ModalOverlay
      onClose={onCancel}
      className="z-50 bg-foreground/50 backdrop-blur-sm items-center justify-center p-4 overflow-y-auto"
    >
      <div className="bg-card border border-border rounded-xl shadow-lg p-6 w-full max-w-md my-auto max-h-[90vh] overflow-y-auto animate-entry">
        <h2 className="text-lg font-extrabold tracking-tight">{title}</h2>
        <p className="text-sm text-muted-foreground mt-1.5">{message}</p>
        {requireText && (
          <div className="mt-4">
            <Field label={`Digite "${requireText}" para confirmar`}>
              <input
                className="input"
                data-autofocus
                value={confirmInput ?? ''}
                onChange={(e) => onConfirmInputChange?.(e.target.value)}
              />
            </Field>
          </div>
        )}
        <div className="flex items-center justify-between gap-3 mt-6">
          <Button variant="ghost" onClick={onCancel}>
            Cancelar
          </Button>
          <Button variant="danger" onClick={onConfirm} disabled={!enabled} loading={busy} data-autofocus>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </ModalOverlay>
  );
}

/* ---------------- Intensity scale (dor / dispneia) ---------------- */
export function IntensityScale({
  value,
  onChange,
  colorFor,
  leftLabel,
  rightLabel,
}: {
  value: number | null;
  onChange: (v: number) => void;
  colorFor: (n: number) => 'g' | 'y' | 'r';
  leftLabel: string;
  rightLabel: string;
}) {
  const ACTIVE: Record<'g' | 'y' | 'r', string> = {
    g: 'bg-stable text-stable-foreground',
    y: 'bg-warning text-warning-foreground',
    r: 'bg-alert text-alert-foreground',
  };
  return (
    <div>
      <div className="grid grid-cols-11 gap-1">
        {Array.from({ length: 11 }, (_, n) => {
          const active = value === n;
          return (
            <button
              key={n}
              type="button"
              className={cn(
                'aspect-square rounded-md text-xs font-bold transition-all',
                active
                  ? cn(ACTIVE[colorFor(n)], 'scale-110 shadow-md')
                  : 'bg-muted text-muted-foreground hover:bg-muted/80',
              )}
              aria-pressed={active}
              onClick={() => onChange(n)}
            >
              {n}
            </button>
          );
        })}
      </div>
      <div className="flex justify-between mt-2 text-[10px] font-semibold text-muted-foreground uppercase">
        <span>{leftLabel}</span>
        <span>{rightLabel}</span>
      </div>
    </div>
  );
}

/* ---------------- Yes / No toggle ---------------- */
export function YesNo({ value, onChange }: { value: boolean | null; onChange: (v: boolean) => void }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      {([true, false] as const).map((opt) => {
        const active = value === opt;
        return (
          <button
            key={String(opt)}
            type="button"
            onClick={() => onChange(opt)}
            className={cn(
              'py-4 rounded-xl font-bold text-sm border-2 transition-all',
              active
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-border bg-card text-muted-foreground hover:border-primary/30',
            )}
          >
            {opt ? 'Sim' : 'Não'}
          </button>
        );
      })}
    </div>
  );
}

export function Loading({ label = 'Carregando…' }: { label?: string }) {
  return <div className="text-center text-muted-foreground py-6 animate-pulse">{label}</div>;
}

/* ---------------- Tag única do profissional (identificador visual/busca) ----------------
   Badge discreta exibida ao lado/abaixo do nome. Não compete com o nome: tipografia
   menor, monoespaçada e tom suave. Não renderiza nada quando não há tag. */
export function ProfessionalTag({ tag, className }: { tag?: string | null; className?: string }) {
  if (!tag) return null;
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md bg-muted px-1.5 py-0.5 font-mono text-[11px] font-semibold tracking-tight text-muted-foreground',
        className,
      )}
      title={`Identificador do profissional: ${tag}`}
    >
      {tag}
    </span>
  );
}

/* ---------------- Combobox pesquisável de profissionais ----------------
   Substitui o <select> simples quando há muitos profissionais: busca por nome,
   tag ou e-mail, com resultado mostrando nome + tag + papel/e-mail. Salva sempre
   o id interno (value/onChange) — a tag é só apoio à identificação. Mobile-friendly. */
export interface ProfessionalOption {
  id: string;
  name: string;
  tag: string | null;
  email?: string | null;
  roleLabel?: string | null;
}

export function ProfessionalCombobox({
  label,
  value,
  onChange,
  options,
  placeholder = 'Buscar por nome ou tag…',
  hint,
  error,
  required,
  disabled,
  emptyText = 'Nenhum profissional encontrado.',
}: {
  label: string;
  value: string;
  onChange: (id: string) => void;
  options: ProfessionalOption[];
  placeholder?: string;
  hint?: string;
  error?: string;
  required?: boolean;
  disabled?: boolean;
  emptyText?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  const selected = useMemo(() => options.find((o) => o.id === value) ?? null, [options, value]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(
      (o) =>
        o.name.toLowerCase().includes(q) ||
        (o.tag ?? '').toLowerCase().includes(q) ||
        (o.email ?? '').toLowerCase().includes(q),
    );
  }, [options, query]);

  // Fecha ao clicar fora.
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  // Foca a busca ao abrir; limpa o termo ao fechar.
  useEffect(() => {
    if (open) {
      setHighlight(0);
      const t = setTimeout(() => inputRef.current?.focus(), 0);
      return () => clearTimeout(t);
    }
    setQuery('');
  }, [open]);

  function choose(id: string) {
    onChange(id);
    setOpen(false);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const o = filtered[highlight];
      if (o) choose(o.id);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
    }
  }

  return (
    <Field label={label} hint={hint} error={error} required={required}>
      <div className="relative" ref={wrapRef}>
        <button
          type="button"
          disabled={disabled}
          onClick={() => setOpen((v) => !v)}
          className={cn(
            'input flex items-center justify-between gap-2 text-left',
            error && 'invalid',
            disabled && 'opacity-55 cursor-not-allowed',
          )}
          aria-haspopup="listbox"
          aria-expanded={open}
        >
          <span className={cn('truncate', !selected && 'text-muted-foreground')}>
            {selected ? (
              <span className="inline-flex items-center gap-2 min-w-0">
                <span className="truncate">{selected.name}</span>
                {selected.tag && <span className="font-mono text-[11px] text-muted-foreground shrink-0">{selected.tag}</span>}
              </span>
            ) : (
              placeholder
            )}
          </span>
          <ChevronDown className="size-4 text-muted-foreground shrink-0" />
        </button>

        {open && (
          <div className="absolute z-30 mt-1 w-full rounded-lg border border-border bg-card shadow-lg overflow-hidden">
            <div className="relative border-b border-border">
              <Search className="size-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setHighlight(0);
                }}
                onKeyDown={onKeyDown}
                placeholder={placeholder}
                className="w-full bg-transparent py-2.5 pl-9 pr-3 text-sm outline-none"
                aria-controls={listId}
              />
            </div>
            <ul id={listId} role="listbox" className="max-h-60 overflow-y-auto py-1">
              {filtered.length === 0 ? (
                <li className="px-3 py-3 text-sm text-muted-foreground text-center">{emptyText}</li>
              ) : (
                filtered.map((o, i) => {
                  const active = o.id === value;
                  return (
                    <li key={o.id} role="option" aria-selected={active}>
                      <button
                        type="button"
                        onClick={() => choose(o.id)}
                        onMouseEnter={() => setHighlight(i)}
                        className={cn(
                          'w-full text-left px-3 py-2.5 flex items-center gap-2 transition-colors',
                          i === highlight ? 'bg-muted' : 'hover:bg-muted/60',
                        )}
                      >
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-semibold truncate">{o.name}</span>
                            {o.tag && <span className="font-mono text-[11px] text-muted-foreground">{o.tag}</span>}
                          </span>
                          {(o.email || o.roleLabel) && (
                            <span className="block text-xs text-muted-foreground truncate">
                              {[o.roleLabel, o.email].filter(Boolean).join(' · ')}
                            </span>
                          )}
                        </span>
                        {active && <Check className="size-4 text-primary shrink-0" />}
                      </button>
                    </li>
                  );
                })
              )}
            </ul>
          </div>
        )}
      </div>
    </Field>
  );
}
