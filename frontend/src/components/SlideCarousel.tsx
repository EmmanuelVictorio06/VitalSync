/**
 * SlideCarousel — carrossel horizontal de um item por vez, com scroll-snap,
 * setas, contador "3 / 14" e pontinhos.
 *
 * Nasceu extraído de `PatientMeasurementPhotoSection` (components/photo.tsx),
 * que era o único carrossel de registros do app. Agora as fotos de
 * acompanhamento e o carrossel de "Indicadores do registro" usam ESTE
 * componente — interação, setas e estilo saem de um lugar só.
 *
 * O invólucro fica com quem chama (a seção de fotos é um card, a de
 * indicadores é um bloco solto): aqui só entram cabeçalho + trilho + pontinhos.
 * `header` é o conteúdo da esquerda; a navegação é encaixada à direita na mesma
 * linha, e some quando há um único slide.
 *
 * Swipe funciona de graça: o trilho é um scroller nativo com `snap-mandatory`;
 * `onScroll` só reposiciona o indicador quando o usuário arrasta.
 */
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from './ui';

export interface SlideCarouselProps<T> {
  items: T[];
  /** Chave estável do slide (não use o índice: a lista muda com os filtros). */
  getKey: (item: T, index: number) => string;
  /** Conteúdo de um slide. */
  renderItem: (item: T, index: number) => ReactNode;
  /** Lado esquerdo do cabeçalho (título, selos). Recebe o item em foco. */
  header?: (item: T | null, index: number) => ReactNode;
  /** Rótulos de acessibilidade — cada tela nomeia o que está navegando. */
  prevLabel: string;
  nextLabel: string;
  dotLabel: (index: number) => string;
  /** Mostrado no lugar do trilho quando não há itens. */
  empty?: ReactNode;
  className?: string;
}

export function SlideCarousel<T>({
  items,
  getKey,
  renderItem,
  header,
  prevLabel,
  nextLabel,
  dotLabel,
  empty,
  className,
}: SlideCarouselProps<T>) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  const count = items.length;
  // O índice pode ficar fora da faixa quando a lista encolhe (troca de filtro).
  const current = Math.min(index, Math.max(0, count - 1));

  /* Lista trocou (filtro de período, recarga dos dados) → volta para o
     primeiro slide. Sem isto o índice antigo sobrevive e o usuário troca o
     filtro caindo no meio do histórico, com o trilho ainda rolado — e o
     cabeçalho passa a descrever um registro que não é o que está na tela.
     A assinatura são as chaves: muda quando a lista muda de verdade, não a
     cada render.

     `useLayoutEffect` + `behavior: 'instant'` de propósito: o trilho tem
     `scroll-smooth` no CSS, e aí um `scrollTo` com `auto` HERDA o smooth e
     anima — a troca de filtro ficava com o contador em 1/N e o trilho ainda
     parado no slide antigo. 'instant' ignora o CSS, e o layout effect corre
     antes da pintura, então não há salto visível. */
  const signature = items.map(getKey).join('|');
  useLayoutEffect(() => {
    setIndex(0);
    trackRef.current?.scrollTo({ left: 0, behavior: 'instant' });
  }, [signature]);

  /**
   * Posição em que o slide fica CENTRALIZADO — o ponto de snap que os slides
   * declaram (`snap-center`), e não o `offsetLeft` cru.
   */
  function snapTarget(slide: HTMLElement, track: HTMLDivElement): number {
    return slide.offsetLeft - track.offsetLeft - (track.clientWidth - slide.clientWidth) / 2;
  }

  /**
   * Vai para o slide `i`.
   *
   * O salto é INSTANTÂNEO de propósito. Com `snap-mandatory`, um scroll suave
   * programático é re-avaliado pelo navegador sempre que o conteúdo do trilho
   * re-renderiza no meio da animação — e o snap devolve o trilho para o slide
   * de origem. O sintoma era traiçoeiro: o contador andava ("2 / 3") e o
   * trilho ficava parado, de forma INTERMITENTE, dependendo de haver ou não
   * um re-render naquele instante. Com 'instant' o navegador aplica o snap uma
   * vez, a partir da posição final, e o resultado é sempre o mesmo.
   * ('instant' também ignora o `scroll-behavior` do CSS, então não há como o
   * estilo reintroduzir a animação por baixo.)
   *
   * O arrasto/swipe do usuário continua suave: quem anima ali é o navegador,
   * não este código.
   */
  function goTo(i: number) {
    const clamped = Math.max(0, Math.min(count - 1, i));
    const track = trackRef.current;
    const slide = track?.children[clamped] as HTMLElement | undefined;
    if (track && slide) track.scrollTo({ left: snapTarget(slide, track), behavior: 'instant' });
    setIndex(clamped);
  }

  /** Mantém o indicador em sincronia quando o usuário arrasta/rola manualmente. */
  function handleScroll() {
    const track = trackRef.current;
    if (!track) return;
    const center = track.scrollLeft + track.clientWidth / 2;
    let nearest = 0;
    let best = Infinity;
    Array.from(track.children).forEach((c, i) => {
      const el = c as HTMLElement;
      const mid = el.offsetLeft - track.offsetLeft + el.clientWidth / 2;
      const dist = Math.abs(mid - center);
      if (dist < best) {
        best = dist;
        nearest = i;
      }
    });
    setIndex(nearest);
  }

  return (
    <div className={cn('space-y-4', className)}>
      <header className="flex items-center gap-2 flex-wrap">
        {header?.(items[current] ?? null, current)}
        {count > 1 && (
          <div className="ml-auto flex items-center gap-1.5">
            <span className="text-xs font-semibold text-muted-foreground tabular-nums mr-1">
              {current + 1} / {count}
            </span>
            <NavButton label={prevLabel} disabled={current === 0} onClick={() => goTo(current - 1)}>
              <ChevronLeft className="size-4" />
            </NavButton>
            <NavButton label={nextLabel} disabled={current === count - 1} onClick={() => goTo(current + 1)}>
              <ChevronRight className="size-4" />
            </NavButton>
          </div>
        )}
      </header>

      {count === 0 ? (
        empty
      ) : (
        <>
          <div
            ref={trackRef}
            onScroll={handleScroll}
            className="flex gap-4 overflow-x-auto snap-x snap-mandatory -mx-1 px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {items.map((item, i) => (
              <div key={getKey(item, i)} className="snap-center shrink-0 w-full">
                {renderItem(item, i)}
              </div>
            ))}
          </div>

          {count > 1 && (
            <div className="flex justify-center gap-1.5 pt-1">
              {items.map((item, i) => (
                <button
                  key={getKey(item, i)}
                  type="button"
                  onClick={() => goTo(i)}
                  aria-label={dotLabel(i)}
                  aria-current={i === current}
                  className={cn(
                    'h-1.5 rounded-full transition-all',
                    i === current ? 'w-5 bg-primary' : 'w-1.5 bg-border hover:bg-muted-foreground/40',
                  )}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function NavButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="size-8 grid place-items-center rounded-full border border-border bg-card text-muted-foreground hover:text-primary hover:border-primary/40 disabled:opacity-40 disabled:hover:text-muted-foreground disabled:hover:border-border transition-colors"
    >
      {children}
    </button>
  );
}
