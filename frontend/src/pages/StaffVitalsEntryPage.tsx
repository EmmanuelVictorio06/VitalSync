import { useEffect, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Period } from '@vitalsync/shared';
import { StaffVitalsEntryForm } from '../components/patient-measurement/StaffVitalsEntryForm';
import { periodLabel } from '../components/patient-measurement/types';
import { useToast } from '../components/Toast';
import { Loading, PageContainer } from '../components/ui';
import { patientService, type PatientWithNames } from '../services/patientService';

export function StaffVitalsEntryPage() {
  const { id } = useParams<{ id: string }>();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const [patient, setPatient] = useState<PatientWithNames | null>(null);
  const [loading, setLoading] = useState(true);

  const period = params.get('period') === Period.NIGHT ? Period.NIGHT : Period.MORNING;

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    patientService
      .getById(id)
      .then(setPatient)
      .catch((err) => toast.error(err instanceof Error ? err.message : 'Erro ao carregar o paciente.'))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (loading) return <PageContainer><Loading label="Carregando paciente…" /></PageContainer>;
  if (!id || !patient) {
    return (
      <PageContainer>
        <p className="text-center text-muted-foreground py-12">Paciente não encontrado.</p>
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <Link
        to={`/patients/${id}`}
        className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" /> Voltar para o paciente
      </Link>

      <section className="bg-card border border-border rounded-xl p-5 md:p-6">
        <h2 className="text-xl font-extrabold tracking-tight">Registrar medição em nome do paciente</h2>
        <p className="text-sm text-muted-foreground mt-1">
          {patient.name} — período da {periodLabel(period).toLowerCase()} de hoje, ainda não registrado.
        </p>
      </section>

      <StaffVitalsEntryForm
        patientId={id}
        period={period}
        onSuccess={() => {
          navigate(`/patients/${id}`);
        }}
      />
    </PageContainer>
  );
}
