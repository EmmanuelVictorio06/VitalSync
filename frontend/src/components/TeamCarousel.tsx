/**
 * Carrossel de seleção de equipes — usado na página "Minha Equipe" do Cirurgião
 * Principal. Mobile-first: 2 cards visíveis por vez (≥2 equipes), swipe com
 * scroll-snap, setas discretas e pontinhos por página. Com 1 equipe, o card fica
 * centralizado, sem setas/pontinhos.
 *
 * Estado separado por responsabilidade:
 *  - `activeIndex`/`onSelect`  → equipe selecionada (controla o conteúdo da página);
 *  - scroll do trilho          → página visível (controla setas e pontinhos).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Stethoscope } from 'lucide-react';
import { cn } from './ui';
import type { TeamDetail } from '../services/teamViewService';

interface TeamCarouselProps {
  teams: TeamDetail[];
  activeIndex: number;
  onSelect: (index: number) => void;
}

/** Espaçamento entre cards (deve casar com `gap-3` do trilho). */
const GAP = 12;

export function TeamCarousel({ teams, activeIndex, onSelect }: TeamCarouselProps) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  // Passo de scroll por card e quantos cards cabem por visão (recalculados a cada
  // resize a partir da medição real — adaptam-se ao breakpoint).
  const metrics = useRef({ step: 1, perView: 1 });
  const [page, setPage] = useState(0);
  const [pageCount, setPageCount] = useState(1);
  const [canPrev, setCanPrev] = useState(false);
  const [canNext, setCanNext] = useState(false);

  const sync = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const first = el.firstElementChild as HTMLElement | null;
    const itemW = first?.getBoundingClientRect().width ?? el.clientWidth;
    const step = itemW + GAP;
    const perView = Math.max(1, Math.round((el.clientWidth + GAP) / step));
    metrics.current = { step, perView };

    // Pontinhos = páginas (grupos de `perView` cards): 4/2=2, 5/2=3, 6/2=3…
    const pages = Math.max(1, Math.ceil(teams.length / perView));
    const currentItem = Math.round(el.scrollLeft / step);
    setPageCount(pages);
    setPage(Math.min(pages - 1, Math.round(currentItem / perView)));
    setCanPrev(el.scrollLeft > 4);
    setCanNext(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
  }, [teams.length]);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    sync();
    el.addEventListener('scroll', sync, { passive: true });
    window.addEventListener('resize', sync);
    return () => {
      el.removeEventListener('scroll', sync);
      window.removeEventListener('resize', sync);
    };
  }, [sync, teams.length]);

  const scrollByPage = (dir: -1 | 1) => {
    const el = scrollerRef.current;
    if (!el) return;
    const { step, perView } = metrics.current;
    el.scrollBy({ left: dir * step * perView, behavior: 'smooth' });
  };
  const goToPage = (p: number) => {
    const el = scrollerRef.current;
    if (!el) return;
    const { step, perView } = metrics.current;
    el.scrollTo({ left: p * step * perView, behavior: 'smooth' });
  };

  // Uma única equipe: card centralizado, sem navegação.
  if (teams.length === 1) {
    return (
      <section className="space-y-2 animate-entry" aria-label="Suas equipes">
        <CarouselHeader count={teams.length} />
        <div className="flex justify-center">
          <div className="w-full max-w-xs">
            <TeamCarouselItem team={teams[0]!} active onSelect={() => onSelect(0)} />
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-2.5 animate-entry" aria-label="Suas equipes">
      <CarouselHeader count={teams.length} />

      <div className="relative">
        <TeamCarouselArrow side="left" show={canPrev} onClick={() => scrollByPage(-1)} />
        <TeamCarouselArrow side="right" show={canNext} onClick={() => scrollByPage(1)} />

        <div
          ref={scrollerRef}
          role="tablist"
          aria-label="Selecionar equipe"
          className="flex gap-3 overflow-x-auto snap-x snap-mandatory scroll-smooth pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {teams.map((t, i) => (
            <div
              key={t.summary.id}
              className="snap-start shrink-0 basis-[calc(50%-6px)] sm:basis-[calc(33.333%-8px)] lg:basis-[calc(25%-9px)]"
            >
              <TeamCarouselItem team={t} active={i === activeIndex} onSelect={() => onSelect(i)} />
            </div>
          ))}
        </div>
      </div>

      {pageCount > 1 && <TeamCarouselIndicators page={page} pageCount={pageCount} onGo={goToPage} />}
    </section>
  );
}

function CarouselHeader({ count }: { count: number }) {
  return (
    <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground px-0.5">
      Suas equipes · {count}
    </p>
  );
}

function TeamCarouselItem({ team, active, onSelect }: { team: TeamDetail; active: boolean; onSelect: () => void }) {
  const { summary } = team;
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onSelect}
      className={cn(
        'w-full h-full text-left rounded-xl border p-3 flex items-center gap-2.5 transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-primary',
        active
          ? 'bg-primary border-primary text-primary-foreground shadow-md shadow-primary/25'
          : 'bg-card border-border text-foreground hover:bg-muted hover:border-primary/30',
      )}
    >
      <span className={cn(
        'size-9 rounded-lg flex items-center justify-center shrink-0 transition-colors',
        active ? 'bg-primary-foreground/20 text-primary-foreground' : 'bg-primary/10 text-primary',
      )}>
        <Stethoscope className="size-4" />
      </span>
      <span className="min-w-0 flex flex-col leading-tight">
        <span className="text-sm font-bold truncate">Equipe nº {String(summary.number).padStart(2, '0')}</span>
        <span className={cn('text-[11px] font-medium truncate', active ? 'text-primary-foreground/80' : 'text-muted-foreground')}>
          {summary.stats.monitoring} paciente(s)
          {summary.stats.unattendedAlerts > 0 && ` · ${summary.stats.unattendedAlerts} alerta(s)`}
        </span>
      </span>
    </button>
  );
}

function TeamCarouselArrow({ side, show, onClick }: { side: 'left' | 'right'; show: boolean; onClick: () => void }) {
  const Icon = side === 'left' ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={side === 'left' ? 'Equipe anterior' : 'Próxima equipe'}
      tabIndex={show ? 0 : -1}
      className={cn(
        'absolute top-1/2 -translate-y-1/2 z-10 size-7 rounded-full bg-card/50 backdrop-blur-sm border border-border/50',
        'flex items-center justify-center text-muted-foreground transition-all hover:bg-card/90 hover:text-foreground',
        side === 'left' ? 'left-1' : 'right-1',
        show ? 'opacity-60 hover:opacity-100' : 'opacity-0 pointer-events-none',
      )}
    >
      <Icon className="size-3.5" />
    </button>
  );
}

function TeamCarouselIndicators({ page, pageCount, onGo }: { page: number; pageCount: number; onGo: (p: number) => void }) {
  return (
    <div className="flex justify-center items-center gap-1.5 pt-0.5">
      {Array.from({ length: pageCount }).map((_, p) => (
        <button
          key={p}
          type="button"
          onClick={() => onGo(p)}
          aria-label={`Ir para página ${p + 1} de ${pageCount}`}
          aria-current={p === page}
          className={cn(
            'h-1.5 rounded-full transition-all',
            p === page ? 'w-5 bg-primary' : 'w-1.5 bg-border hover:bg-muted-foreground/40',
          )}
        />
      ))}
    </div>
  );
}
