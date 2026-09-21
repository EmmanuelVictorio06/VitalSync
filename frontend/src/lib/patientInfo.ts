/**
 * Dados do paciente no prontuário — FONTE ÚNICA de "rótulo ↔ campo ↔ formatação".
 *
 * Quem consome:
 *   - `PatientInfoGrid` (components/clinical/DetailBlocks.tsx), usado no
 *     "Detalhes do Alerta" e no "Detalhes do Atendimento";
 *   - a tela de conferência do cadastro (lib/patientReview.ts), para o usuário
 *     revisar exatamente o que verá depois no prontuário.
 *
 * Por isso o de-para mora aqui, num módulo puro (sem JSX): os dois lados leem a
 * mesma lista e não podem divergir. O par irmão para as variáveis do estudo é
 * `lib/studyVariables.ts`.
 */
import { calculateAge } from '@vitalsync/shared';
import { fmtDate, teamLabel } from '../components/attendances/utils';

/** Placeholder de valor ausente — o mesmo de `studyVariables.ts`. */
export { EMPTY_VALUE } from './studyVariables';
import { EMPTY_VALUE } from './studyVariables';

export interface PatientInfoInput {
  name: string;
  birth_date: string | null;
  phone: string | null;
  surgery_type: { name: string } | null;
  hospital: { name: string } | null;
  surgery_date: string | null;
  hospital_discharge_date: string | null;
}

/**
 * Linha do prontuário. `key` é identificador estável — a conferência do
 * cadastro filtra por ele (ex.: "dia de monitoramento" não existe antes de o
 * paciente começar a medir), então não depende do texto do rótulo.
 */
export interface InfoRow {
  key: string;
  label: string;
  value: string;
}

export function patientInfoRows({
  patient,
  teamNumber,
  surgeonName,
  monitoringDay,
}: {
  patient: PatientInfoInput | null | undefined;
  teamNumber: number | null | undefined;
  surgeonName: string | null | undefined;
  monitoringDay: number | null | undefined;
}): InfoRow[] {
  return [
    { key: 'name', label: 'Nome', value: patient?.name?.trim() || EMPTY_VALUE },
    {
      key: 'age',
      label: 'Idade',
      value: patient?.birth_date ? `${calculateAge(new Date(patient.birth_date))} anos` : EMPTY_VALUE,
    },
    { key: 'phone', label: 'Telefone', value: patient?.phone || EMPTY_VALUE },
    { key: 'surgeryType', label: 'Tipo de cirurgia', value: patient?.surgery_type?.name ?? EMPTY_VALUE },
    { key: 'hospital', label: 'Hospital', value: patient?.hospital?.name ?? EMPTY_VALUE },
    { key: 'surgeryDate', label: 'Data da cirurgia', value: fmtDate(patient?.surgery_date) },
    { key: 'dischargeDate', label: 'Data da alta', value: fmtDate(patient?.hospital_discharge_date) },
    { key: 'monitoringDay', label: 'Dia de monitoramento', value: monitoringDay ? `D+${monitoringDay}` : EMPTY_VALUE },
    { key: 'team', label: 'Equipe', value: teamLabel(teamNumber) },
    { key: 'surgeon', label: 'Cirurgião responsável', value: surgeonName || EMPTY_VALUE },
  ];
}
