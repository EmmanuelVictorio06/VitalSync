/**
 * Rodapé discreto com o contato de suporte técnico, exibido em todas as telas
 * do fluxo público do paciente (gate de CPF, escolha de período, wizard,
 * sucesso). Não é canal clínico — é só para problema técnico com o registro.
 */
import { LifeBuoy } from 'lucide-react';
import { supportContact } from '../../config/support';

export function SupportFooter() {
  return (
    <p className="mt-6 text-center text-[11px] leading-relaxed text-muted-foreground">
      <LifeBuoy className="inline size-3 mr-1 -translate-y-px" />
      Problema técnico com o registro? Fale com o suporte:{' '}
      <a href={`mailto:${supportContact.email}`} className="font-semibold underline underline-offset-2">
        {supportContact.email}
      </a>{' '}
      /{' '}
      <a href={`tel:${supportContact.phone.replace(/\D/g, '')}`} className="font-semibold underline underline-offset-2">
        {supportContact.phone}
      </a>
    </p>
  );
}
