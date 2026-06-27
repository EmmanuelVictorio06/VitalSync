/**
 * Tela pública de cadastro de profissional por convite (/convite/:token).
 *
 * Wrapper fino: carrega o convite pelo token e delega o fluxo ao
 * `ProfessionalRegisterWizard` (wizard de 3 etapas). Fora do Layout/login —
 * sem sidebar. Estados: loading, inválido/expirado e o wizard em si.
 */
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { AlertCircle, Loader2 } from 'lucide-react';
import { ProfessionalRegisterWizard } from '../components/professional-register/ProfessionalRegisterWizard';
import { GRADIENT_BG } from '../components/professional-register/ProfessionalRegisterSuccess';
import { professionalInviteService, type InviteInfo } from '../services/professionalInviteService';

export function InviteRegisterPage() {
  const { token } = useParams<{ token: string }>();
  const [invite, setInvite] = useState<InviteInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [invalid, setInvalid] = useState(false);

  useEffect(() => {
    if (!token) {
      setInvalid(true);
      setLoading(false);
      return;
    }
    let active = true;
    professionalInviteService
      .getByToken(token)
      .then((i) => {
        if (!active) return;
        if (!i) setInvalid(true);
        else setInvite(i);
      })
      .catch(() => active && setInvalid(true))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [token]);

  if (loading) {
    return (
      <div className="min-h-screen grid place-items-center p-6" style={GRADIENT_BG}>
        <div className="bg-card border border-border rounded-3xl shadow-xl shadow-primary/5 p-8 w-full max-w-[480px] text-center animate-entry">
          <div className="size-16 rounded-full bg-primary/10 text-primary flex items-center justify-center mx-auto mb-4">
            <Loader2 className="size-8 animate-spin" />
          </div>
          <h2 className="text-lg font-extrabold tracking-tight">Abrindo seu convite…</h2>
          <p className="text-sm text-muted-foreground mt-2">Aguarde alguns instantes.</p>
        </div>
      </div>
    );
  }

  if (invalid || !invite || !token) {
    return (
      <div className="min-h-screen grid place-items-center p-6" style={GRADIENT_BG}>
        <div className="bg-card border border-border rounded-3xl shadow-xl shadow-primary/5 p-8 w-full max-w-[480px] text-center animate-entry">
          <div className="size-16 rounded-full bg-alert/10 text-alert flex items-center justify-center mx-auto mb-4">
            <AlertCircle className="size-8" />
          </div>
          <h2 className="text-lg font-extrabold tracking-tight">Convite inválido ou expirado</h2>
          <p className="text-sm text-muted-foreground mt-2">
            Solicite um novo convite ao administrador do sistema.
          </p>
        </div>
      </div>
    );
  }

  return <ProfessionalRegisterWizard token={token} invite={invite} onDone={() => {}} />;
}
