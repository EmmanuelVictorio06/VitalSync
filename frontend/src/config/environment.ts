/**
 * Ambiente de execução e flags derivadas das variáveis do Vite (build-time).
 *
 * `VITE_APP_ENV=homologation` ou `VITE_HOMOLOGATION_MODE=true` fixam o modo de
 * homologação já na build (útil para um deploy dedicado de testes). O painel do
 * Administrador também liga/desliga o modo em runtime (banco) — ver
 * `homologationService` / RPC `is_homologation_mode`. O badge considera os dois.
 */
export const APP_ENV = (import.meta.env.VITE_APP_ENV as string | undefined)?.trim() || 'production';

/** Modo de homologação fixado em build (env). */
export const isHomologationModeEnv =
  String(import.meta.env.VITE_HOMOLOGATION_MODE).trim() === 'true' || APP_ENV === 'homologation';
