/**
 * Storage das fotos da ferida/dreno — bucket PRIVADO `patient-photos`.
 *
 * O acesso é por URL assinada (nunca pública). Para demo, qualquer autenticado
 * lê; em produção, restringir por equipe (ver políticas no SQL).
 */
import { supabase } from '../lib/supabase';

const BUCKET = 'patient-photos';

export const storageService = {
  /** Sobe a foto e retorna o caminho salvo (vai em vital_sign_records.wound_photo_path). */
  async uploadPatientPhoto(file: File, patientId: string): Promise<string> {
    const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg';
    const path = `${patientId}/${Date.now()}.${ext}`;
    const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
      cacheControl: '3600',
      upsert: false,
      contentType: file.type,
    });
    if (error) throw new Error(error.message);
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
};
