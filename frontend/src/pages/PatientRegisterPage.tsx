import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Copy, MessageCircle, UserPlus } from 'lucide-react';
import { calculateAge, whatsappLink } from '@vitalsync/shared';
import { useToast } from '../components/Toast';
import { ToggleSwitch } from '../components/admin';
import { Button, Field, PageContainer, PageHeader, PhoneInput, SelectField, TextInput } from '../components/ui';
import { featureFlags } from '../config/featureFlags';
import { patientVitalsLink } from '../lib/publicUrl';
import { hospitalService } from '../services/hospitalService';
import { surgeryTypeService } from '../services/surgeryTypeService';
import { teamService } from '../services/teamService';
import { homologationService } from '../services/homologationService';
import { patientService } from '../services/patientService';
import type { Hospital, MedicalTeam, SurgeryType } from '../services/types';

interface FormState {
  name: string;
  birthDate: string;
  phone: string;
  surgeryTypeId: string;
  surgeryDate: string;
  dischargeDate: string;
  hospitalId: string;
  teamId: string;
  isTest: boolean;
}
const empty: FormState = {
  name: '', birthDate: '', phone: '', surgeryTypeId: '', surgeryDate: '', dischargeDate: '', hospitalId: '', teamId: '', isTest: false,
};

export function PatientRegisterPage() {
  const toast = useToast();
  // Em homologação, "Paciente de teste" já vem marcado (prevenção de erros).
  const [homologation, setHomologation] = useState(featureFlags.defaultTestPatient);
  const [form, setForm] = useState<FormState>({ ...empty, isTest: featureFlags.defaultTestPatient });
  const [surgeryTypes, setSurgeryTypes] = useState<SurgeryType[]>([]);
  const [hospitals, setHospitals] = useState<Hospital[]>([]);
  const [teams, setTeams] = useState<MedicalTeam[]>([]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ link: string; phone: string; name: string } | null>(null);

  useEffect(() => {
    Promise.all([surgeryTypeService.list(), hospitalService.list(), teamService.list()])
      .then(([st, h, t]) => {
        setSurgeryTypes(st.filter((x) => x.status === 'ACTIVE'));
        setHospitals(h.filter((x) => x.status === 'ACTIVE'));
        setTeams(t);
      })
      .catch(() => toast.error('Erro ao carregar as listas de cadastro.'));
  }, []);

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

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((p) => ({ ...p, [key]: value }));
  }

  async function submit() {
    setBusy(true);
    try {
      const patient = await patientService.create({
        name: form.name,
        birth_date: form.birthDate || undefined,
        phone: form.phone || undefined,
        surgery_type_id: form.surgeryTypeId,
        surgery_date: form.surgeryDate || undefined,
        hospital_discharge_date: form.dischargeDate || undefined,
        hospital_id: form.hospitalId,
        team_id: form.teamId,
        is_test: form.isTest,
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
            <PhoneInput label="Telefone (WhatsApp)" value={form.phone} onChange={(v) => set('phone', v)} required />
            <TextInput label="Data de nascimento" type="date" value={form.birthDate} onChange={(e) => set('birthDate', e.target.value)} required />
            <Field label="Idade" hint="Calculada automaticamente.">
              <input className="input bg-muted/60" value={age} readOnly placeholder="—" />
            </Field>
          </div>
        </Block>

        <Block index={2} title="Detalhes do Procedimento">
          <div className="grid md:grid-cols-2 gap-4">
            <SelectField label="Tipo de cirurgia" value={form.surgeryTypeId} onChange={(e) => set('surgeryTypeId', e.target.value)} options={surgeryTypes.map((s) => ({ value: s.id, label: s.name }))} required />
            <SelectField label="Hospital" value={form.hospitalId} onChange={(e) => set('hospitalId', e.target.value)} options={hospitals.map((h) => ({ value: h.id, label: h.name }))} required />
            <TextInput label="Data da cirurgia" type="date" value={form.surgeryDate} onChange={(e) => set('surgeryDate', e.target.value)} required />
            <TextInput label="Data da alta hospitalar" type="date" hint="Inicia a contagem dos 10 dias de monitoramento." value={form.dischargeDate} onChange={(e) => set('dischargeDate', e.target.value)} required />
          </div>
        </Block>

        <Block index={3} title="Equipe Médica">
          <SelectField
            label="Equipe responsável"
            hint="O paciente fica vinculado a esta equipe; os médicos dela receberão os alertas."
            value={form.teamId}
            onChange={(e) => set('teamId', e.target.value)}
            options={teams.map((t) => ({ value: t.id, label: `Equipe ${String(t.team_number).padStart(2, '0')}` }))}
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
