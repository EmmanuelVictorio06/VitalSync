import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Copy, MessageCircle, UserPlus } from 'lucide-react';
import { calculateAge, isDischargeAfterSurgery, whatsappLink } from '@vitalsync/shared';
import { Role, useAuth } from '../auth/AuthContext';
import { useToast } from '../components/Toast';
import { ToggleSwitch } from '../components/admin';
import { Button, CustomSelect, DateField, Field, PageContainer, PageHeader, PhoneInput, RichTextField, TextInput } from '../components/ui';
import { featureFlags } from '../config/featureFlags';
import { patientVitalsLink } from '../lib/publicUrl';
import { parseComorbidities } from '../lib/comorbidities';
import { richTextToPlainText, sanitizeRichText } from '../lib/richText';
import { formatCpf, validateCpf } from '../lib/cpfUtils';
import { hospitalService } from '../services/hospitalService';
import { surgeryTypeService } from '../services/surgeryTypeService';
import { teamService } from '../services/teamService';
import { teamViewService } from '../services/teamViewService';
import { homologationService } from '../services/homologationService';
import { patientService } from '../services/patientService';
import type { Hospital, SurgeryType } from '../services/types';

interface FormState {
  name: string;
  cpf: string;
  birthDate: string;
  phone: string;
  surgeryTypeId: string;
  surgeryDate: string;
  dischargeDate: string;
  hospitalId: string;
  teamId: string;
  isTest: boolean;
  medicalRecordSummary: string;
  sex: '' | 'M' | 'F';
  weightKg: string;
  heightCm: string;
  comorbidities: string;
  lengthOfStayDays: string;
  alternativePhone: string;
  tcleAcceptedAt: string;
}

const empty: FormState = {
  name: '', cpf: '', birthDate: '', phone: '', surgeryTypeId: '', surgeryDate: '', dischargeDate: '', hospitalId: '', teamId: '', isTest: false, medicalRecordSummary: '',
  sex: '', weightKg: '', heightCm: '', comorbidities: '', lengthOfStayDays: '', alternativePhone: '', tcleAcceptedAt: '',
};

// Mensagem única (submit + feedback imediato no campo) — hospital_discharge_date
// é o marco zero do monitoramento, então essa ordem precisa estar certa.
const DISCHARGE_BEFORE_SURGERY_ERROR = 'A data da alta hospitalar não pode ser anterior à data da cirurgia.';

export function PatientRegisterPage() {
  const toast = useToast();
  const { hasRole } = useAuth();
  // Gerente só cadastra em equipes de cirurgiões vinculados a ele; o rótulo
  // identifica o cirurgião de cada equipe. Admin continua vendo todas.
  // (O banco reforça: policy patients_insert + Edge Function create-patient.)
  const isManager = hasRole(Role.MANAGER);
  // Em homologação, "Paciente de teste" já vem marcado (prevenção de erros).
  const [homologation, setHomologation] = useState(featureFlags.defaultTestPatient);
  const [form, setForm] = useState<FormState>({ ...empty, isTest: featureFlags.defaultTestPatient });
  const [surgeryTypes, setSurgeryTypes] = useState<SurgeryType[]>([]);
  const [hospitals, setHospitals] = useState<Hospital[]>([]);
  const [teamOptions, setTeamOptions] = useState<Array<{ value: string; label: string }>>([]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ link: string; phone: string; name: string } | null>(null);

  useEffect(() => {
    const teamsPromise = isManager
      ? teamViewService.getManagerTeams().then((details) =>
          details.map((d) => ({
            value: d.summary.id,
            label: `${d.summary.surgeonName} — Equipe nº ${String(d.summary.number).padStart(2, '0')}`,
          })),
        )
      : teamService.list().then((t) =>
          t.map((x) => ({ value: x.id, label: `Equipe ${String(x.team_number).padStart(2, '0')}` })),
        );
    Promise.all([surgeryTypeService.list(), hospitalService.list(), teamsPromise])
      .then(([st, h, t]) => {
        setSurgeryTypes(st.filter((x) => x.status === 'ACTIVE'));
        setHospitals(h.filter((x) => x.status === 'ACTIVE'));
        setTeamOptions(t);
      })
      .catch(() => toast.error('Erro ao carregar as listas de cadastro.'));
  }, [isManager]);

  // Modo de homologação ligado pelo Admin no banco (além do env): pré-marca o teste.
  useEffect(() => {
    if (featureFlags.defaultTestPatient) return;
    homologationService
      .isActive()
      .then((active) => {
        if (!active) return;
        setHomologation(true);
        setForm((p) => ({ ...p, isTest: true }));
      })
      .catch(() => {});
  }, []);

  const age = useMemo(() => {
    if (!form.birthDate) return '';
    const d = new Date(form.birthDate);
    return Number.isNaN(d.getTime()) ? '' : `${calculateAge(d)} anos`;
  }, [form.birthDate]);

  // Feedback imediato: assim que as duas datas estiverem preenchidas e fora de
  // ordem, marca o campo antes mesmo do usuário tentar enviar o formulário.
  const dischargeDateError = useMemo(
    () => (isDischargeAfterSurgery(form.surgeryDate, form.dischargeDate) ? undefined : DISCHARGE_BEFORE_SURGERY_ERROR),
    [form.surgeryDate, form.dischargeDate],
  );

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((p) => ({ ...p, [key]: value }));
  }

  async function submit() {
    if (!validateCpf(form.cpf)) {
      toast.error('CPF inválido. Verifique os dígitos e tente novamente.');
      return;
    }
    // DateField não é um input de data nativo, então o `required` do campo é
    // só visual (asterisco) — sem essa checagem explícita, o form deixaria
    // passar com data obrigatória vazia (o navegador não bloqueia mais o
    // submit sozinho, como bloqueava com o input nativo).
    if (!form.birthDate) {
      toast.error('Informe a data de nascimento.');
      return;
    }
    if (!form.surgeryDate) {
      toast.error('Informe a data da cirurgia.');
      return;
    }
    if (!form.dischargeDate) {
      toast.error('Informe a data da alta hospitalar.');
      return;
    }
    if (!isDischargeAfterSurgery(form.surgeryDate, form.dischargeDate)) {
      toast.error(DISCHARGE_BEFORE_SURGERY_ERROR);
      return;
    }
    setBusy(true);
    try {
      // Resumo de prontuário: editor rich text, então persiste o HTML (sanitizado);
      // "vazio" é decidido pelo texto visível, não pelas tags.
      const summaryHasText = richTextToPlainText(form.medicalRecordSummary).trim().length > 0;
      const patient = await patientService.create({
        name: form.name,
        cpf: form.cpf,
        birth_date: form.birthDate || undefined,
        phone: form.phone || undefined,
        surgery_type_id: form.surgeryTypeId,
        surgery_date: form.surgeryDate || undefined,
        hospital_discharge_date: form.dischargeDate || undefined,
        hospital_id: form.hospitalId,
        team_id: form.teamId,
        is_test: form.isTest,
        medical_record_summary: summaryHasText ? sanitizeRichText(form.medicalRecordSummary) : undefined,
        sex: form.sex || undefined,
        weight_kg: form.weightKg ? Number(form.weightKg.replace(',', '.')) : undefined,
        height_cm: form.heightCm ? Number(form.heightCm.replace(',', '.')) : undefined,
        // Comorbidades: o editor rich text é só apoio à digitação; a lista continua
        // sendo persistida como texto puro (string[]), um item por vírgula ou por
        // quebra visual (inclusive cada <li> da lista com marcadores).
        comorbidities: parseComorbidities(form.comorbidities),
        length_of_stay_days: form.lengthOfStayDays ? Number(form.lengthOfStayDays) : undefined,
        alternative_phone: form.alternativePhone || undefined,
        tcle_accepted_at: form.tcleAcceptedAt || undefined,
      });
      // Link público do paciente: rota sem login, validada por token seguro.
      // Usa o domínio de produção (VITE_PUBLIC_APP_URL) para nunca gerar link de
      // preview protegido da Vercel; cai em window.location.origin no dev local.
      const link = patientVitalsLink(patient.secure_token);
      toast.success('Paciente cadastrado e link gerado!');
      setResult({ link, phone: form.phone, name: form.name });
      setForm({ ...empty, isTest: homologation });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao cadastrar paciente.');
    } finally {
      setBusy(false);
    }
  }

  async function copyLink(link: string) {
    await navigator.clipboard.writeText(link);
    toast.info('Link copiado para a área de transferência.');
  }

  return (
    <PageContainer>
      <PageHeader
        title="Cadastro de Pacientes"
        subtitle="Preencha as informações necessárias para iniciar o monitoramento de recuperação pós-operatória."
      />

      <form
        className="space-y-6 animate-entry [animation-delay:100ms]"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Block index={1} title="Identificação do Paciente">
          <div className="grid md:grid-cols-2 gap-4">
            <TextInput label="Nome do paciente" placeholder="Ex. Maria Aparecida" value={form.name} onChange={(e) => set('name', e.target.value)} required />
            <TextInput
              label="CPF"
              hint="Usado para o paciente confirmar a identidade no link de medição."
              placeholder="000.000.000-00"
              inputMode="numeric"
              value={form.cpf}
              onChange={(e) => set('cpf', formatCpf(e.target.value))}
              required
            />
            <PhoneInput label="Telefone (WhatsApp)" value={form.phone} onChange={(v) => set('phone', v)} required />
            <DateField label="Data de nascimento" value={form.birthDate} onChange={(e) => set('birthDate', e.target.value)} required />
            <Field label="Idade" hint="Calculada automaticamente.">
              <input className="input bg-muted/60" value={age} readOnly placeholder="—" />
            </Field>
            <PhoneInput
              label="Contato alternativo"
              hint="Exigido no protocolo do estudo, caso o principal não atenda (opcional)."
              value={form.alternativePhone}
              onChange={(v) => set('alternativePhone', v)}
            />
          </div>
        </Block>

        <Block index={2} title="Detalhes do Procedimento">
          <div className="grid md:grid-cols-2 gap-4">
            <CustomSelect label="Tipo de cirurgia" value={form.surgeryTypeId} onChange={(e) => set('surgeryTypeId', e.target.value)} options={surgeryTypes.map((s) => ({ value: s.id, label: s.name }))} required />
            <CustomSelect label="Hospital" value={form.hospitalId} onChange={(e) => set('hospitalId', e.target.value)} options={hospitals.map((h) => ({ value: h.id, label: h.name }))} required />
            <DateField label="Data da cirurgia" value={form.surgeryDate} onChange={(e) => set('surgeryDate', e.target.value)} required />
            <DateField label="Data da alta hospitalar" hint="Inicia a contagem dos 10 dias de monitoramento." value={form.dischargeDate} onChange={(e) => set('dischargeDate', e.target.value)} error={dischargeDateError} required />
          </div>
          <div className="mt-4">
            <RichTextField
              label="Resumo de prontuário"
              hint="Breve histórico clínico relevante para o acompanhamento (opcional)."
              minHeightClassName="min-h-[140px]"
              value={form.medicalRecordSummary}
              onChange={(html) => set('medicalRecordSummary', html)}
            />
          </div>
        </Block>

        <Block index={3} title="Variáveis Clínicas do Estudo">
          <div className="grid md:grid-cols-2 gap-4">
            <CustomSelect
              label="Sexo"
              value={form.sex}
              onChange={(e) => set('sex', e.target.value as FormState['sex'])}
              options={[{ value: 'M', label: 'Masculino' }, { value: 'F', label: 'Feminino' }]}
            />
            <TextInput label="Peso (kg)" inputMode="decimal" placeholder="Ex. 72,5" value={form.weightKg} onChange={(e) => set('weightKg', e.target.value)} />
            <TextInput label="Altura (cm)" inputMode="numeric" placeholder="Ex. 170" value={form.heightCm} onChange={(e) => set('heightCm', e.target.value)} />
            <TextInput label="Tempo de internação (dias)" inputMode="numeric" value={form.lengthOfStayDays} onChange={(e) => set('lengthOfStayDays', e.target.value)} />
            <DateField label="TCLE assinado em" hint="Data de assinatura do Termo de Consentimento. O termo precisa conter a cláusula de contato ativo (ver docs/AVISO_CONTATO_ATIVO.md)." value={form.tcleAcceptedAt} onChange={(e) => set('tcleAcceptedAt', e.target.value)} />
          </div>
          <div className="mt-4">
            <RichTextField
              label="Comorbidades"
              hint="Separe por vírgula (ex.: diabetes, hipertensão) — opcional."
              toolbar="full"
              minHeightClassName="min-h-[120px]"
              value={form.comorbidities}
              onChange={(html) => set('comorbidities', html)}
            />
          </div>
        </Block>

        <Block index={4} title="Equipe Médica">
          <CustomSelect
            label="Equipe responsável"
            hint={
              isManager
                ? 'Você só pode cadastrar pacientes em equipes de cirurgiões vinculados a você.'
                : 'O paciente fica vinculado a esta equipe; os médicos dela receberão os alertas.'
            }
            value={form.teamId}
            onChange={(e) => set('teamId', e.target.value)}
            options={teamOptions}
            required
          />

          {(homologation || form.isTest) && (
            <div className="mt-4 flex flex-col gap-2 rounded-lg border border-warning/30 bg-warning/5 p-4">
              <ToggleSwitch
                checked={form.isTest}
                onChange={(v) => set('isTest', v)}
                label="Paciente de teste (homologação)"
              />
              <p className="text-xs text-muted-foreground">
                Pacientes de teste ficam marcados como fictícios e podem ser filtrados e removidos com segurança antes
                da liberação oficial para pacientes reais.
              </p>
            </div>
          )}
        </Block>

        <div className="flex justify-end">
          <Button type="submit" loading={busy}>
            <UserPlus className="size-4" /> Cadastrar e gerar link
          </Button>
        </div>
      </form>

      {result && (
        <section className="bg-card border border-stable/30 rounded-xl p-6 animate-entry">
          <div className="flex items-center gap-2 mb-3">
            <span className="size-8 rounded-full bg-stable/10 text-stable flex items-center justify-center">
              <CheckCircle2 className="size-5" />
            </span>
            <h3 className="font-bold">Link de monitoramento gerado</h3>
          </div>
          <p className="text-sm text-muted-foreground mb-4">
            Envie este link ao paciente pelo WhatsApp. Ele acessará o formulário de sinais vitais sem precisar de
            login.
          </p>
          <div className="bg-muted rounded-lg px-4 py-3 text-xs font-mono break-all border border-border">
            {result.link}
          </div>
          <div className="flex flex-col sm:flex-row gap-2 mt-4">
            <Button variant="ghost" onClick={() => copyLink(result.link)}>
              <Copy className="size-4" /> Copiar link
            </Button>
            <Button
              variant="whatsapp"
              onClick={() =>
                window.open(
                  whatsappLink(result.phone, `Olá, ${result.name}! Registre seus sinais vitais neste link seguro: ${result.link}`),
                  '_blank',
                )
              }
            >
              <MessageCircle className="size-4" /> Enviar pelo WhatsApp
            </Button>
            <span className="flex-1" />
            <Button variant="ghost" onClick={() => setResult(null)}>
              Cadastrar outro
            </Button>
          </div>
        </section>
      )}
    </PageContainer>
  );
}

function Block({ index, title, children }: { index: number; title: string; children: React.ReactNode }) {
  return (
    <section className="bg-card rounded-xl border border-border shadow-sm p-6">
      <header className="flex items-center gap-3 mb-5">
        <span className="size-7 rounded-full bg-primary/10 text-primary font-bold text-xs flex items-center justify-center">
          {index}
        </span>
        <h3 className="font-bold tracking-tight">{title}</h3>
      </header>
      {children}
    </section>
  );
}
