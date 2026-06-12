import { useEffect, useMemo, useState } from 'react';
import { calculateAge, whatsappLink } from '@vitalsync/shared';
import { useToast } from '../components/Toast';
import { Button, Field, PhoneInput, SelectField, TextInput } from '../components/ui';
import { api, ApiError } from '../lib/api';
import type { SelectItem, SurgeonItem } from '../lib/dto';

interface FormState {
  name: string;
  birthDate: string;
  phone: string;
  surgeryTypeId: string;
  surgeryDate: string;
  dischargeDate: string;
  hospitalId: string;
  surgeonId: string;
}
const empty: FormState = {
  name: '', birthDate: '', phone: '', surgeryTypeId: '', surgeryDate: '', dischargeDate: '', hospitalId: '', surgeonId: '',
};

export function PatientRegisterPage() {
  const toast = useToast();
  const [form, setForm] = useState<FormState>(empty);
  const [surgeryTypes, setSurgeryTypes] = useState<SelectItem[]>([]);
  const [hospitals, setHospitals] = useState<SelectItem[]>([]);
  const [surgeons, setSurgeons] = useState<SurgeonItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ link: string; phone: string; name: string } | null>(null);

  useEffect(() => {
    Promise.all([
      api.get<{ items: SelectItem[] }>('/catalog/surgery-types'),
      api.get<{ items: SelectItem[] }>('/catalog/hospitals'),
      api.get<{ items: SurgeonItem[] }>('/catalog/surgeons'),
    ])
      .then(([st, h, s]) => {
        setSurgeryTypes(st.items);
        setHospitals(h.items);
        setSurgeons(s.items);
      })
      .catch(() => toast.error('Erro ao carregar as listas de cadastro.'));
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
      const res = await api.post<{ patient: { id: string }; link: string }>('/patients', {
        ...form,
        phone: form.phone,
      });
      toast.success('Paciente cadastrado e link gerado!');
      setResult({ link: res.link, phone: form.phone, name: form.name });
      setForm(empty);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Erro ao cadastrar paciente.');
    } finally {
      setBusy(false);
    }
  }

  async function copyLink(link: string) {
    await navigator.clipboard.writeText(link);
    toast.info('Link copiado para a área de transferência.');
  }

  return (
    <div className="stack">
      <div>
        <h1>Cadastro de Pacientes</h1>
        <p className="subtext">Preencha as informações necessárias para iniciar o monitoramento de recuperação pós-operatória.</p>
      </div>

      {result && (
        <div className="card stack" style={{ borderColor: 'var(--green)' }}>
          <div className="block-title" style={{ color: 'var(--green)' }}>Link de monitoramento gerado</div>
          <p className="muted" style={{ fontSize: '.88rem', wordBreak: 'break-all' }}>{result.link}</p>
          <div className="row">
            <Button variant="secondary" onClick={() => copyLink(result.link)}>📋 Copiar link</Button>
            <Button
              variant="whatsapp"
              onClick={() =>
                window.open(
                  whatsappLink(result.phone, `Olá, ${result.name}! Registre seus sinais vitais neste link seguro: ${result.link}`),
                  '_blank',
                )
              }
            >
              Enviar pelo WhatsApp
            </Button>
            <span className="spacer" />
            <Button variant="ghost" onClick={() => setResult(null)}>Cadastrar outro</Button>
          </div>
        </div>
      )}

      <div className="card stack">
        <div className="block-title">Identificação do paciente</div>
        <div className="grid grid-2">
          <TextInput label="Nome do paciente" value={form.name} onChange={(e) => set('name', e.target.value)} required />
          <PhoneInput label="Número de telefone" value={form.phone} onChange={(v) => set('phone', v)} required />
          <TextInput label="Data de nascimento" type="date" value={form.birthDate} onChange={(e) => set('birthDate', e.target.value)} required />
          <Field label="Idade" hint="Calculada automaticamente.">
            <input value={age} readOnly placeholder="—" />
          </Field>
        </div>

        <div className="block-title">Detalhes do procedimento</div>
        <div className="grid grid-2">
          <SelectField label="Tipo de cirurgia" value={form.surgeryTypeId} onChange={(e) => set('surgeryTypeId', e.target.value)} options={surgeryTypes.map((s) => ({ value: s.id, label: s.name }))} required />
          <SelectField label="Hospital" value={form.hospitalId} onChange={(e) => set('hospitalId', e.target.value)} options={hospitals.map((h) => ({ value: h.id, label: h.name }))} required />
          <TextInput label="Data da cirurgia" type="date" value={form.surgeryDate} onChange={(e) => set('surgeryDate', e.target.value)} required />
          <TextInput label="Data da alta hospitalar" type="date" hint="Inicia a contagem dos 10 dias de monitoramento." value={form.dischargeDate} onChange={(e) => set('dischargeDate', e.target.value)} required />
        </div>

        <div className="block-title">Equipe médica</div>
        <SelectField
          label="Cirurgião principal"
          hint="Os médicos associados a este cirurgião serão vinculados automaticamente para receber alertas."
          value={form.surgeonId}
          onChange={(e) => set('surgeonId', e.target.value)}
          options={surgeons.map((s) => ({ value: s.id, label: s.teamNumber ? `${s.name} (Equipe ${s.teamNumber})` : s.name }))}
          required
        />

        <Button size="lg" onClick={submit} loading={busy}>Cadastrar e gerar link</Button>
      </div>
    </div>
  );
}
