/** Cliente HTTP central. Anexa o token JWT e padroniza tratamento de erros. */
const BASE = (import.meta.env.VITE_API_URL ?? 'http://localhost:3333') + '/api';

const TOKEN_KEY = 'vitalsync.token';

export const tokenStore = {
  get: (): string | null => localStorage.getItem(TOKEN_KEY),
  set: (t: string): void => localStorage.setItem(TOKEN_KEY, t),
  clear: (): void => localStorage.removeItem(TOKEN_KEY),
};

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code?: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, options: RequestInit = {}, auth = true): Promise<T> {
  const headers = new Headers(options.headers);
  if (!(options.body instanceof FormData)) headers.set('Content-Type', 'application/json');
  if (auth) {
    const token = tokenStore.get();
    if (token) headers.set('Authorization', `Bearer ${token}`);
  }

  const res = await fetch(BASE + path, { ...options, headers });

  if (res.status === 204) return undefined as T;

  const isJson = res.headers.get('content-type')?.includes('application/json');
  const payload = isJson ? await res.json() : await res.blob();

  if (!res.ok) {
    const message = isJson ? (payload as { message?: string }).message : 'Erro na requisição.';
    if (res.status === 401) tokenStore.clear();
    throw new ApiError(res.status, message ?? 'Erro inesperado.', (payload as { error?: string }).error);
  }
  return payload as T;
}

export const api = {
  get: <T>(path: string, auth = true) => request<T>(path, { method: 'GET' }, auth),
  post: <T>(path: string, body?: unknown, auth = true) =>
    request<T>(path, { method: 'POST', body: body != null ? JSON.stringify(body) : undefined }, auth),
  /** POST de multipart/form-data (uploads). Não define Content-Type (o browser o faz). */
  postForm: <T>(path: string, form: FormData, auth = true) =>
    request<T>(path, { method: 'POST', body: form }, auth),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PATCH', body: body != null ? JSON.stringify(body) : undefined }),
  del: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};

/** Faz download de um arquivo autenticado (exportação CSV/XLSX). */
export async function downloadFile(path: string, fallbackName: string): Promise<void> {
  const token = tokenStore.get();
  const res = await fetch(BASE + path, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!res.ok) throw new ApiError(res.status, 'Não foi possível exportar os dados.');
  const blob = await res.blob();
  const disposition = res.headers.get('content-disposition') ?? '';
  const match = /filename="?([^"]+)"?/.exec(disposition);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = match?.[1] ?? fallbackName;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Busca uma imagem protegida (requer JWT) e devolve uma object URL utilizável em
 * `<img src>`. A foto da ferida nunca fica em URL pública; o acesso é autenticado.
 * Lembre-se de revogar a URL retornada (URL.revokeObjectURL) ao desmontar.
 */
export async function fetchProtectedImage(path: string): Promise<string> {
  const token = tokenStore.get();
  const res = await fetch(BASE + path, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!res.ok) throw new ApiError(res.status, 'Não foi possível carregar a foto.');
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}

export { BASE as API_BASE };
