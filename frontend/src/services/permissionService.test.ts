import { describe, it, expect } from 'vitest';
import { Role } from '@vitalsync/shared';
import type { AuthUser } from '../lib/dto';
import { permissionService } from './permissionService';

function userWithRole(role: Role): AuthUser {
  return { id: 'u1', name: 'Fulano', role, teamId: null, avatarUrl: null, professionalTag: null };
}

describe('permissionService.canEditPatient', () => {
  it('Admin pode editar paciente', () => {
    expect(permissionService.canEditPatient(userWithRole(Role.ADM))).toBe(true);
  });

  it('Gerente de Equipe pode editar paciente (a Edge Function revalida o vínculo com o cirurgião)', () => {
    expect(permissionService.canEditPatient(userWithRole(Role.MANAGER))).toBe(true);
  });

  it('Cirurgião, Associado, Suporte e Enfermagem não podem editar paciente por essa flag', () => {
    expect(permissionService.canEditPatient(userWithRole(Role.SURGEON))).toBe(false);
    expect(permissionService.canEditPatient(userWithRole(Role.ASSOCIATE))).toBe(false);
    expect(permissionService.canEditPatient(userWithRole(Role.SUPPORT))).toBe(false);
    expect(permissionService.canEditPatient(userWithRole(Role.NURSE))).toBe(false);
  });

  it('sem usuário autenticado, nunca pode editar', () => {
    expect(permissionService.canEditPatient(null)).toBe(false);
    expect(permissionService.canEditPatient(undefined)).toBe(false);
  });
});
