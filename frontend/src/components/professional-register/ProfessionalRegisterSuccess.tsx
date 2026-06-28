/**
 * Tela de sucesso do cadastro de profissional — card limpo com check e CTA
 * para o login, no mesmo visual (fundo suave, card centralizado) do wizard.
 */
import { Link } from 'react-router-dom';
import { CheckCircle2 } from 'lucide-react';
import { GRADIENT_BG } from './types';

export function ProfessionalRegisterSuccess() {
  return (
    <div className="min-h-screen grid place-items-center p-6" style={GRADIENT_BG}>
      <div className="bg-card border border-border rounded-3xl shadow-xl shadow-primary/5 p-8 w-full max-w-[480px] text-center animate-entry">
        <div className="size-20 rounded-full bg-stable/10 text-stable flex items-center justify-center mx-auto mb-6">
          <CheckCircle2 className="size-10" />
        </div>
        <h1 className="text-2xl font-extrabold tracking-tight">Cadastro realizado com sucesso!</h1>
        <p className="text-muted-foreground mt-3 text-balance">
          Seu acesso foi criado. Agora você já pode entrar no VitalSync.
        </p>
        <Link
          to="/login"
          className="mt-8 inline-flex items-center justify-center w-full py-3.5 bg-primary text-primary-foreground rounded-xl font-bold text-sm hover:bg-primary/90 shadow-lg shadow-primary/20 transition-colors"
        >
          Ir para login
        </Link>
      </div>
    </div>
  );
}
