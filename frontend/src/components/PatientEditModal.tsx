/**
 * PatientEditModal — edição dos dados de um paciente pelo Administrador.
 *
 * Campos: nome, telefone, CPF, data de nascimento, tipo de cirurgia, hospital,
 * data da cirurgia, data da alta e equipe médica.
 *
 * Regras de UI:
 *  - CPF com máscara e validação visual; OPCIONAL (vazio = mantém o atual,
 *    pois o frontend nunca tem o CPF em claro de um paciente já criado).
 *  - Telefone com máscara (PhoneInput) e validação visual.
 *  - Erro claro se o CPF for inválido ou já cadastrado (409 do servidor).
 *  - Loading ao salvar e mensagem de sucesso ao concluir.
 *  - Mobile: formulário em uma coluna, botões grandes (w-full).
 *
 * A atualização vai pela Edge Function `update-patient` (service_role + segredos)
 * — o CPF é re-hasheado no servidor, nunca no frontend.
 */
import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { onlyDigits } from '@vitalsync/shared';
import { useToast } from './Toast';
import { PatientCpfField } from './PatientCpfField';
import { Button, PhoneInput, SelectField, TextareaField, TextInput } from './ui';
import { validateCpf } from '../lib/cpfUtils';
import { hospitalService } from '../services/hospitalService';
import { patientService } from '../services/patientService';
import { surgeryTypeService } from '../services/surgeryTypeService';
import { teamService } from '../services/teamService';
import type { Hospital, MedicalTeam, SurgeryType } from '../services/types';

interface FormState {
  name: string;
  cpf: string;
  phone: string;
  birthDate: string;
  surgeryTypeId: string;
  surgeryDate: string;
  dischargeDate: string;
  hospitalId: string;
  teamId: string;
  medicalRecordSummary: string;
}

const emptyForm: FormState = {
  name: '', cpf: '', phone: '', birthDate: '', surgeryTypeId: '', surgeryDate: '',
  dischargeDate: '', hospitalId: '', teamId: '', medicalRecordSummary: '',
};

export interface PatientEditModalProps {
  patientId: string;
  onClose: () => void;
  onSaved: () => void;
}

export function PatientEditModal({ patientId, onClose, onSaved }: PatientEditModalProps) {
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [surgeryTypes, setSurgeryTypes] = useState<SurgeryType[]>([]);
  const [hospitals, setHospitals] = useState<Hospital[]>([]);
  const [teams, setTeams] = useState<MedicalTeam[]>([]);
  // Erro externo de CPF (ex.: "já cadastrado") — repassado ao PatientCpfField.
  const [cpfError, setCpfError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    Promise.all([
      patientService.getById(patientId),
      surgeryTypeService.list(),
      hospitalService.list(),
      teamService.list(),
    ])
      .then(([patient, st, h, t]) => {
        if (!active) return;
        setSurgeryTypes(st.filter((x) => x.status === 'ACTIVE'));
        setHospitals(h.filter((x) => x.status === 'ACTIVE'));
        setTeams(t);
        if (patient) {
          setForm({
            name: patient.name ?? '',
            cpf: '', // nunca temos o CPF em claro — vazio = manter
            phone: patient.phone ?? '',
            birthDate: patient.birth_date ?? '',
            surgeryTypeId: patient.surgery_type_id ?? '',
            surgeryDate: patient.surgery_date ?? '',
            dischargeDate: patient.hospital_discharge_date ?? '',
            hospitalId: patient.hospital_id ?? '',
            teamId: patient.team_id ?? '',
            medicalRecordSummary: patient.medical_record_summary ?? '',
          });
        }
      })
      .catch(() => toast.error('Não foi possível carregar os dados do paciente.'))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [patientId]);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((p) => ({ ...p, [key]: value }));
    if (key === 'cpf') setCpfError(null);
  }

  function validate(): string | null {
    if (!form.name.trim()) return 'Informe o nome do paciente.';
    if (form.cpf.trim() !== '' && !validateCpf(form.cpf)) {
      return 'CPF inválido. Verifique os dados e tente novamente.';
    }
    if (form.phone.trim() !== '' && onlyDigits(form.phone).length < 10) {
      return 'Informe um telefone válido com DDD.';
    }
    if (!form.surgeryTypeId) return 'Selecione o tipo de cirurgia.';
    if (!form.hospitalId) return 'Selecione o hospital.';
    if (!form.teamId) return 'Selecione a equipe médica.';
    return null;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const problem = validate();
    if (problem) {
      toast.error(problem);
      return;
    }
    setSaving(true);
    try {
      await patientService.update({
        id: patientId,
        name: form.name.trim(),
        cpf: form.cpf.trim(), // vazio = manter o atual (servidor decide)
        phone: onlyDigits(form.phone),
        birth_date: form.birthDate || undefined,
        surgery_type_id: form.surgeryTypeId,
        surgery_date: form.surgeryDate || undefined,
        hospital_discharge_date: form.dischargeDate || undefined,
        hospital_id: form.hospitalId,
        team_id: form.teamId,
        medical_record_summary: form.medicalRecordSummary.trim(),
      });
      toast.success('Dados do paciente atualizados com sucesso.');
      onSaved();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Não foi possível atualizar o paciente.';
      // 409 do servidor → destaca no campo de CPF.
      if (/cpf/i.test(msg)) setCpfError(msg);
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-foreground/50 backdrop-blur-sm flex items-start justify-center p-4 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="bg-card border border-border rounded-xl shadow-lg p-6 w-full max-w-2xl space-y-5 animate-entry my-8"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-extrabold tracking-tight">Editar paciente</h2>
            <p className="text-sm text-muted-foreground mt-0.5">
              Atualize os dados cadastrais e de procedimento do paciente.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="size-8 rounded-md border border-border text-muted-foreground hover:bg-muted flex items-center justify-center shrink-0"
            aria-label="Fechar"
          >
            ✕
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground py-12">
            <Loader2 className="size-5 animate-spin" /> Carregando dados…
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-5">
            {/* Identificação */}
            <fieldset className="space-y-4">
              <legend className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                Identificação
              </legend>
              <div className="grid md:grid-cols-2 gap-4">
                <TextInput
                  label="Nome do paciente"
                  required
                  value={form.name}
                  onChange={(e) => set('name', e.target.value)}
                />
                <PhoneInput
                  label="Telefone (WhatsApp)"
                  value={form.phone}
                  onChange={(v) => set('phone', v)}
                />
                <PatientCpfField
                  value={form.cpf}
                  onChange={(v) => set('cpf', v)}
                  hint="Deixe em branco para manter o CPF atual."
                  externalError={cpfError}
                />
                <TextInput
                  label="Data de nascimento"
                  type="date"
                  value={form.birthDate}
                  onChange={(e) => set('birthDate', e.target.value)}
                />
              </div>
            </fieldset>

            {/* Procedimento */}
            <fieldset className="space-y-4">
              <legend className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                Procedimento
              </legend>
              <div className="grid md:grid-cols-2 gap-4">
                <SelectField
                  label="Tipo de cirurgia"
                  required
                  value={form.surgeryTypeId}
                  onChange={(e) => set('surgeryTypeId', e.target.value)}
                  options={surgeryTypes.map((s) => ({ value: s.id, label: s.name }))}
                />
                <SelectField
                  label="Hospital"
                  required
                  value={form.hospitalId}
                  onChange={(e) => set('hospitalId', e.target.value)}
                  options={hospitals.map((h) => ({ value: h.id, label: h.name }))}
                />
                <TextInput
                  label="Data da cirurgia"
                  type="date"
                  value={form.surgeryDate}
                  onChange={(e) => set('surgeryDate', e.target.value)}
                />
                <TextInput
                  label="Data da alta hospitalar"
                  type="date"
                  hint="Inicia a contagem dos 10 dias de monitoramento."
                  value={form.dischargeDate}
                  onChange={(e) => set('dischargeDate', e.target.value)}
                />
                <SelectField
                  label="Equipe médica"
                  required
                  value={form.teamId}
                  onChange={(e) => set('teamId', e.target.value)}
                  options={teams.map((t) => ({
                    value: t.id,
                    label: `Equipe nº ${String(t.team_number).padStart(2, '0')}`,
                  }))}
                />
              </div>
              <TextareaField
                label="Resumo de prontuário"
                hint="Breve histórico clínico relevante para o acompanhamento (opcional)."
                rows={3}
                value={form.medicalRecordSummary}
                onChange={(e) => set('medicalRecordSummary', e.target.value)}
              />
            </fieldset>

            <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-3 pt-3 border-t border-border">
              <Button type="button" variant="ghost" onClick={onClose} className="w-full sm:w-auto">
                Cancelar
              </Button>
              <Button type="submit" loading={saving} className="w-full sm:w-auto">
                Salvar alterações
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
