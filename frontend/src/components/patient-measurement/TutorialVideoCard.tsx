/**
 * Card com o vídeo tutorial (como usar os aparelhos e preencher o registro).
 *
 * POR QUE A MINIATURA ANTES DO PLAYER: o iframe do YouTube baixa ~1 MB de
 * scripts assim que aparece. O paciente abre esta tela 2×/dia por 10 dias, no
 * 4G, e só precisa do vídeo nas primeiras vezes. Então mostramos só a imagem
 * (leve) e o player real só é carregado quando ele toca em "assistir".
 *
 * Sem `VITE_TUTORIAL_VIDEO_URL` configurado, o card não é renderizado.
 */
import { useState } from 'react';
import { Play, PlayCircle } from 'lucide-react';
import { tutorialVideo } from '../../config/tutorialVideo';
import { youtubeEmbedUrl, youtubeThumbnailUrl } from '../../lib/youtube';

export function TutorialVideoCard() {
  const [playing, setPlaying] = useState(false);
  const id = tutorialVideo.youtubeId;
  if (!id) return null;

  return (
    <section className="text-left">
      <div className="flex items-center gap-2 pb-2.5">
        <PlayCircle className="size-5 text-primary shrink-0" />
        <h2 className="text-sm font-bold text-foreground">Como fazer suas medições</h2>
      </div>

      {/* Vídeo gravado na vertical (celular). O player usa 3:4 — meio-termo
          escolhido no ajuste visual: 16:9 espremia o vídeo, 9:16 ficava
          comprido demais. Tamanho contido (~16rem × ~21rem, menor em telas
          baixas) para não empurrar os botões de período para fora da tela.
          Tela cheia fica no próprio player. */}
      <div className="relative mx-auto w-full max-w-[min(16rem,calc(45svh*3/4))] aspect-[3/4] overflow-hidden rounded-2xl bg-black">
        {playing ? (
          <iframe
            src={youtubeEmbedUrl(id, { autoplay: true })}
            title="Vídeo: como fazer suas medições"
            className="absolute inset-0 size-full"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
          />
        ) : (
          <button
            type="button"
            onClick={() => setPlaying(true)}
            aria-label="Assistir ao vídeo: como fazer suas medições"
            className="group absolute inset-0 size-full"
          >
            <img
              src={youtubeThumbnailUrl(id)}
              alt=""
              loading="lazy"
              className="absolute inset-0 size-full object-cover opacity-90 group-hover:opacity-100 transition-opacity"
            />
            <span className="absolute inset-0 grid place-items-center">
              <span className="flex items-center gap-2 rounded-full bg-primary text-primary-foreground px-5 py-3 font-bold text-sm shadow-lg shadow-black/30 group-hover:bg-primary/90 transition-colors">
                <Play className="size-4 fill-current" />
                Assistir ao vídeo
              </span>
            </span>
          </button>
        )}
      </div>
    </section>
  );
}
