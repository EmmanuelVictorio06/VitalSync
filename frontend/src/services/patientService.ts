import type { ClinicalStatus } from '@vitalsync/shared';
import { api } from '../lib/api';
import type { Paginated } from '../lib/dto';
import type { EntityStatus, Patient } from './types';

interface ApiPatient {
  id: string;
  name: string;
  birthDate: string | null;
  phone: string | null;
  surgeryTypeId: string | null;
  surgeryDate: string | null;
  dischargeDate: string | null;
  hospitalId: string | null;
  teamId: string;
  currentStatus: ClinicalStatus;
  createdAt: string;
  surgeryType?: { name: string } | null;
  hospital?: { name: string } | null;
  team?: { number: number } | null;
}

export interface PatientWithNames {
  id: string;
  name: string;
  birth_date: string | null;
  phone: string | null;
  surgery_type_id: string | null;
  surgery_date: string | null;
  hospital_discharge_date: string | null;
  hospital_id: string | null;
  team_id: string;
  secure_token?: string;
  status: EntityStatus;
  current_status: ClinicalStatus;
  created_at: string;
  surgery_type: { name: string } | null;
  hospital: { name: string } | null;
  medical_team: { team_number: number } | null;
}

export interface NewPatientInput {
  name: string;
  birth_date?: string;
  phone?: string;
  surgery_type_id: string;
  surgery_date?: string;
  hospital_discharge_date?: string;
  hospital_id: string;
  team_id: string;
}

function mapPatient(p: ApiPatient): PatientWithNames {
  return {
    id: p.id,
    name: p.name,
    birth_date: p.birthDate,
    phone: p.phone,
    surgery_type_id: p.surgeryTypeId,
    surgery_date: p.surgeryDate,
    hospital_discharge_date: p.dischargeDate,
    hospital_id: p.hospitalId,
    team_id: p.teamId,
    status: 'ACTIVE',
    current_status: p.currentStatus,
    created_at: p.createdAt,
    surgery_type: p.surgeryType ? { name: p.surgeryType.name } : null,
    hospital: p.hospital ? { name: p.hospital.name } : null,
    medical_team: p.team ? { team_number: p.team.number } : null,
  };
}

export const patientService = {
  async list(opts: { status?: ClinicalStatus; search?: string } = {}): Promise<PatientWithNames[]> {
    const params = new URLSearchParams({ page: '1', pageSize: '100' });
    if (opts.status) params.set('status', opts.status);
    if (opts.search) params.set('search', opts.search);

    const res = await api.get<Paginated<ApiPatient>>(`/patients?${params.toString()}`);
    return res.items.map(mapPatient);
  },

  async getLink(id: string): Promise<string> {
    const res = await api.post<{ link: string }>(`/patients/${id}/link`);
    return res.link;
  },

  async create(input: NewPatientInput): Promise<Patient & { secure_token: string }> {
    const res = await api.post<{ patient: ApiPatient; link: string }>('/patients', {
      name: input.name,
      birthDate: input.birth_date,
      phone: input.phone,
      surgeryTypeId: input.surgery_type_id,
      surgeryDate: input.surgery_date,
      dischargeDate: input.hospital_discharge_date,
      hospitalId: input.hospital_id,
      surgeonId: input.team_id,
    });

    return {
      ...(mapPatient(res.patient) as unknown as Patient),
      secure_token: res.link.split('/r/')[1] ?? '',
    };
  },

  async remove(id: string): Promise<void> {
    await api.del(`/patients/${id}`);
  },
};
