import { describe, it, expect } from 'vitest';
import { Role } from '@vitalsync/shared';
import { dbRoleToAppRole, APP_ROLE_LABEL_PT, dbRoleLabelPt } from './roles';

describe('dbRoleToAppRole', () => {
  it('ADMIN -> Role.ADM', () => expect(dbRoleToAppRole('ADMIN')).toBe(Role.ADM));
  it('MEDICAL_SURGEON -> Role.SURGEON', () => expect(dbRoleToAppRole('MEDICAL_SURGEON')).toBe(Role.SURGEON));
  it('ASSOCIATED_DOCTOR -> Role.ASSOCIATE', () =>
    expect(dbRoleToAppRole('ASSOCIATED_DOCTOR')).toBe(Role.ASSOCIATE));
  it('SUPPORT -> Role.SUPPORT', () => expect(dbRoleToAppRole('SUPPORT')).toBe(Role.SUPPORT));
  it('TEAM_MANAGER -> Role.MANAGER', () => expect(dbRoleToAppRole('TEAM_MANAGER')).toBe(Role.MANAGER));
});

describe('APP_ROLE_LABEL_PT', () => {
  it('tem um rótulo PT-BR não vazio para cada valor de Role (pega role nova esquecida no de-para)', () => {
    for (const role of Object.values(Role)) {
      expect(APP_ROLE_LABEL_PT[role]).toBeDefined();
      expect(typeof APP_ROLE_LABEL_PT[role]).toBe('string');
      expect(APP_ROLE_LABEL_PT[role].length).toBeGreaterThan(0);
    }
  });
});

describe('dbRoleLabelPt', () => {
  it('converte direto do papel do banco para o rótulo PT-BR', () => {
    expect(dbRoleLabelPt('TEAM_MANAGER')).toBe('Gerente de Equipe');
    expect(dbRoleLabelPt('MEDICAL_SURGEON')).toBe('Médico Cirurgião');
  });

  it('papel desconhecido devolve o próprio valor recebido (fallback)', () => {
    expect(dbRoleLabelPt('PAPEL_INEXISTENTE')).toBe('PAPEL_INEXISTENTE');
  });
});
