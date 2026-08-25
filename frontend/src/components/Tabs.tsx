/**
 * Tabs — abas acessíveis com deep-link por query string.
 *
 * Criado para a tela de Acompanhamento Individual, que tinha ~9 seções numa
 * rolagem única: interminável no mobile e desperdiçando largura no desktop.
 *
 * A aba ativa vive na URL (`?tab=`), não em estado local nem em storage: o
 * link é compartilhável, o botão voltar funciona e o papel do usuário pode
 * definir a aba inicial sem "lembrar" nada do navegador.
 *
 * Acessibilidade: `role="tablist"`/`tab`/`tabpanel`, `aria-selected`, navegação
 * por setas e foco visível. No mobile a faixa rola horizontalmente DENTRO de si
 * (a página nunca ganha scroll horizontal).
 */
import { useCallback, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { cn } from './ui';

export interface TabDef {
  id: string;
  label: string;
  /** Rótulo curto para telas estreitas (cai no `label` quando ausente). */
  shortLabel?: string;
  /** Selo de pendência: número ou texto curto. */
  badge?: string | number | null;
  /** Selo em tom de alerta (ex.: recontato em atraso). */
  badgeTone?: 'alert' | 'warning' | 'neutral';
  content: ReactNode;
}

const TONE: Record<NonNullable<TabDef['badgeTone']>, string> = {
  alert: 'bg-alert text-white',
  warning: 'bg-warning text-white',
  neutral: 'bg-muted text-muted-foreground border border-border',
};

export function Tabs({
  tabs,
  defaultTab,
  param = 'tab',
  ariaLabel,
}: {
  tabs: TabDef[];
  /** Aba inicial quando a URL não traz `?tab=` (usada para variar por papel). */
  defaultTab?: string;
  param?: string;
  ariaLabel: string;
}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const pedida = searchParams.get(param);
  // Uma aba desconhecida na URL não pode quebrar a tela — cai no default.
  const ativa = tabs.find((t) => t.id === pedida)?.id ?? defaultTab ?? tabs[0]?.id;

  const selecionar = useCallback(
    (id: string) => {
      const next = new URLSearchParams(searchParams);
      next.set(param, id);
      // `replace`: trocar de aba não deve encher o histórico do navegador.
      setSearchParams(next, { replace: true });
    },
    [param, searchParams, setSearchParams],
  );

  function onKeyDown(e: React.KeyboardEvent<HTMLButtonElement>, index: number) {
    const delta = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (delta === 0) return;
    e.preventDefault();
    const proxima = tabs[(index + delta + tabs.length) % tabs.length];
    if (!proxima) return;
    selecionar(proxima.id);
    document.getElementById(`tab-${proxima.id}`)?.focus();
  }

  return (
    <div className="space-y-4">
      <div
        role="tablist"
        aria-label={ariaLabel}
        className="flex gap-1 overflow-x-auto bg-muted rounded-lg p-1 -mx-1 px-1 sm:mx-0 scrollbar-none"
      >
        {tabs.map((t, i) => {
          const selecionada = t.id === ativa;
          return (
            <button
              key={t.id}
              id={`tab-${t.id}`}
              role="tab"
              type="button"
              aria-selected={selecionada}
              aria-controls={`painel-${t.id}`}
              tabIndex={selecionada ? 0 : -1}
              onClick={() => selecionar(t.id)}
              onKeyDown={(e) => onKeyDown(e, i)}
              className={cn(
                'shrink-0 min-h-10 px-3 sm:px-4 rounded-md text-xs sm:text-sm font-semibold transition-colors',
                'inline-flex items-center gap-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
                selecionada ? 'bg-card shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <span className="hidden sm:inline">{t.label}</span>
              <span className="sm:hidden">{t.shortLabel ?? t.label}</span>
              {t.badge != null && t.badge !== '' && (
                <span
                  className={cn(
                    'inline-flex items-center justify-center rounded-full px-1.5 min-w-5 h-5 text-[10px] font-bold',
                    TONE[t.badgeTone ?? 'neutral'],
                  )}
                >
                  {t.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {tabs.map((t) => (
        <div
          key={t.id}
          id={`painel-${t.id}`}
          role="tabpanel"
          aria-labelledby={`tab-${t.id}`}
          hidden={t.id !== ativa}
          className="space-y-4 animate-entry"
        >
          {/* Só monta o conteúdo da aba ativa: evita 3 telas de gráficos e
              requisições de seções que ninguém está olhando. */}
          {t.id === ativa && t.content}
        </div>
      ))}
    </div>
  );
}
