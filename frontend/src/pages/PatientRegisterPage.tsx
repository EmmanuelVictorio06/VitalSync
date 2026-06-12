import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Copy, MessageCircle, UserPlus } from 'lucide-react';
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
    <div className="p-4 md:p-8 max-w-5xl mx-auto w-full space-y-8">
      <div className="animate-entry">
        <h2 className="text-2xl md:text-3xl font-extrabold tracking-tight">Cadastro de Pacientes</h2>
        <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
          Preencha as informações necessárias para iniciar o monitoramento de recuperação pós-operatória.
        </p>
      </div>

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
            label="Cirurgião principal"
            hint="Os médicos associados a este cirurgião serão vinculados automaticamente para receber alertas."
            value={form.surgeonId}
            onChange={(e) => set('surgeonId', e.target.value)}
            options={surgeons.map((s) => ({ value: s.id, label: s.teamNumber ? `${s.name} (Equipe ${s.teamNumber})` : s.name }))}
            required
          />
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
            <button
              onClick={() => copyLink(result.link)}
              className="inline-flex items-center justify-center gap-2 px-4 py-2.5 border border-border rounded-lg text-sm font-semibold hover:bg-muted"
            >
              <Copy className="size-4" /> Copiar link
            </button>
            <button
              onClick={() =>
                window.open(
                  whatsappLink(result.phone, `Olá, ${result.name}! Registre seus sinais vitais neste link seguro: ${result.link}`),
                  '_blank',
                )
              }
              className="inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-[#25D366] text-white rounded-lg text-sm font-semibold hover:opacity-90"
            >
              <MessageCircle className="size-4" /> Enviar pelo WhatsApp
            </button>
            <span className="flex-1" />
            <Button variant="ghost" onClick={() => setResult(null)}>
              Cadastrar outro
            </Button>
          </div>
        </section>
      )}
    </div>
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
