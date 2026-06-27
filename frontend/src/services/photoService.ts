/**
 * Fotos de acompanhamento (cicatriz/dreno) — tabela measurement_photos.
 *
 * A leitura é restrita por RLS à equipe do paciente (ou ADMIN). As imagens
 * ficam num bucket PRIVADO; a exibição usa URL assinada (temporária), nunca
 * URL pública. As fotos são gravadas pelo fluxo do paciente (trigger no banco).
 */
import { supabase } from '../lib/supabase';
import { storageService } from './storageService';
import type { MeasurementPhoto } from './types';

export interface MeasurementPhotoWithUrl extends MeasurementPhoto {
  /** URL assinada para uso em <img src>; null se a assinatura falhar. */
  signedUrl: string | null;
}

/** Resolve a URL assinada de cada foto (em paralelo, tolerante a falha). */
async function withSignedUrls(rows: MeasurementPhoto[]): Promise<MeasurementPhotoWithUrl[]> {
  return Promise.all(
    rows.map(async (r) => {
      const signedUrl = await storageService
        .getPatientPhotoUrl(r.storage_path)
        .catch(() => null);
      return { ...r, signedUrl };
    }),
  );
}

export const photoService = {
  /** Fotos de uma medição específica (cicatriz e/ou dreno). */
  async listByRecord(vitalRecordId: string): Promise<MeasurementPhotoWithUrl[]> {
    const { data, error } = await supabase
      .from('measurement_photos')
      .select('*')
      .eq('vital_record_id', vitalRecordId)
      .order('photo_type');
    if (error) throw new Error(error.message);
    return withSignedUrls((data as MeasurementPhoto[]) ?? []);
  },

  /** Todas as fotos de um paciente (histórico), mais recentes primeiro. */
  async listByPatient(patientId: string): Promise<MeasurementPhotoWithUrl[]> {
    const { data, error } = await supabase
      .from('measurement_photos')
      .select('*')
      .eq('patient_id', patientId)
      .order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    return withSignedUrls((data as MeasurementPhoto[]) ?? []);
  },
};
