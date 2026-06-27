/**
 * Feature flags centralizadas. Ponto único para ligar/desligar comportamentos
 * por ambiente, evitando checagens espalhadas de `import.meta.env` pelo código.
 */
import { isHomologationModeEnv } from './environment';

export const featureFlags = {
  /** Exibe o badge "Ambiente de teste" no topo (também ativado via banco). */
  homologationBadge: isHomologationModeEnv,
  /** Pré-marca "Paciente de teste" no cadastro quando em homologação. */
  defaultTestPatient: isHomologationModeEnv,
} as const;

export type FeatureFlags = typeof featureFlags;
