/**
 * Rede contra tela branca. Precisa ser componente de CLASSE: `componentDidCatch`
 * e `getDerivedStateFromError` não têm equivalente em componente de função.
 *
 * Sem isto, qualquer exceção de render derruba a árvore inteira — e na rota
 * pública do paciente o resultado é uma página em branco que ninguém detecta.
 */
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { reportError } from '../lib/errorReporting';

interface Props {
  children: ReactNode;
  /** Identifica de onde veio o erro no log ('app', 'registro-paciente'…). */
  contexto: string;
  /** Fallback próprio; ausente, usa o genérico. `reset` limpa o boundary. */
  fallback?: (reset: () => void) => ReactNode;
}

interface State {
  hasError: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  override componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    // `componentStack` diz QUAL componente quebrou — é diagnóstico, não dado
    // do usuário, mas passa pela mesma redação por precaução.
    void reportError(error, {
      contexto: this.props.contexto,
      extra: { componentStack: (errorInfo.componentStack ?? '').slice(0, 500) },
    });
  }

  reset = (): void => {
    this.setState({ hasError: false });
  };

  override render(): ReactNode {
    if (!this.state.hasError) return this.props.children;
    if (this.props.fallback) return this.props.fallback(this.reset);
    return <FallbackPadrao onReset={this.reset} />;
  }
}

/** Fallback genérico (telas internas, usuário profissional). */
function FallbackPadrao({ onReset }: { onReset: () => void }) {
  return (
    <div className="min-h-[60vh] flex items-center justify-center p-6">
      <div className="bg-card border border-border rounded-xl shadow-sm p-8 max-w-md text-center">
        <h1 className="text-xl font-extrabold tracking-tight">Algo deu errado nesta tela</h1>
        <p className="text-sm text-muted-foreground mt-2">
          O problema foi registrado automaticamente. Você pode tentar de novo — seus dados não foram perdidos.
        </p>
        <div className="flex flex-col sm:flex-row gap-2 justify-center mt-6">
          <button
            onClick={onReset}
            className="px-4 py-2.5 rounded-lg text-sm font-semibold bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            Tentar novamente
          </button>
          <button
            onClick={() => window.location.reload()}
            className="px-4 py-2.5 rounded-lg text-sm font-semibold border border-border hover:bg-muted transition-colors"
          >
            Recarregar a página
          </button>
        </div>
      </div>
    </div>
  );
}
