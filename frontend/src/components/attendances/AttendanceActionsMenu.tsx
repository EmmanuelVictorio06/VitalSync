import { useMemo } from 'react';
import { FileText, MessageCircle, Pencil, Stethoscope } from 'lucide-react';
import { whatsappLink } from '@vitalsync/shared';
import type { AttendanceRow } from '../../services/attendanceService';
import { ActionsMenu, type ActionMenuEntry } from '../ActionsMenu';

/**
 * Ações de uma linha de atendimento. A mecânica do menu (bottom sheet no
 * mobile, popover no desktop, Escape, clique fora) vive em `ActionsMenu` —
 * aqui fica só a montagem dos itens. O menu fecha sozinho antes de executar
 * a ação, por isso nenhum item chama `close` na mão.
 */

const WHATSAPP_MSG = 'Olá! Sou da sua equipe médica no VitalSync e gostaria de acompanhar sua recuperação.';

export function AttendanceActionsMenu(props: AttendanceActionsMenuProps) {
  const { row, canEdit, onFollow, onViewMeasurement, onViewAlert, onEditObservation } = props;

  const entries: ActionMenuEntry[] = useMemo(() => {
    const list: ActionMenuEntry[] = [];
    list.push({ kind: 'button', icon: Stethoscope, label: 'Acompanhar paciente', onClick: onFollow });
    list.push({ kind: 'button', icon: FileText, label: 'Ver medição relacionada', disabled: !row.vital_record, onClick: onViewMeasurement });
    if (row.alert) {
      list.push({ kind: 'button', icon: FileText, label: 'Ver alerta original', onClick: onViewAlert });
    }
    if (row.patient?.phone) {
      list.push({ kind: 'link', icon: MessageCircle, label: 'Conversar no WhatsApp', href: whatsappLink(row.patient.phone, WHATSAPP_MSG), external: true });
    }
    if (canEdit) {
      list.push({ kind: 'button', icon: Pencil, label: 'Editar observação final', onClick: onEditObservation });
    }
    return list;
  }, [row, canEdit, onFollow, onViewMeasurement, onViewAlert, onEditObservation]);

  return <ActionsMenu entries={entries} ariaLabel="Abrir ações do atendimento" buttonClassName="size-9 min-w-[2.25rem]" />;
}

interface AttendanceActionsMenuProps {
  row: AttendanceRow;
  canEdit: boolean;
  onFollow: () => void;
  onViewMeasurement: () => void;
  onViewAlert: () => void;
  onEditObservation: () => void;
}
