import { type MouseEvent } from 'react';
import { Link } from 'react-router-dom';
import { Heart } from 'lucide-react';
import { cn } from './ui';

type VitalSyncLogoTone = 'default' | 'onPrimary';
type VitalSyncLogoSize = 'sm' | 'md';

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
          onPrimary ? 'bg-white/10 text-primary-foreground backdrop-blur' : 'bg-primary text-primary-foreground',
        )}
      >
        <Heart className="size-5" fill="currentColor" />
      </span>
      <span className={cn(isSmall ? 'text-lg' : 'text-xl', 'font-extrabold tracking-tight')}>
        Vital
        <span className={cn('font-normal', onPrimary ? 'opacity-70' : 'text-muted-foreground')}>Sync</span>
      </span>
    </Link>
  );
}
