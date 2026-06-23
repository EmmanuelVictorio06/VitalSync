/** Tipos das linhas das tabelas do Supabase (camada de serviços). */

export type UserRole = 'ADMIN' | 'MAIN_SURGEON' | 'ASSOCIATED_DOCTOR';
export type RoleInTeam = 'MAIN_SURGEON' | 'ASSOCIATED_DOCTOR';
export type EntityStatus = 'ACTIVE' | 'INACTIVE';
export type MeasurementPeriod = 'MORNING' | 'NIGHT';
export type ClinicalStatus = 'GREEN' | 'YELLOW' | 'RED';

export interface Profile {
  id: string;
  name: string;
  email: string;
  whatsapp: string | null;
  role: UserRole;
  created_at: string;
}

export interface Hospital {
  id: string;
  name: string;
  city: string | null;
  state: string | null;
  status: EntityStatus;
  created_at: string;
}

export interface SurgeryType {
  id: string;
  name: string;
  specialty: string | null;
  description: string | null;
  status: EntityStatus;
  created_at: string;
}

export interface MedicalTeam {
  id: string;
  team_number: number;
  main_surgeon_id: string | null;
  status: EntityStatus;
  created_at: string;
}

export interface TeamMember {
  id: string;
  team_id: string;
  doctor_id: string;
  role_in_team: RoleInTeam;
  status: EntityStatus;
  created_at: string;
}

export interface Patient {
  id: string;
  name: string;
  birth_date: string | null;
  phone: string | null;
  surgery_type_id: string | null;
  surgery_date: string | null;
  hospital_discharge_date: string | null;
  hospital_id: string | null;
  team_id: string;
  secure_token: string;
  status: EntityStatus;
  current_status: ClinicalStatus;
  created_at: string;
}

export interface VitalSignRecord {
  id: string;
  patient_id: string;
  record_date: string;
  period: MeasurementPeriod;
  monitoring_day: number | null;
  temperature: number | null;
  oxygen_saturation: number | null;
  systolic_pressure: number | null;
  diastolic_pressure: number | null;
  heart_rate: number | null;
  pain_level: number | null;
  dyspnea_level: number | null;
  urination_count: number | null;
  vomiting_count: number | null;
  has_bleeding: boolean | null;
  steps: number | null;
  wound_photo_path: string | null;
  clinical_status: ClinicalStatus;
  created_at: string;
}

export interface ClinicalAlert {
  id: string;
  patient_id: string;
  team_id: string;
  vital_record_id: string | null;
  status: ClinicalStatus;
  description: string;
  attended: boolean;
  attended_by: string | null;
  attended_at: string | null;
  created_at: string;
}
