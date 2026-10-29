/**
 * Utilitários do YouTube para o vídeo tutorial do paciente.
 *
 * O link vem de env (`VITE_TUTORIAL_VIDEO_URL`), colado por quem configura o
 * deploy — então aceitamos qualquer formato que o YouTube oferece em "Compartilhar"
 * ou na barra de endereço, e também o ID puro.
 */

const ID_RE = /^[A-Za-z0-9_-]{11}$/;

/** Extrai o ID (11 caracteres) de um link do YouTube. `null` se não reconhecer. */
export function parseYouTubeId(input: string | null | undefined): string | null {
  const raw = (input ?? '').trim();
  if (!raw) return null;
  if (ID_RE.test(raw)) return raw;

  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return null;
  }

  const host = url.hostname.replace(/^(www\.|m\.|music\.)/, '');
  let candidate: string | null = null;

  if (host === 'youtu.be') {
    candidate = url.pathname.split('/')[1] ?? null;
  } else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    if (url.pathname === '/watch') {
      candidate = url.searchParams.get('v');
    } else {
      const m = url.pathname.match(/^\/(?:embed|shorts|live|v)\/([^/?#]+)/);
      candidate = m?.[1] ?? null;
    }
  }

  return candidate && ID_RE.test(candidate) ? candidate : null;
}

/**
 * URL do player embutido. Usa o domínio `youtube-nocookie.com` (o YouTube só
 * grava cookie quando o paciente dá play) e `rel=0` (no fim, sugere só vídeos
 * do mesmo canal, não de terceiros). `playsinline` evita que o iPhone abra em
 * tela cheia automaticamente.
 */
export function youtubeEmbedUrl(id: string, { autoplay = false } = {}): string {
  const params = new URLSearchParams({ rel: '0', playsinline: '1', modestbranding: '1' });
  if (autoplay) params.set('autoplay', '1');
  return `https://www.youtube-nocookie.com/embed/${id}?${params.toString()}`;
}

/** Miniatura estática (leve) mostrada antes do play. */
export function youtubeThumbnailUrl(id: string): string {
  return `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
}
