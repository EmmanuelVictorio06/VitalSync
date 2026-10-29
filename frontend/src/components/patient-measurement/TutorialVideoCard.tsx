/**
 * Card com o vídeo tutorial (como usar os aparelhos e preencher o registro).
 *
 * DESENHO (ajustado visualmente com o dono do produto):
 * - O card é compacto e só tem a miniatura + título + "Assistir". O player do
 *   YouTube NÃO roda dentro dele: em tamanho pequeno o YouTube sobrepõe título,
 *   logo, CC, barra e legenda e fica ilegível — e isso não é configurável.
 * - Ao tocar, o vídeo abre num modal grande (quase tela cheia no celular),
 *   onde os controles do YouTube têm espaço.
 * - O iframe só é criado ao abrir o modal: o paciente abre esta tela 2×/dia
 *   por 10 dias, no 4G, e só precisa do vídeo nas primeiras vezes.
 *
 * O vídeo foi gravado na vertical (9:16). A miniatura do YouTube (4:3) traz o
 * quadro vertical centralizado com faixas pretas; `object-cover` numa caixa
 * 9:16 recorta exatamente o quadro, sem as faixas.
 *
 * Sem `VITE_TUTORIAL_VIDEO_URL` configurado, o card não é renderizado.
 */
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Play, X } from 'lucide-react';
import { tutorialVideo } from '../../config/tutorialVideo';
import { youtubeEmbedUrl, youtubeThumbnailUrl } from '../../lib/youtube';

export function TutorialVideoCard() {
  const [open, setOpen] = useState(false);
  const id = tutorialVideo.youtubeId;
  if (!id) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Assistir ao vídeo: como fazer suas medições"
        className="group w-full flex items-center gap-4 rounded-2xl border border-primary/20 bg-primary/5 p-3 text-left hover:bg-primary/10 transition-colors"
      >
        <span className="relative w-16 aspect-[9/16] shrink-0 overflow-hidden rounded-xl bg-black">
          <img src={youtubeThumbnailUrl(id)} alt="" loading="lazy" className="absolute inset-0 size-full object-cover" />
          <span className="absolute inset-0 grid place-items-center bg-black/25">
            <span className="grid place-items-center size-8 rounded-full bg-white/90 text-primary shadow">
              <Play className="size-4 fill-current translate-x-px" />
            </span>
          </span>
        </span>
        <span className="min-w-0">
          <span className="block text-sm font-bold text-foreground">Como fazer suas medições</span>
          <span className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-primary text-primary-foreground px-3.5 py-1.5 text-xs font-bold group-hover:bg-primary/90 transition-colors">
            <Play className="size-3 fill-current" />
            Assistir ao vídeo
          </span>
        </span>
      </button>

      {open && <TutorialVideoModal id={id} onClose={() => setOpen(false)} />}
    </>
  );
}

function TutorialVideoModal({ id, onClose }: { id: string; onClose: () => void }) {
  // Esc fecha; a página de trás não rola enquanto o vídeo está aberto.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  // Portal no <body>: o card fica dentro de um container com animação de
  // entrada (transform), que prenderia o `fixed` dentro dele em vez da tela.
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Vídeo: como fazer suas medições"
      className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-black/85 p-4"
      onClick={onClose}
    >
      <div className="w-full max-w-[min(26rem,calc(80svh*9/16))] flex justify-end">
        <button
          type="button"
          onClick={onClose}
          className="flex items-center gap-1.5 rounded-full bg-white/15 px-3.5 py-2 text-sm font-bold text-white hover:bg-white/25 transition-colors"
        >
          <X className="size-4" />
          Fechar
        </button>
      </div>
      {/* Vídeo vertical: 9:16, o maior que couber (80% da altura da tela). */}
      <div
        className="relative w-full max-w-[min(26rem,calc(80svh*9/16))] aspect-[9/16] overflow-hidden rounded-2xl bg-black"
        onClick={(e) => e.stopPropagation()}
      >
        <iframe
          src={youtubeEmbedUrl(id, { autoplay: true })}
          title="Vídeo: como fazer suas medições"
          className="absolute inset-0 size-full"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
        />
      </div>
    </div>,
    document.body,
  );
}
