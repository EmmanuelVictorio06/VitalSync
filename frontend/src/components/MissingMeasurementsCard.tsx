/**
 * Aviso de ausência de resposta (protocolo 5.6.3/5.6.4): pacientes cuja
 * janela de coleta de hoje já fechou (manhã 08–10h, noite 18–20h) sem
 * registro. O lembrete automático (`send-measurement-reminder`) já dispara
 * durante a janela — este card é para o CONTATO ATIVO que o protocolo pede
 * quando mesmo assim não houve resposta.
 */
import { useEffect, useState } from 'react';
import { MessageCircle, PhoneCall } from 'lucide-react';
import { whatsappLink } from '@vitalsync/shared';
import { patientService, type MissingMeasurementPatient } from '../services/patientService';

const PERIOD_LABEL: Record<MissingMeasurementPatient['period'], string> = {
  MORNING: 'manhã',
  NIGHT: 'noite',
};

export function MissingMeasurementsCard() {
  const [rows, setRows] = useState<MissingMeasurementPatient[]>([]);

  useEffect(() => {
    let active = true;
    patientService
      .getMissingTodayMeasurements()
      .then((r) => active && setRows(r))
      .catch(() => active && setRows([]));
    return () => {
      active = false;
    };
  }, []);

  if (rows.length === 0) return null;

  return (
    <div className="bg-warning/5 border border-warning/20 rounded-xl p-4">
      <div className="flex items-center gap-2 mb-2">
        <PhoneCall className="size-4 text-warning" />
        <h3 className="text-sm font-bold">Sem resposta hoje — contato ativo necessário</h3>
      </div>
      <p className="text-xs text-muted-foreground mb-3">
        A janela de coleta já fechou para estes pacientes (protocolo 5.6.3/5.6.4). O lembrete automático já foi
        enviado; faça o contato ativo.
      </p>
      <ul className="space-y-2">
        {rows.map((p) => (
          <li key={`${p.id}-${p.period}`} className="flex items-center justify-between gap-3 text-sm bg-card rounded-lg border border-border px-3 py-2">
            <span>
              <strong>{p.name}</strong> — medição da {PERIOD_LABEL[p.period]} pendente
            </span>
            {p.phone && (
              <a
                href={whatsappLink(p.phone, `Olá, ${p.name.split(' ')[0]}! Notamos que sua medição de hoje ainda não foi registrada. Poderia enviar assim que possível?`)}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-xs font-semibold text-stable hover:underline shrink-0"
              >
                <MessageCircle className="size-3.5" /> WhatsApp
              </a>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
