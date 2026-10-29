/**
 * Pré-visualização da tela do paciente SEM banco — só existe em `npm run dev`
 * (ver a rota `/dev/paciente` em App.tsx; em produção ela não é registrada nem
 * entra no bundle).
 *
 * Mostra a tela "Quando você está registrando?" (a que o paciente vê logo
 * depois de confirmar o CPF) com um paciente fictício, para conferir layout e
 * o card do vídeo tutorial quando o Supabase local não está disponível.
 */
import { PeriodChoice } from './VitalsRegisterPage';

export function DevPatientPreviewPage() {
  return (
    <PeriodChoice
      name="Maria da Silva (paciente fictícia)"
      morningDone={false}
      nightDone={false}
      onChoose={() => {
        /* pré-visualização: o formulário não abre aqui */
      }}
    />
  );
}
