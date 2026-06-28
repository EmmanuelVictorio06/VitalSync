/**
 * Componentes da aba "Meu Perfil".
 *
 * Peças reutilizáveis de UI: avatar com upload/preview, campo de senha com
 * mostrar/ocultar, medidor de força, cartão de resumo do usuário. A lógica de
 * dados fica nos serviços (auth/profile/storage). Senha nunca trafega p/ o banco.
 */
import { useRef, useState } from 'react';
import { Camera, Eye, EyeOff, RefreshCw, ShieldCheck, Trash2, UserRound } from 'lucide-react';
import { isAcceptedWoundPhotoType } from '@vitalsync/shared';
import { Field, cn } from './ui';
import { StatusPill } from './admin';
import { AvatarCropModal } from './AvatarCropModal';
import type { EntityStatus } from '../services/types';

/* ---------------- Iniciais e rótulos ---------------- */
export function initials(name?: string | null): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1]?.[0] ?? '' : '')).toUpperCase();
}

/** Rótulos PT-BR por papel (Role). Fonte única em lib/roles (D-04). */
export { APP_ROLE_LABEL_PT as ROLE_LABEL_PT } from '../lib/roles';

/* ---------------- Validação do arquivo de avatar ---------------- */
const AVATAR_MAX_BYTES = 5 * 1024 * 1024;
export const AVATAR_ACCEPT = 'image/jpeg,image/jpg,image/png,image/webp';

export function validateAvatarFile(file: File): string | null {
  if (!isAcceptedWoundPhotoType(file.type)) return 'Formato inválido. Envie JPG, PNG ou WEBP.';
  if (file.size > AVATAR_MAX_BYTES) return 'Imagem muito grande. O limite é de 5 MB.';
  return null;
}

/* ---------------- Avatar com seleção + recorte (preview local) ---------------- */
export function AvatarUpload({
  name,
  currentUrl,
  previewUrl,
  isRemoved,
  onFileSelected,
  onRemove,
  busy,
  onError,
}: {
  name: string;
  currentUrl: string | null; // URL pública já salva (ou null)
  previewUrl?: string | null; // URL de prévia local (ObjectURL) — ainda não persistida
  isRemoved?: boolean; // true quando o usuário pediu remoção, mas ainda não salvou
  onFileSelected: (file: File) => void; // arquivo pronto após validação/recorte
  onRemove: () => void;
  busy?: boolean;
  onError?: (msg: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [cropFile, setCropFile] = useState<File | null>(null);

  function handleFiles(files: FileList | null) {
    const file = files?.[0];
    if (inputRef.current) inputRef.current.value = '';
    if (!file) return;
    const problem = validateAvatarFile(file);
    if (problem) {
      onError?.(problem);
      return;
    }
    setCropFile(file);
  }

  function handleCropConfirm(file: File) {
    setCropFile(null);
    onFileSelected(file);
  }

  const displayUrl = previewUrl ?? (isRemoved ? null : currentUrl);
  const hasPhoto = !!displayUrl;

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="size-28 rounded-full overflow-hidden border border-border bg-primary/10 text-primary grid place-items-center shrink-0">
        {displayUrl ? (
          <img src={displayUrl} alt={`Avatar de ${name}`} className="size-full object-cover" />
        ) : (
          <span className="text-3xl font-extrabold">{initials(name)}</span>
        )}
      </div>

      <input ref={inputRef} type="file" accept={AVATAR_ACCEPT} className="hidden" onChange={(e) => handleFiles(e.target.files)} />

      <div className="flex flex-wrap justify-center gap-2">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-primary/30 text-primary text-xs font-semibold hover:bg-accent disabled:opacity-55"
        >
          {hasPhoto ? <RefreshCw className="size-3.5" /> : <Camera className="size-3.5" />}
          {hasPhoto ? 'Trocar foto' : 'Adicionar foto'}
        </button>
        {hasPhoto && (
          <button
            type="button"
            onClick={onRemove}
            disabled={busy}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-alert/30 text-alert text-xs font-semibold hover:bg-alert/5 disabled:opacity-55"
          >
            <Trash2 className="size-3.5" /> Remover foto
          </button>
        )}
      </div>
      <p className="text-[11px] text-muted-foreground text-center">JPG, PNG ou WEBP · até 5 MB</p>

      {cropFile && (
        <AvatarCropModal
          imageFile={cropFile}
          onCancel={() => setCropFile(null)}
          onConfirm={handleCropConfirm}
          busy={busy}
        />
      )}
    </div>
  );
}

/* ---------------- Campo de senha com mostrar/ocultar ---------------- */
export function PasswordInput({
  label,
  value,
  onChange,
  hint,
  error,
  required,
  autoComplete,
  placeholder = '••••••••',
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
  error?: string;
  required?: boolean;
  autoComplete?: string;
  placeholder?: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <Field label={label} hint={hint} error={error} required={required}>
      <div className="relative">
        <input
          type={show ? 'text' : 'password'}
          className={cn('input pr-10', error && 'invalid')}
          value={value}
          placeholder={placeholder}
          autoComplete={autoComplete}
          onChange={(e) => onChange(e.target.value)}
        />
        <button
          type="button"
          onClick={() => setShow((s) => !s)}
          className="absolute inset-y-0 right-0 px-3 flex items-center text-muted-foreground hover:text-foreground"
          aria-label={show ? 'Ocultar senha' : 'Mostrar senha'}
          tabIndex={-1}
        >
          {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        </button>
      </div>
    </Field>
  );
}

/* ---------------- Medidor de força da senha ---------------- */
export function passwordScore(pw: string): number {
  let score = 0;
  if (pw.length >= 6) score++;
  if (pw.length >= 10) score++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score++;
  if (/\d/.test(pw) && /[^A-Za-z0-9]/.test(pw)) score++;
  return Math.min(score, 4);
}

export function PasswordStrengthMeter({ value }: { value: string }) {
  if (!value) return null;
  const score = passwordScore(value);
  const scale = [
    { label: 'Muito fraca', cls: 'bg-alert', text: 'text-alert' },
    { label: 'Fraca', cls: 'bg-alert', text: 'text-alert' },
    { label: 'Média', cls: 'bg-warning', text: 'text-warning' },
    { label: 'Boa', cls: 'bg-stable', text: 'text-stable' },
    { label: 'Forte', cls: 'bg-stable', text: 'text-stable' },
  ] as const;
  const meta = scale[score] ?? scale[0];
  return (
    <div className="mt-1.5">
      <div className="flex gap-1">
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className={cn('h-1.5 flex-1 rounded-full transition-colors', i < score ? meta.cls : 'bg-muted')} />
        ))}
      </div>
      <p className={cn('text-[11px] font-semibold mt-1', meta.text)}>Força: {meta.label}</p>
    </div>
  );
}

/* ---------------- Cartão de resumo do usuário ---------------- */
export function ProfileSummaryCard({
  name,
  email,
  roleLabel,
  status,
  avatarUrl,
  createdAt,
  lastSignInAt,
}: {
  name: string;
  email: string;
  roleLabel: string;
  status: EntityStatus;
  avatarUrl: string | null;
  createdAt?: string | null;
  lastSignInAt?: string | null;
}) {
  return (
    <div className="bg-card border border-border rounded-xl shadow-sm p-6 flex flex-col items-center text-center gap-3">
      <div className="size-24 rounded-full overflow-hidden border border-border bg-primary/10 text-primary grid place-items-center">
        {avatarUrl ? (
          <img src={avatarUrl} alt={`Avatar de ${name}`} className="size-full object-cover" />
        ) : (
          <span className="text-2xl font-extrabold">{initials(name)}</span>
        )}
      </div>
      <div className="min-w-0">
        <h3 className="text-lg font-extrabold tracking-tight truncate">{name}</h3>
        <p className="text-sm text-muted-foreground truncate">{email}</p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider bg-primary/10 text-primary border border-primary/20">
          <UserRound className="size-3" /> {roleLabel}
        </span>
        <StatusPill status={status} />
      </div>
      <dl className="w-full text-xs text-muted-foreground space-y-1 pt-2 border-t border-border mt-1">
        {lastSignInAt && (
          <div className="flex items-center justify-between gap-2">
            <dt>Último acesso</dt>
            <dd className="font-medium text-foreground">{new Date(lastSignInAt).toLocaleString('pt-BR')}</dd>
          </div>
        )}
        {createdAt && (
          <div className="flex items-center justify-between gap-2">
            <dt>Conta criada em</dt>
            <dd className="font-medium text-foreground">{new Date(createdAt).toLocaleDateString('pt-BR')}</dd>
          </div>
        )}
      </dl>
      <p className="text-[11px] text-muted-foreground inline-flex items-center gap-1.5 pt-1">
        <ShieldCheck className="size-3.5 text-stable" /> Conta protegida por autenticação
      </p>
    </div>
  );
}
