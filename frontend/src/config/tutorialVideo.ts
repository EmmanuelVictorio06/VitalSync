/**
 * Vídeo tutorial do paciente (como usar os aparelhos e preencher o registro),
 * hospedado no YouTube como "Não listado".
 *
 * Configure `VITE_TUTORIAL_VIDEO_URL` com o link do vídeo (qualquer formato:
 * youtube.com/watch?v=…, youtu.be/…, ou só o ID). Na Vercel: Settings →
 * Environment Variables, e faça um novo deploy para valer.
 *
 * Sem a variável (ou com um link inválido), o card do vídeo simplesmente não
 * aparece — o fluxo do paciente segue igual.
 */
import { parseYouTubeId } from '../lib/youtube';

export const tutorialVideo = {
  youtubeId: parseYouTubeId(import.meta.env.VITE_TUTORIAL_VIDEO_URL as string | undefined),
} as const;
