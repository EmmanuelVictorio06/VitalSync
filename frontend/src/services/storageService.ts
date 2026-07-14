/**
 * Storage das fotos da ferida/dreno — bucket PRIVADO `patient-photos`.
 *
 * O acesso é por URL assinada (nunca pública). Para demo, qualquer autenticado
 * lê; em produção, restringir por equipe (ver políticas no SQL).
 */
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
