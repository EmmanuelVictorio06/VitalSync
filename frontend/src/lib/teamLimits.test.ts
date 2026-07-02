import { describe, it, expect } from 'vitest';
import { TEAM_LIMITS } from './teamLimits';

describe('TEAM_LIMITS', () => {
  it('máximo de equipes ativas por cirurgião principal é 1 (migration 0033)', () => {
    expect(TEAM_LIMITS.maxTeamsPerSurgeon).toBe(1);
  });

  it('máximo de associados ativos por equipe é 10 (migrations 0028/0030)', () => {
    expect(TEAM_LIMITS.maxAssociatedDoctorsPerTeam).toBe(10);
  });
});
