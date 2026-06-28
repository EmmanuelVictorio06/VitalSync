/**
 * Tela de sucesso da medição — card limpo com check, no mesmo visual do
 * cadastro de profissional (fundo suave, card centralizado).
 */
import { CheckCircle2 } from 'lucide-react';
import { GRADIENT_BG } from './types';

export function MeasurementSuccess({ photoSent }: { photoSent?: boolean }) {
  return (
    <div className="min-h-screen grid place-items-center p-4 sm:p-6" style={GRADIENT_BG}>
      <div className="bg-card border border-border rounded-3xl shadow-xl shadow-primary/5 p-8 w-full max-w-[480px] text-center animate-entry">
        <div className="size-20 rounded-full bg-stable/10 text-stable flex items-center justify-center mx-auto mb-6">
          <CheckCircle2 className="size-10" />
        </div>
        <h1 className="text-2xl font-extrabold tracking-tight">Medição enviada com sucesso!</h1>
        <p className="text-muted-foreground mt-3 text-balance">
          Suas informações foram registradas e serão acompanhadas pela equipe médica.
        </p>
        {photoSent && (
          <p className="text-sm font-semibold text-stable mt-3 text-balance">
            As fotos foram enviadas para análise da equipe médica.
          </p>
        )}
        <p className="text-xs text-muted-foreground mt-3 text-balance">
          Fique tranquilo(a): se identificarmos qualquer sinal de alerta, um profissional entrará em contato.
        </p>
        <button
          onClick={() => window.close()}
          className="mt-8 inline-flex items-center justify-center w-full py-3.5 bg-primary text-primary-foreground rounded-xl font-bold text-sm hover:bg-primary/90 shadow-lg shadow-primary/20 transition-colors"
        >
          Finalizar
        </button>
      </div>
    </div>
  );
}
