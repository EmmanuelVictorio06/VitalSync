/**
 * Modal clean de recorte de avatar.
 *
 * Usa react-easy-crop para zoom/pan e canvas para gerar a imagem final já
 * recortada em formato circular. O fundo fica suavemente borrado.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import Cropper from 'react-easy-crop';
import 'react-easy-crop/react-easy-crop.css';
import { X, ZoomIn, ZoomOut } from 'lucide-react';
import type { Area } from 'react-easy-crop';
import { ModalOverlay, cn } from './ui';

export const CROP_OUTPUT_SIZE = 512;

export interface AvatarCropModalProps {
  imageFile: File;
  onCancel: () => void;
  onConfirm: (croppedFile: File) => void;
  busy?: boolean;
}

function readFileAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function createImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

async function getCroppedImg(imageSrc: string, pixelCrop: Area): Promise<Blob> {
  const image = await createImage(imageSrc);
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas não disponível.');

  canvas.width = CROP_OUTPUT_SIZE;
  canvas.height = CROP_OUTPUT_SIZE;

  ctx.clearRect(0, 0, CROP_OUTPUT_SIZE, CROP_OUTPUT_SIZE);

  // Fundo branco para imagens sem transparência (evita fundo preto em JPG).
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, CROP_OUTPUT_SIZE, CROP_OUTPUT_SIZE);

  ctx.drawImage(
    image,
    pixelCrop.x,
    pixelCrop.y,
    pixelCrop.width,
    pixelCrop.height,
    0,
    0,
    CROP_OUTPUT_SIZE,
    CROP_OUTPUT_SIZE,
  );

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Não foi possível gerar a imagem recortada.'));
    }, 'image/png');
  });
}

export function AvatarCropModal({ imageFile, onCancel, onConfirm, busy }: AvatarCropModalProps) {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const previewTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    readFileAsDataURL(imageFile)
      .then((dataUrl) => setImageUrl(dataUrl))
      .catch(() => setError('Não foi possível carregar a imagem.'));
  }, [imageFile]);

  useEffect(() => {
    if (previewTimeoutRef.current) window.clearTimeout(previewTimeoutRef.current);
    if (!imageUrl || !croppedAreaPixels) {
      setPreviewUrl(null);
      return;
    }
    previewTimeoutRef.current = window.setTimeout(() => {
      getCroppedImg(imageUrl, croppedAreaPixels)
        .then((blob) => setPreviewUrl(URL.createObjectURL(blob)))
        .catch(() => setPreviewUrl(null));
    }, 250);
    return () => {
      if (previewTimeoutRef.current) window.clearTimeout(previewTimeoutRef.current);
    };
  }, [imageUrl, croppedAreaPixels]);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const onCropComplete = useCallback((_area: Area, pixels: Area) => {
    setCroppedAreaPixels(pixels);
  }, []);

  const apply = useCallback(async () => {
    if (!imageUrl || !croppedAreaPixels) return;
    try {
      const blob = await getCroppedImg(imageUrl, croppedAreaPixels);
      const file = new File([blob], 'avatar.png', { type: 'image/png' });
      onConfirm(file);
    } catch {
      setError('Não foi possível aplicar o recorte. Tente outra imagem.');
    }
  }, [imageUrl, croppedAreaPixels, onConfirm]);

  return (
    <ModalOverlay
      onClose={onCancel}
      className="z-50 items-center justify-center p-3 sm:p-4 overflow-y-auto"
      ariaLabel="Recortar foto de perfil"
      // Enquanto o recorte está sendo aplicado, fundo e ESC não fecham (mesma
      // regra que a versão anterior já tinha no clique).
      closeOnBackdrop={!busy}
      closeOnEsc={!busy}
    >
      {/* Overlay suavemente borrado */}
      <div className="absolute inset-0 bg-slate-900/10 backdrop-blur-sm" />

      <div
        className={cn(
          'relative w-full max-w-lg bg-card/95 backdrop-blur border border-border rounded-2xl shadow-xl',
          'flex flex-col max-h-[90vh] overflow-hidden animate-entry',
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-border shrink-0">
          <div>
            <h2 className="text-base sm:text-lg font-extrabold tracking-tight">Ajustar foto</h2>
            <p className="text-xs text-muted-foreground">Arraste, dê zoom e posicione seu rosto no círculo.</p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="size-8 rounded-md border border-border text-muted-foreground hover:bg-muted flex items-center justify-center disabled:opacity-55"
            aria-label="Fechar"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Cropper */}
        <div className="flex-1 min-h-[240px] sm:min-h-[320px] bg-muted/40 relative">
          {error ? (
            <div className="absolute inset-0 flex items-center justify-center p-6 text-center">
              <p className="text-sm text-alert">{error}</p>
            </div>
          ) : imageUrl ? (
            <Cropper
              image={imageUrl}
              crop={crop}
              zoom={zoom}
              aspect={1}
              cropShape="round"
              showGrid={false}
              onCropChange={setCrop}
              onZoomChange={setZoom}
              onCropComplete={onCropComplete}
              style={{
                containerStyle: { background: 'transparent' },
                cropAreaStyle: {
                  border: '2px solid var(--color-primary, hsl(210 100% 50%))',
                  boxShadow: '0 0 0 9999px rgba(15, 23, 42, 0.35)',
                },
              }}
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="size-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            </div>
          )}
        </div>

        {/* Zoom */}
        <div className="px-5 py-3 border-b border-border flex items-center gap-3 shrink-0">
          <ZoomOut className="size-4 text-muted-foreground" />
          <input
            type="range"
            min={1}
            max={3}
            step={0.05}
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
            className="flex-1 accent-primary"
            aria-label="Zoom"
            disabled={busy || !imageUrl}
          />
          <ZoomIn className="size-4 text-muted-foreground" />
        </div>

        {/* Preview + actions */}
        <div className="px-5 py-4 space-y-4 shrink-0 overflow-y-auto">
          {previewUrl && (
            <div className="flex items-center gap-4">
              <div className="shrink-0">
                <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5">Prévia</p>
                <div className="size-16 rounded-full overflow-hidden border border-border bg-primary/10">
                  <img src={previewUrl} alt="Prévia do recorte" className="size-full object-cover" />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                A foto será salva no formato quadrado e exibida como círculo nos seus avatares do sistema.
              </p>
            </div>
          )}

          <div className="flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-end gap-2 sm:gap-3">
            <button
              type="button"
              onClick={onCancel}
              disabled={busy}
              className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-lg border border-border text-sm font-semibold hover:bg-muted disabled:opacity-55"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={() => void apply()}
              disabled={busy || !croppedAreaPixels}
              className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 disabled:opacity-55"
            >
              {busy ? 'Salvando…' : 'Aplicar recorte'}
            </button>
          </div>
        </div>
      </div>
    </ModalOverlay>
  );
}
