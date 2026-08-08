/**
 * Fallback da tela do PACIENTE. Público diferente do resto do app: idoso,
 * recém-operado, no celular, sozinho em casa. Por isso: fonte grande, alto
 * contraste, botões grandes, zero jargão, e — o mais importante — um telefone
 * humano, porque quem não consegue registrar a medição precisa falar com
 * alguém, não ler uma mensagem de erro.
 *
 * O telefone vem de `config/support.ts` (VITE_SUPPORT_CONTACT_PHONE), que já
 * existia para o rodapé de suporte. Quando não configurado, a linha do
 * telefone é OMITIDA — mostrar um placeholder falso é pior que não mostrar.
 */
import { supportContact } from '../config/support';
import { GRADIENT_BG } from './patient-measurement/types';

export function PatientErrorFallback({ onReset }: { onReset: () => void }) {
  const temTelefone = !supportContact.isPlaceholder && Boolean(supportContact.phone);

  return (
    <div className="min-h-screen flex items-center justify-center p-5" style={GRADIENT_BG}>
      <div className="bg-white border border-slate-200 rounded-2xl shadow-lg p-7 max-w-md w-full text-center">
        <h1 className="text-2xl font-extrabold tracking-tight text-slate-900">
          Tivemos um problema técnico
        </h1>
        <p className="text-base text-slate-700 mt-3 leading-relaxed">
          Não foi culpa sua. A página não conseguiu carregar agora, mas seus dados anteriores estão salvos.
        </p>

        <button
          onClick={onReset}
          className="w-full mt-6 px-5 py-4 rounded-xl text-lg font-bold bg-blue-600 text-white hover:bg-blue-700 transition-colors"
        >
          Tentar de novo
        </button>
        <button
          onClick={() => window.location.reload()}
          className="w-full mt-3 px-5 py-4 rounded-xl text-lg font-bold border-2 border-slate-300 text-slate-800 hover:bg-slate-50 transition-colors"
        >
          Recarregar a página
        </button>

        {temTelefone && (
          <div className="mt-6 pt-5 border-t border-slate-200">
            <p className="text-base text-slate-700">Se continuar não funcionando, fale com a gente:</p>
            <a
              href={`tel:${supportContact.phone.replace(/\D/g, '')}`}
              className="inline-block mt-2 text-xl font-extrabold text-blue-700 underline underline-offset-4"
            >
              {supportContact.phone}
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
