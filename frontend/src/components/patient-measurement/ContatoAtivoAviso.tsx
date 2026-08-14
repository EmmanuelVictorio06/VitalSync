/**
 * Aviso antigolpe para o paciente.
 *
 * POR QUE ISTO EXISTE: se um valor sair fora do esperado, um profissional de
 * enfermagem liga ou manda mensagem. No Brasil, contato de número desconhecido
 * que já sabe a pressão e a cirurgia do paciente é indistinguível de golpe — e
 * a reação correta de um idoso orientado a desconfiar é BLOQUEAR. Avisar antes
 * é o que torna o contato ativo possível.
 *
 * A frase sobre senha/PIX/dados bancários é deliberada: dá ao paciente um
 * critério concreto para separar a equipe de verdade de um golpista que tenha
 * ouvido falar do estudo.
 */
import { ShieldCheck } from 'lucide-react';
import { contatoOficial } from '../../config/support';

export function ContatoAtivoAviso({ compacto = false }: { compacto?: boolean }) {
  return (
    <div
      className={`rounded-xl border border-primary/20 bg-primary/5 ${compacto ? 'p-3' : 'p-4'} flex items-start gap-2.5 text-left`}
    >
      <ShieldCheck className="size-5 text-primary shrink-0 mt-0.5" />
      <div>
        <p className={`${compacto ? 'text-xs' : 'text-sm'} text-foreground leading-relaxed`}>
          Se algum valor estiver fora do esperado, um profissional de enfermagem da equipe pode entrar em
          contato{' '}
          {contatoOficial.configurado ? (
            <>
              pelo WhatsApp oficial <strong className="whitespace-nowrap">{contatoOficial.whatsapp}</strong>
            </>
          ) : (
            <>pelo WhatsApp oficial da equipe</>
          )}
          .
        </p>
        <p className={`${compacto ? 'text-[11px]' : 'text-xs'} font-semibold text-foreground mt-1.5`}>
          Nunca pediremos senha, PIX ou dados bancários.
        </p>
      </div>
    </div>
  );
}
