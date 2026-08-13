/**
 * Storage das fotos da ferida/dreno — bucket PRIVADO `patient-photos`.
 *
 * O acesso é por URL assinada (nunca pública). Para demo, qualquer autenticado
 * lê; em produção, restringir por equipe (ver políticas no SQL).
 */
import { WOUND_PHOTO, isAcceptedWoundPhotoType, woundPhotoExtension } from '@vitalsync/shared';
import { supabase } from '../lib/supabase';
import { extractEdgeError } from '../lib/edgeError';

const BUCKET = 'patient-photos';
const AVATAR_BUCKET = 'profile-avatars';

/** Tipo da foto de acompanhamento enviada pelo paciente. */
export type PatientPhotoKind = 'wound' | 'drain';

export const storageService = {
  /**
   * Sobe a foto de acompanhamento e retorna o caminho salvo.
   *  - `wound` → vital_sign_records.wound_photo_path (cicatriz operatória)
   *  - `drain` → vital_sign_records.drain_photo_path (foto do dreno)
   * Vai pela Edge Function `upload-patient-photo` (service_role), que revalida
   * token + CPF e resolve a pasta do paciente no servidor — o bucket não aceita
   * mais INSERT anon direto (migration 0042).
   */
  async uploadPatientPhotoViaToken(
    file: File,
    token: string,
    cpf: string,
    kind: PatientPhotoKind = 'wound',
  ): Promise<string> {
    const fd = new FormData();
    fd.append('token', token);
    fd.append('cpf', cpf);
    fd.append('kind', kind);
    fd.append('file', file);
    const { data, error } = await supabase.functions.invoke('upload-patient-photo', { body: fd });
    if (error) {
      throw new Error(await extractEdgeError(error, 'Não foi possível enviar a foto. Tente novamente.'));
    }
    const path = (data as { path?: string })?.path;
    if (!path) throw new Error('Não foi possível enviar a foto. Tente novamente.');
    return path;
  },

  /**
   * Sobe a foto de acompanhamento pelo cliente AUTENTICADO (staff logado) e
   * retorna o caminho salvo — usado no lançamento da medição pela equipe
   * (FUNC 3 / migration 0074).
   *
   * Não passa por Edge Function de propósito: a policy `patient_photos_write`
   * (0020, intacta após a 0042) já autoriza `authenticated` a inserir em
   * `{patientId}/...` quando `is_admin() or is_team_member(...)` — quem não é da
   * equipe do paciente é barrado pelo próprio Storage. O fluxo ANÔNIMO por token
   * continua exclusivamente em `uploadPatientPhotoViaToken`; os dois caminhos não
   * se cruzam.
   *
   * NOTA CONHECIDA (fora do escopo da FUNC 3): a policy de escrita checa
   * `is_team_member`, não `is_nurse_for_patient` — um enfermeiro SÓ-de-pool (sem
   * vínculo de equipe) não conseguiria subir foto. Irrelevante no piloto, que é
   * por equipe.
   *
   * Valida antes de subir com as MESMAS regras da Edge Function
   * `upload-patient-photo` (10 MB, jpg/png/webp), via `WOUND_PHOTO` do
   * @vitalsync/shared — fonte única.
   */
  async uploadPatientPhotoAsStaff(
    file: File,
    patientId: string,
    kind: PatientPhotoKind = 'wound',
  ): Promise<string> {
    if (!isAcceptedWoundPhotoType(file.type)) throw new Error(WOUND_PHOTO.messages.invalidFormat);
    if (file.size === 0 || file.size > WOUND_PHOTO.maxBytes) {
      throw new Error(file.size === 0 ? WOUND_PHOTO.messages.invalidFormat : WOUND_PHOTO.messages.tooLarge);
    }

    // Extensão derivada do MIME (não do nome do arquivo, que o usuário controla).
    const path = `${patientId}/${kind}-${Date.now()}.${woundPhotoExtension(file.type)}`;
    const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
      cacheControl: '3600',
      upsert: false,
      contentType: file.type,
    });
    if (error) throw new Error(WOUND_PHOTO.messages.uploadFailed);
    return path;
  },

  /** URL assinada (temporária) para exibir a foto protegida em <img src>. */
  async getPatientPhotoUrl(path: string, expiresInSeconds = 3600): Promise<string> {
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, expiresInSeconds);
    if (error) throw new Error(error.message);
    return data.signedUrl;
  },

  async removePatientPhoto(path: string): Promise<void> {
    const { error } = await supabase.storage.from(BUCKET).remove([path]);
    if (error) throw new Error(error.message);
  },

  /* ---------------- Avatares de perfil (bucket público controlado) ----------------
     O caminho começa por <userId>/ — as políticas de Storage só deixam o dono
     escrever na própria pasta. Guardamos o CAMINHO em profiles.avatar_url. */
  async uploadProfileAvatar(file: File, userId: string): Promise<string> {
    const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg';
    const path = `${userId}/avatar_${Date.now()}.${ext}`;
    const { error } = await supabase.storage.from(AVATAR_BUCKET).upload(path, file, {
      cacheControl: '3600',
      upsert: true,
      contentType: file.type,
    });
    if (error) throw new Error(error.message);
    return path;
  },

  /** URL pública do avatar (bucket público) a partir do caminho salvo. */
  getProfileAvatarUrl(path: string): string {
    return supabase.storage.from(AVATAR_BUCKET).getPublicUrl(path).data.publicUrl;
  },

  async deleteProfileAvatar(path: string): Promise<void> {
    const { error } = await supabase.storage.from(AVATAR_BUCKET).remove([path]);
    if (error) throw new Error(error.message);
  },
};
