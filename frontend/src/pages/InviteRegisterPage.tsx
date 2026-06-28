/**
 * Auto-cadastro do profissional por convite (rota pública /convite/:token).
 * Fora do Layout/login. O profissional define a própria senha; a conta é criada
 * na Edge Function accept-invite.
 *
 * Esta página só cuida do ciclo de vida do convite (carregar / inválido /
 * loading). O formulário em si é um wizard de 3 etapas (ProfessionalRegisterWizard),
 * que também renderiza a tela de sucesso ao concluir.
 */
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { AlertCircle, Loader2 } from 'lucide-react';
import {
  professionalInviteService,
  type InviteInfo,
} from '../services/professionalInviteService';
import { GRADIENT_BG, ProfessionalRegisterWizard } from '../components/professional-register';

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
    professionalInviteService
      .getByToken(token)
      .then((i) => {
        if (!i) setInvalid(true);
        else setInvite(i);
      })
      .catch(() => setInvalid(true))
      .finally(() => setLoading(false));
  }, [token]);

  if (loading) {
    return (
      <CenteredCard>
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <Loader2 className="size-6 animate-spin text-primary" />
          <p className="text-sm font-semibold">Abrindo seu convite…</p>
        </div>
      </CenteredCard>
    );
  }

  if (invalid || !invite) {
    return (
      <CenteredCard>
        <div className="size-16 rounded-full bg-alert/10 text-alert flex items-center justify-center mx-auto mb-4">
          <AlertCircle className="size-8" />
        </div>
        <h2 className="text-xl font-extrabold tracking-tight">Convite inválido ou expirado</h2>
        <p className="text-sm text-muted-foreground mt-2 text-balance">
          Solicite um novo convite ao administrador do sistema.
        </p>
      </CenteredCard>
    );
  }

  return <ProfessionalRegisterWizard token={token!} invite={invite} />;
}

/** Card centralizado sobre o fundo em gradiente (estados de loading/erro). */
function CenteredCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen grid place-items-center p-4 sm:p-6" style={GRADIENT_BG}>
      <div className="bg-card border border-border rounded-3xl shadow-xl shadow-primary/5 p-8 w-full max-w-[480px] text-center animate-entry">
        {children}
      </div>
    </div>
  );
}
