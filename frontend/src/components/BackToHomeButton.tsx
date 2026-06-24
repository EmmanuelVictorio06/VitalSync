import { type MouseEvent } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { cn } from './ui';

export function BackToHomeButton({
  to = '/',
  className,
  onNavigate,
}: {
  to?: string;
  className?: string;
  onNavigate?: (event: MouseEvent<HTMLAnchorElement>) => void;
}) {
  return (
    <Link
      to={to}
      onClick={onNavigate}
      aria-label="Voltar para a página inicial"
      className={cn(
        'inline-flex items-center gap-2 rounded-lg border border-primary/15 bg-card/80 px-3 py-2 text-sm font-semibold text-foreground shadow-sm transition-colors hover:bg-accent hover:text-primary focus:outline-none focus:ring-2 focus:ring-primary/30',
        className,
      )}
    >
      <ArrowLeft className="size-4 text-primary" />
      Voltar
    </Link>
  );
}
