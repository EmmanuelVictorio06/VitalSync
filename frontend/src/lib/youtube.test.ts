import { describe, it, expect } from 'vitest';
import { parseYouTubeId, youtubeEmbedUrl, youtubeThumbnailUrl } from './youtube';

const ID = 'dQw4w9WgXcQ';

describe('parseYouTubeId', () => {
  it('aceita os formatos de link que o YouTube oferece', () => {
    expect(parseYouTubeId(`https://www.youtube.com/watch?v=${ID}`)).toBe(ID);
    expect(parseYouTubeId(`https://youtube.com/watch?v=${ID}&t=42s`)).toBe(ID);
    expect(parseYouTubeId(`https://m.youtube.com/watch?v=${ID}`)).toBe(ID);
    expect(parseYouTubeId(`https://youtu.be/${ID}`)).toBe(ID);
    expect(parseYouTubeId(`https://youtu.be/${ID}?si=abc123`)).toBe(ID);
    expect(parseYouTubeId(`https://www.youtube.com/embed/${ID}`)).toBe(ID);
    expect(parseYouTubeId(`https://www.youtube-nocookie.com/embed/${ID}`)).toBe(ID);
    expect(parseYouTubeId(`https://www.youtube.com/shorts/${ID}`)).toBe(ID);
  });

  it('aceita link sem protocolo e o ID puro', () => {
    expect(parseYouTubeId(`youtu.be/${ID}`)).toBe(ID);
    expect(parseYouTubeId(`  ${ID}  `)).toBe(ID);
  });

  it('retorna null para vazio ou não configurado', () => {
    expect(parseYouTubeId('')).toBeNull();
    expect(parseYouTubeId('   ')).toBeNull();
    expect(parseYouTubeId(undefined)).toBeNull();
    expect(parseYouTubeId(null)).toBeNull();
  });

  it('retorna null para link que não é de vídeo do YouTube', () => {
    expect(parseYouTubeId('https://vimeo.com/123456789')).toBeNull();
    expect(parseYouTubeId('https://www.youtube.com/@canal')).toBeNull();
    expect(parseYouTubeId('https://www.youtube.com/watch?v=curto')).toBeNull();
    expect(parseYouTubeId('https://evil.com/watch?v=' + ID)).toBeNull();
    expect(parseYouTubeId('isto não é um link')).toBeNull();
  });
});

describe('youtubeEmbedUrl', () => {
  it('usa o domínio sem cookies e não sugere vídeos de outros canais', () => {
    const url = new URL(youtubeEmbedUrl(ID));
    expect(url.hostname).toBe('www.youtube-nocookie.com');
    expect(url.pathname).toBe(`/embed/${ID}`);
    expect(url.searchParams.get('rel')).toBe('0');
    expect(url.searchParams.get('playsinline')).toBe('1');
    expect(url.searchParams.has('autoplay')).toBe(false);
  });

  it('liga o autoplay quando pedido (depois do clique do paciente)', () => {
    expect(new URL(youtubeEmbedUrl(ID, { autoplay: true })).searchParams.get('autoplay')).toBe('1');
  });
});

describe('youtubeThumbnailUrl', () => {
  it('aponta para a miniatura estática do vídeo', () => {
    expect(youtubeThumbnailUrl(ID)).toBe(`https://i.ytimg.com/vi/${ID}/hqdefault.jpg`);
  });
});
