/**
 * Limites de equipe — fonte única no frontend (espelha as constantes garantidas
 * no banco pelas migrations 0028/0033). Não espalhar números mágicos pelas telas.
 */
export const TEAM_LIMITS = {
  /** Máximo de equipes ATIVAS por cirurgião principal. */
  maxTeamsPerSurgeon: 1,
  /** Máximo de médicos associados ATIVOS por equipe (o responsável não conta). */
  maxAssociatedDoctorsPerTeam: 10,
} as const;
