import { type MouseEvent } from 'react';
import { Link } from 'react-router-dom';
import { useTheme } from '../theme/ThemeContext';
import { cn } from './ui';

type VitalSyncLogoTone = 'default' | 'onPrimary';
type VitalSyncLogoSize = 'sm' | 'md';

const MARK_SRC: Record<VitalSyncLogoTone, string> = {
  default: '/logo-simbolo.svg',
  onPrimary: '/logo-simbolo-branco.svg',
};

/** Símbolo (cruz médica monoline) isolado, sem o texto "VitalSync" ao lado —
 *  para os pontos do app que já têm seu próprio bloco de texto/legenda e só
 *  precisam trocar o ícone. Decorativo: `alt=""` + `aria-hidden`, o nome já
 *  aparece como texto real ao lado em todos os usos.
 *
 *  NUNCA renderizar abaixo de 32px: ao contrário do `Heart` sólido que ele
 *  substituiu, este símbolo é monoline com vazados internos e um nó circular
 *  no centro — abaixo de ~32px esses traços finos se fundem numa mancha azul
 *  irreconhecível. Alvo padrão em cabeçalhos/barras de navegação: 40px. Onde
 *  não couber ao menos 32px, remova o símbolo e deixe só o texto — não o
 *  encolha. */
export function VitalSyncMark({
  tone = 'default',
  width,
  height,
  className,
}: {
  tone?: VitalSyncLogoTone;
  width: number;
  height: number;
  className?: string;
}) {
  // O azul #0B63EE do arquivo é fixo (não é token CSS) e some sobre fundo
  // escuro — então, além de "onPrimary" (faixa azul sólida), o tema escuro
  // também força a variante branca, mesmo com tone="default".
  const { temaEfetivo } = useTheme();
  const src = tone === 'onPrimary' || temaEfetivo === 'escuro' ? MARK_SRC.onPrimary : MARK_SRC.default;
  return (
    <img
      src={src}
      alt=""
      aria-hidden="true"
      width={width}
      height={height}
      className={cn('object-contain shrink-0', className)}
    />
  );
}

export function VitalSyncLogo({
  to = '/',
  tone = 'default',
  size = 'md',
  className,
  onNavigate,
}: {
  to?: string;
  tone?: VitalSyncLogoTone;
  size?: VitalSyncLogoSize;
  className?: string;
  onNavigate?: (event: MouseEvent<HTMLAnchorElement>) => void;
}) {
  const isSmall = size === 'sm';
  const onPrimary = tone === 'onPrimary';

  return (
    <Link
      to={to}
      onClick={onNavigate}
      aria-label="Ir para a página inicial"
      className={cn(
        'flex w-fit items-center gap-3 rounded-xl transition-all hover:scale-[1.02] hover:opacity-90 focus:outline-none focus:ring-2',
        onPrimary ? 'focus:ring-white/50' : 'focus:ring-primary/30',
        className,
      )}
    >
      <span
        className={cn(
          'flex items-center justify-center',
          isSmall ? 'size-9 rounded-lg' : 'size-10 rounded-xl',
          onPrimary && 'bg-white/10 backdrop-blur',
        )}
      >
        <VitalSyncMark
          tone={tone}
          width={isSmall ? 36 : 40}
          height={isSmall ? 36 : 40}
          className={isSmall ? 'size-9' : 'size-10'}
        />
      </span>
      <span className={cn(isSmall ? 'text-lg' : 'text-xl', 'font-extrabold tracking-tight')}>
        Vital
        <span className={cn('font-normal', onPrimary ? 'opacity-70' : 'text-muted-foreground')}>Sync</span>
      </span>
    </Link>
  );
}
