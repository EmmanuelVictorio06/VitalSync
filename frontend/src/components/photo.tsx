import { useEffect, useRef, useState } from 'react';
import { Camera, ChevronLeft, ChevronRight, ImageIcon, Loader2, Moon, RefreshCw, Sun, Trash2, X, ZoomIn } from 'lucide-react';
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
      className="w-full sm:flex-1 min-h-11 inline-flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-lg border border-alert/30 text-alert font-semibold text-sm hover:bg-alert/10"
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
    <div className="space-y-3 min-w-0">
      {/* Container seguro: qualquer proporção fica contida, sem estourar o card. */}
      <div className="w-full max-w-full rounded-xl overflow-hidden border border-border bg-muted/40 flex items-center justify-center">
        {url && (
          <img
            src={url}
            alt="Prévia da foto da ferida"
            className="max-h-56 sm:max-h-64 w-full max-w-full object-contain bg-black/5"
          />
        )}
      </div>
      {/* Nome do arquivo: trunca sem empurrar o layout. */}
      <p className="min-w-0 max-w-full truncate text-xs text-muted-foreground">
        <span className="font-semibold text-foreground">{file.name}</span> · {humanSize(file.size)}
      </p>
      {/* Ações: empilham no mobile, lado a lado no desktop. */}
      <div className="flex flex-col sm:flex-row gap-2 w-full">
        <button
          type="button"
          onClick={onReplace}
          className="w-full sm:flex-1 min-h-11 inline-flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-lg border border-primary/30 text-primary font-semibold text-sm hover:bg-accent"
        >
          <RefreshCw className="size-4" /> Trocar foto
        </button>
        <RemoveImageButton onClick={onRemove} />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  PhotoUploadField — um campo de foto (paciente)                     */
/* ------------------------------------------------------------------ */
export function PhotoUploadField({
  value,
  onChange,
  onError,
  title = 'Foto da cicatriz operatória',
  description = 'Envie uma foto nítida da cicatriz operatória para acompanhamento da equipe médica.',
}: {
  value: File | null;
  onChange: (file: File | null) => void;
  onError?: (message: string) => void;
  title?: string;
  description?: string;
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
    <div className="rounded-xl border border-border bg-muted/30 p-4 space-y-3">
      <header className="flex items-start gap-3">
        <div className="size-9 shrink-0 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
          <Camera className="size-5" />
        </div>
        <div>
          <h3 className="text-sm font-extrabold tracking-tight">{title}</h3>
          <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
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
          className="w-full flex flex-col items-center justify-center gap-2 py-6 px-5 rounded-xl border-2 border-dashed border-primary/40 text-primary bg-primary/5 hover:bg-primary/10 transition-colors"
        >
          <ImageIcon className="size-6" />
          <span className="font-bold text-base">Adicionar foto</span>
          <span className="text-xs text-muted-foreground">JPG, PNG ou WEBP · até {humanSize(WOUND_PHOTO.maxBytes)}</span>
        </button>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  DrainQuestionField — pergunta "Você possui dreno?" (Sim/Não)       */
/* ------------------------------------------------------------------ */
export function DrainQuestionField({
  value,
  onChange,
  /** Padrão fala com o PACIENTE; o lançamento pela equipe passa outro texto. */
  label = 'Você possui dreno?',
}: {
  value: boolean | null;
  onChange: (v: boolean) => void;
  label?: string;
}) {
  return (
    <div>
      <span className="block text-sm font-bold mb-2">{label}</span>
      <div className="grid grid-cols-2 gap-3">
        {([true, false] as const).map((opt) => {
          const active = value === opt;
          return (
            <button
              key={String(opt)}
              type="button"
              onClick={() => onChange(opt)}
              className={cn(
                'py-4 rounded-xl font-bold text-base border-2 transition-all',
                active
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border bg-card text-muted-foreground hover:border-primary/30',
              )}
            >
              {opt ? 'Sim' : 'Não'}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  PatientPhotoUploadSection — card "Fotos de acompanhamento"         */
/*  Pergunta do dreno + upload da cicatriz + (se Sim) upload do dreno  */
/* ------------------------------------------------------------------ */
export function PatientPhotoUploadSection({
  hasDrain,
  onHasDrainChange,
  woundPhoto,
  onWoundPhotoChange,
  drainPhoto,
  onDrainPhotoChange,
  onError,
}: {
  hasDrain: boolean | null;
  onHasDrainChange: (v: boolean) => void;
  woundPhoto: File | null;
  onWoundPhotoChange: (file: File | null) => void;
  drainPhoto: File | null;
  onDrainPhotoChange: (file: File | null) => void;
  onError?: (message: string) => void;
}) {
  return (
    <section className="bg-card border border-border rounded-2xl shadow-sm p-5 space-y-4">
      <header>
        <h2 className="text-lg font-extrabold tracking-tight">Fotos de acompanhamento</h2>
        <p className="text-sm text-muted-foreground">As fotos ajudam a equipe médica a acompanhar sua recuperação.</p>
      </header>

      <DrainQuestionField value={hasDrain} onChange={onHasDrainChange} />

      {hasDrain !== null && (
        <div className="space-y-3">
          {/* Sem dreno: ajuda mais completa. Com dreno: ajuda curta + foto do dreno. */}
          <PhotoUploadField
            value={woundPhoto}
            onChange={onWoundPhotoChange}
            onError={onError}
            title="Foto da cicatriz operatória"
            description={
              hasDrain
                ? 'Envie uma foto nítida da cicatriz operatória.'
                : 'Envie uma foto nítida da cicatriz operatória para acompanhamento da equipe médica.'
            }
          />

          {hasDrain && (
            <PhotoUploadField
              value={drainPhoto}
              onChange={onDrainPhotoChange}
              onError={onError}
              title="Foto do dreno"
              description="Envie uma foto nítida do dreno para acompanhamento da equipe médica."
            />
          )}

          <div className="rounded-lg bg-muted/60 px-3 py-2.5 text-xs text-muted-foreground">
            💡 Tire a foto em um local bem iluminado e tente deixar a imagem nítida.
          </div>
          <p className="text-xs text-muted-foreground">Envio opcional, mas recomendado para melhor acompanhamento.</p>
        </div>
      )}
    </section>
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

/** Card de UMA foto (cicatriz ou dreno): miniatura + período + data + ver. */
function PhotoThumbCard({
  label,
  photoUrl,
  fileName,
  uploadedAt,
  period,
  monitoringDay,
}: {
  label: string;
  photoUrl: string | null;
  fileName: string | null;
  uploadedAt: string | null;
  period: Period;
  monitoringDay: number;
}) {
  const { src, loading, error } = useProtectedImage(photoUrl);
  const [open, setOpen] = useState(false);

  const at = uploadedAt ? new Date(uploadedAt) : null;
  const isMorning = period === Period.MORNING;

  return (
    <div className="bg-card border border-border rounded-xl shadow-sm p-4 flex gap-4">
      <button
        type="button"
        onClick={() => src && setOpen(true)}
        className="relative size-24 shrink-0 rounded-lg overflow-hidden border border-border bg-muted/50 grid place-items-center group"
        aria-label={`Visualizar ${label.toLowerCase()}`}
      >
        {loading && <Loader2 className="size-5 animate-spin text-muted-foreground" />}
        {error && <span className="text-[10px] text-alert px-1 text-center">Falha ao carregar</span>}
        {src && (
          <>
            <img src={src} alt={`Miniatura — ${label}`} className="size-full object-cover" />
            <span className="absolute inset-0 bg-foreground/0 group-hover:bg-foreground/30 transition-colors flex items-center justify-center">
              <ZoomIn className="size-6 text-white opacity-0 group-hover:opacity-100" />
            </span>
          </>
        )}
      </button>

      <div className="min-w-0 flex flex-col">
        <p className="text-sm font-bold tracking-tight">{label}</p>
        <span
          className={cn(
            'inline-flex w-fit items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase mt-1',
            isMorning ? 'bg-warning/10 text-warning' : 'bg-primary/10 text-primary',
          )}
        >
          {isMorning ? <Sun className="size-3" /> : <Moon className="size-3" />}
          {isMorning ? 'Manhã' : 'Noite'} · D+{monitoringDay}
        </span>
        <p className="text-xs text-muted-foreground mt-1.5">
          {at
            ? at.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
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

      {open && src && <ViewImageModal src={src} fileName={fileName} onClose={() => setOpen(false)} />}
    </div>
  );
}

/** Mensagem curta (sem foto) com cor neutra. */
function PhotoEmptyNote({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-muted-foreground bg-muted/40 border border-border rounded-xl px-4 py-3">{children}</p>;
}

/** Bloco de fotos de UM registro (período): dreno + cicatriz + dreno. */
function RecordPhotosBlock({ record }: { record: VitalRecord }) {
  return (
    <div className="space-y-3">
      <p className="text-sm">
        <span className="font-bold">Possui dreno:</span>{' '}
        <span className={record.hasDrain ? 'text-primary font-semibold' : 'text-muted-foreground'}>
          {record.hasDrain ? 'Sim' : 'Não'}
        </span>
      </p>

      <div className="grid sm:grid-cols-2 gap-4">
        {/* Cicatriz operatória */}
        {record.woundPhotoUrl ? (
          <PhotoThumbCard
            label="Foto da cicatriz operatória"
            photoUrl={record.woundPhotoUrl}
            fileName={record.woundPhotoFileName}
            uploadedAt={record.woundPhotoUploadedAt}
            period={record.period}
            monitoringDay={record.monitoringDay}
          />
        ) : (
          <PhotoEmptyNote>Nenhuma foto da cicatriz operatória anexada.</PhotoEmptyNote>
        )}

        {/* Dreno — só quando o paciente informou possuir */}
        {record.hasDrain &&
          (record.drainPhotoUrl ? (
            <PhotoThumbCard
              label="Foto do dreno"
              photoUrl={record.drainPhotoUrl}
              fileName={record.drainPhotoFileName}
              uploadedAt={record.drainPhotoUploadedAt}
              period={record.period}
              monitoringDay={record.monitoringDay}
            />
          ) : (
            <PhotoEmptyNote>
              Paciente informou que possui dreno, mas nenhuma foto do dreno foi anexada.
            </PhotoEmptyNote>
          ))}
      </div>

      {!record.hasDrain && (
        <p className="text-xs text-muted-foreground">Paciente informou que não possui dreno.</p>
      )}
    </div>
  );
}

export function PatientMeasurementPhotoSection({ records }: { records: VitalRecord[] }) {
  // Mostra os registros que tenham ALGO de acompanhamento de foto: alguma foto
  // anexada ou a informação de que possui dreno.
  const relevant = records.filter((r) => r.woundPhotoUrl || r.drainPhotoUrl || r.hasDrain);
  const count = relevant.length;

  // Carrossel: um registro por vez (a tela não estica com dezenas de fotos).
  // Rolagem horizontal com scroll-snap; setas/indicadores controlam a posição.
  const trackRef = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);

  function goTo(i: number) {
    const clamped = Math.max(0, Math.min(count - 1, i));
    const track = trackRef.current;
    const slide = track?.children[clamped] as HTMLElement | undefined;
    if (track && slide) track.scrollTo({ left: slide.offsetLeft - track.offsetLeft, behavior: 'smooth' });
    setIndex(clamped);
  }

  // Mantém o indicador em sincronia quando o usuário arrasta/rola manualmente.
  function handleScroll() {
    const track = trackRef.current;
    if (!track) return;
    const center = track.scrollLeft + track.clientWidth / 2;
    let nearest = 0;
    let best = Infinity;
    Array.from(track.children).forEach((c, i) => {
      const el = c as HTMLElement;
      const mid = el.offsetLeft - track.offsetLeft + el.clientWidth / 2;
      const dist = Math.abs(mid - center);
      if (dist < best) {
        best = dist;
        nearest = i;
      }
    });
    setIndex(nearest);
  }

  return (
    <section className="bg-card border border-border rounded-xl shadow-sm p-5 md:p-6 space-y-4">
      <header className="flex items-center gap-2">
        <Camera className="size-4 text-primary" />
        <h3 className="text-sm font-bold uppercase tracking-widest text-muted-foreground">Fotos de acompanhamento</h3>
        {count > 1 && (
          <div className="ml-auto flex items-center gap-1.5">
            <span className="text-xs font-semibold text-muted-foreground tabular-nums mr-1">
              {index + 1} / {count}
            </span>
            <button
              type="button"
              onClick={() => goTo(index - 1)}
              disabled={index === 0}
              aria-label="Foto anterior"
              className="size-8 grid place-items-center rounded-full border border-border bg-card text-muted-foreground hover:text-primary hover:border-primary/40 disabled:opacity-40 disabled:hover:text-muted-foreground disabled:hover:border-border transition-colors"
            >
              <ChevronLeft className="size-4" />
            </button>
            <button
              type="button"
              onClick={() => goTo(index + 1)}
              disabled={index === count - 1}
              aria-label="Próxima foto"
              className="size-8 grid place-items-center rounded-full border border-border bg-card text-muted-foreground hover:text-primary hover:border-primary/40 disabled:opacity-40 disabled:hover:text-muted-foreground disabled:hover:border-border transition-colors"
            >
              <ChevronRight className="size-4" />
            </button>
          </div>
        )}
      </header>

      {count === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhuma foto enviada neste período.</p>
      ) : (
        <>
          <div
            ref={trackRef}
            onScroll={handleScroll}
            className="flex gap-4 overflow-x-auto snap-x snap-mandatory scroll-smooth -mx-1 px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {relevant.map((r) => (
              <div key={`${r.monitoringDay}-${r.period}`} className="snap-center shrink-0 w-full">
                <RecordPhotosBlock record={r} />
              </div>
            ))}
          </div>

          {count > 1 && (
            <div className="flex justify-center gap-1.5 pt-1">
              {relevant.map((r, i) => (
                <button
                  key={`${r.monitoringDay}-${r.period}`}
                  type="button"
                  onClick={() => goTo(i)}
                  aria-label={`Ir para a foto ${i + 1}`}
                  aria-current={i === index}
                  className={cn(
                    'h-1.5 rounded-full transition-all',
                    i === index ? 'w-5 bg-primary' : 'w-1.5 bg-border hover:bg-muted-foreground/40',
                  )}
                />
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}
