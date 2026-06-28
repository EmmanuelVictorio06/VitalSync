/**
 * Botões de navegação do wizard — "Voltar" (secundário, menor) e o botão
 * principal "Continuar"/"Enviar" (destaque azul, ocupa mais espaço no mobile).
 *
 * Mesma altura nos dois, área de toque confortável (h-12 = 48px) e estado de
 * loading que desabilita para evitar clique duplo. Quando `onNext` é omitido, o
 * botão principal vira `type="submit"` (para uso dentro de <form>).
 */
import { ArrowLeft, Loader2 } from 'lucide-react';
import type { ReactNode } from 'react';

export interface WizardNavigationButtonsProps {
  onBack?: () => void;
  onNext?: () => void;
  nextLabel?: string;
  backLabel?: string;
  loadingLabel?: string;
  isLoading?: boolean;
  disabled?: boolean;
  /** Conteúdo extra à direita do label do botão principal (ex.: ícone de envio). */
  nextIcon?: ReactNode;
}

export function WizardNavigationButtons({
  onBack,
  onNext,
  nextLabel = 'Continuar',
  backLabel = 'Voltar',
  loadingLabel = 'Continuando…',
  isLoading = false,
  disabled = false,
  nextIcon,
}: WizardNavigationButtonsProps) {
  return (
    <div className="flex gap-3 w-full pt-4">
      {onBack && (
        <button
          type="button"
          onClick={onBack}
          disabled={isLoading}
          className="h-12 px-5 rounded-2xl border border-border bg-card text-muted-foreground font-semibold text-sm inline-flex items-center justify-center gap-1.5 hover:bg-muted hover:text-foreground transition-colors disabled:opacity-50"
        >
          <ArrowLeft className="size-4" /> {backLabel}
        </button>
      )}
      <button
        type={onNext ? 'button' : 'submit'}
        onClick={onNext}
        disabled={isLoading || disabled}
        className="h-12 flex-1 rounded-2xl bg-primary text-primary-foreground font-bold text-sm inline-flex items-center justify-center gap-2 shadow-lg shadow-primary/20 hover:bg-primary/90 transition-colors disabled:opacity-60"
      >
        {isLoading && <Loader2 className="size-4 animate-spin" />}
        {isLoading ? loadingLabel : nextLabel}
        {!isLoading && nextIcon}
      </button>
    </div>
  );
}
