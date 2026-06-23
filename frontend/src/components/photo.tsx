import { useEffect, useRef, useState } from 'react';
import { Camera, ImageIcon, Loader2, Moon, RefreshCw, Sun, Trash2, X, ZoomIn } from 'lucide-react';
import { Period, WOUND_PHOTO, isAcceptedWoundPhotoType } from '@vitalsync/shared';
import { fetchProtectedImage } from '../lib/api';
import type { VitalRecord } from '../lib/dto';
import { cn } from './ui';

/** `accept` do input — restringe a seleção a imagens aceitas (JPG/PNG/WEBP). */
const ACCEPT = WOUND_PHOTO.acceptedMimeTypes.join(',');

/** Formata bytes em texto curto (ex.: "1.8 MB"). */
function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Valida o arquivo escolhido. Retorna mensagem de erro ou null se válido. */
export function validatePhotoFile(file: File): string | null {
  if (!isAcceptedWoundPhotoType(file.type)) return WOUND_PHOTO.messages.invalidFormat;
  if (file.size > WOUND_PHOTO.maxBytes) return WOUND_PHOTO.messages.tooLarge;
  return null;
}

/* ------------------------------------------------------------------ */
/*  RemoveImageButton — botão reutilizável de remover                  */
/* ------------------------------------------------------------------ */
export function RemoveImageButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-lg border border-alert/30 text-alert font-semibold text-sm hover:bg-alert/10"
    >
      <Trash2 className="size-4" /> Remover foto
    </button>
  );
}

/* ------------------------------------------------------------------ */
/*  ImagePreviewCard — prévia da imagem local (File) + ações           */
/* ------------------------------------------------------------------ */
export function ImagePreviewCard({
  file,
  onReplace,
  onRemove,
}: {
  file: File;
  onReplace: () => void;
  onRemove: () => void;
}) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    const objectUrl = URL.createObjectURL(file);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);

  return (
    <div className="space-y-3">
      <div className="rounded-xl overflow-hidden border border-border bg-muted/40">
        {url && (
          <img src={url} alt="Prévia da foto da ferida" className="w-full max-h-72 object-contain bg-black/5" />
        )}
      </div>
      <p className="text-xs text-muted-foreground truncate">
        <span className="font-semibold text-foreground">{file.name}</span> · {humanSize(file.size)}
      </p>
      <div className="grid grid-cols-2 gap-3">
        <button
          type="button"
          onClick={onReplace}
          className="inline-flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-lg border border-primary/30 text-primary font-semibold text-sm hover:bg-accent"
        >
          <RefreshCw className="size-4" /> Trocar foto
        </button>
        <RemoveImageButton onClick={onRemove} />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  PhotoUploadField — card de envio (paciente)                        */
/* ------------------------------------------------------------------ */
export function PhotoUploadField({
  value,
  onChange,
  onError,
}: {
  value: File | null;
  onChange: (file: File | null) => void;
  onError?: (message: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  function openPicker() {
    inputRef.current?.click();
  }

  function handleFiles(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    const problem = validatePhotoFile(file);
    if (problem) {
      onError?.(problem);
      if (inputRef.current) inputRef.current.value = '';
      return;
    }
    onChange(file);
  }

  return (
    <div className="bg-card border border-border rounded-2xl shadow-sm p-5 space-y-4">
      <header className="flex items-start gap-3">
        <div className="size-10 shrink-0 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
          <Camera className="size-5" />
        </div>
        <div>
          <h2 className="text-base font-extrabold tracking-tight">Foto da ferida operatória ou do dreno</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Envie uma foto nítida da região operada ou do dreno, caso exista. Essa imagem será analisada pela
            equipe médica.
          </p>
        </div>
      </header>

      {/* Input nativo escondido — abre câmera ou galeria no celular. */}
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
      />

      {value ? (
        <ImagePreviewCard file={value} onReplace={openPicker} onRemove={() => onChange(null)} />
      ) : (
        <button
          type="button"
          onClick={openPicker}
          className="w-full flex flex-col items-center justify-center gap-2 py-7 px-5 rounded-xl border-2 border-dashed border-primary/40 text-primary bg-primary/5 hover:bg-primary/10 transition-colors"
        >
          <ImageIcon className="size-7" />
          <span className="font-bold text-base">Adicionar foto</span>
          <span className="text-xs text-muted-foreground">JPG, PNG ou WEBP · até {humanSize(WOUND_PHOTO.maxBytes)}</span>
        </button>
      )}

      <div className="rounded-lg bg-muted/60 px-3 py-2.5 text-xs text-muted-foreground">
        💡 Tire a foto em um local bem iluminado e tente deixar a imagem nítida.
      </div>
      <p className="text-xs text-muted-foreground">Envio opcional, mas recomendado para melhor acompanhamento.</p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  useProtectedImage — carrega imagem autenticada como object URL     */
/* ------------------------------------------------------------------ */
export function useProtectedImage(path: string | null) {
  const [src, setSrc] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!path) {
      setSrc(null);
      return;
    }
    // URL já assinada (Supabase Storage) — usa direto, sem buscar via Fastify.
    if (/^https?:\/\//.test(path)) {
      setSrc(path);
      setLoading(false);
      setError(false);
      return;
    }
    let active = true;
    let created: string | null = null;
    setLoading(true);
    setError(false);
    fetchProtectedImage(path)
      .then((url) => {
        if (!active) {
          URL.revokeObjectURL(url);
          return;
        }
        created = url;
        setSrc(url);
      })
      .catch(() => active && setError(true))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
      if (created) URL.revokeObjectURL(created);
    };
  }, [path]);

  return { src, loading, error };
}

/* ------------------------------------------------------------------ */
/*  ViewImageModal — modal com a imagem ampliada                       */
/* ------------------------------------------------------------------ */
export function ViewImageModal({
  src,
  fileName,
  onClose,
}: {
  src: string;
  fileName?: string | null;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 bg-foreground/70 backdrop-blur-sm flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div className="relative max-w-3xl w-full animate-entry" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          onClick={onClose}
          className="absolute -top-3 -right-3 size-9 rounded-full bg-card border border-border shadow-lg flex items-center justify-center hover:bg-muted"
          aria-label="Fechar"
        >
          <X className="size-5" />
        </button>
        <img
          src={src}
          alt={fileName ?? 'Foto da ferida operatória ou do dreno'}
          className="w-full max-h-[80vh] object-contain rounded-xl bg-black/40"
        />
        {fileName && <p className="text-center text-xs text-white/80 mt-3 truncate">{fileName}</p>}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  PatientMeasurementPhotoSection — painel médico                     */
/* ------------------------------------------------------------------ */
function PhotoRecordCard({ record }: { record: VitalRecord }) {
  const { src, loading, error } = useProtectedImage(record.woundPhotoUrl);
  const [open, setOpen] = useState(false);

  const uploadedAt = record.woundPhotoUploadedAt ? new Date(record.woundPhotoUploadedAt) : null;
  const isMorning = record.period === Period.MORNING;

  return (
    <div className="bg-card border border-border rounded-xl shadow-sm p-4 flex gap-4">
      <button
        type="button"
        onClick={() => src && setOpen(true)}
        className="relative size-24 shrink-0 rounded-lg overflow-hidden border border-border bg-muted/50 grid place-items-center group"
        aria-label="Visualizar foto"
      >
        {loading && <Loader2 className="size-5 animate-spin text-muted-foreground" />}
        {error && <span className="text-[10px] text-alert px-1 text-center">Falha ao carregar</span>}
        {src && (
          <>
            <img src={src} alt="Miniatura da foto da ferida" className="size-full object-cover" />
            <span className="absolute inset-0 bg-foreground/0 group-hover:bg-foreground/30 transition-colors flex items-center justify-center">
              <ZoomIn className="size-6 text-white opacity-0 group-hover:opacity-100" />
            </span>
          </>
        )}
      </button>

      <div className="min-w-0 flex flex-col">
        <span
          className={cn(
            'inline-flex w-fit items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase',
            isMorning ? 'bg-warning/10 text-warning' : 'bg-primary/10 text-primary',
          )}
        >
          {isMorning ? <Sun className="size-3" /> : <Moon className="size-3" />}
          {isMorning ? 'Manhã' : 'Noite'} · D+{record.monitoringDay}
        </span>
        <p className="text-xs text-muted-foreground mt-1.5">
          {uploadedAt
            ? uploadedAt.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
            : '—'}
        </p>
        <button
          type="button"
          onClick={() => src && setOpen(true)}
          disabled={!src}
          className="mt-auto inline-flex w-fit items-center gap-1.5 text-sm font-semibold text-primary hover:underline disabled:opacity-50 disabled:no-underline"
        >
          <ZoomIn className="size-4" /> Visualizar foto
        </button>
      </div>

      {open && src && <ViewImageModal src={src} fileName={record.woundPhotoFileName} onClose={() => setOpen(false)} />}
    </div>
  );
}

export function PatientMeasurementPhotoSection({ records }: { records: VitalRecord[] }) {
  const withPhotos = records.filter((r) => r.woundPhotoUrl);

  return (
    <section className="bg-card border border-border rounded-xl shadow-sm p-5 md:p-6 space-y-4">
      <header className="flex items-center gap-2">
        <Camera className="size-4 text-primary" />
        <h3 className="text-sm font-bold uppercase tracking-widest text-muted-foreground">
          Foto da ferida operatória ou do dreno
        </h3>
      </header>

      {withPhotos.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhuma foto enviada neste período.</p>
      ) : (
        <div className="grid sm:grid-cols-2 gap-4">
          {withPhotos.map((r) => (
            <PhotoRecordCard key={`${r.monitoringDay}-${r.period}`} record={r} />
          ))}
        </div>
      )}
    </section>
  );
}
