import { onlyDigits } from '@vitalsync/shared';
import type { AuthenticatedUser, MedicalTeam } from '../domain/entities.js';
import { ConflictError, NotFoundError, ValidationError } from '../domain/errors.js';
import type { NewTeamMemberInput, TeamRepository, UserRepository } from '../domain/repositories.js';
import { AccessControl } from './auth.js';
import type { AuditLogger, PasswordHasher } from './ports.js';

interface MemberInput {
  name: string;
  email: string;
  password: string;
  whatsapp?: string | null;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export class CreateTeamUseCase {
  constructor(
    private readonly teams: TeamRepository,
    private readonly users: UserRepository,
    private readonly hasher: PasswordHasher,
    private readonly audit: AuditLogger,
  ) {}

  async execute(
    actor: AuthenticatedUser,
    input: { number: number; surgeon: MemberInput; associates: MemberInput[] },
  ): Promise<MedicalTeam> {
    AccessControl.assertCanManageTeams(actor);

    if (!Number.isInteger(input.number) || input.number <= 0) {
      throw new ValidationError('Informe um número de equipe válido.');
    }
    if (await this.teams.findByNumber(input.number)) {
      throw new ConflictError(`Já existe uma equipe com o número ${input.number}.`);
    }

    const all = [input.surgeon, ...input.associates];
    await this.assertUniqueEmails(all);

    const surgeon = await this.toMember(input.surgeon);
    const associates = await Promise.all(input.associates.map((m) => this.toMember(m)));

    const team = await this.teams.createWithMembers({ number: input.number, surgeon, associates });

    await this.audit.log({
      userId: actor.id,
      action: 'TEAM_CREATE',
      entityType: 'MedicalTeam',
      entityId: team.id,
      metadata: { number: input.number, associates: associates.length },
    });
    return team;
  }

  private async assertUniqueEmails(members: MemberInput[]): Promise<void> {
    const emails = members.map((m) => normalizeEmail(m.email));
    const dupInBody = emails.find((e, i) => emails.indexOf(e) !== i);
    if (dupInBody) throw new ConflictError(`O e-mail ${dupInBody} está repetido no formulário.`);
    for (const email of emails) {
      if (await this.users.existsByEmail(email)) {
        throw new ConflictError(`O e-mail ${email} já está cadastrado.`);
      }
    }
  }

  private async toMember(m: MemberInput): Promise<NewTeamMemberInput> {
    if (!m.name?.trim()) throw new ValidationError('Informe o nome do médico.');
    if (!m.password || m.password.length < 6) {
      throw new ValidationError('A senha do médico deve ter ao menos 6 caracteres.');
    }
    return {
      name: m.name.trim(),
      email: normalizeEmail(m.email),
      passwordHash: await this.hasher.hash(m.password),
      whatsapp: m.whatsapp ? onlyDigits(m.whatsapp) : null,
    };
  }
}

export class ListTeamsUseCase {
  constructor(private readonly teams: TeamRepository) {}

  async execute(actor: AuthenticatedUser): Promise<MedicalTeam[]> {
    AccessControl.assertCanManageTeams(actor);
    const all = await this.teams.list();
    // Cirurgião só enxerga a própria equipe.
    return actor.role === 'ADM' ? all : all.filter((t) => t.id === actor.teamId);
  }
}

export class UpdateTeamUseCase {
  constructor(
    private readonly teams: TeamRepository,
    private readonly users: UserRepository,
    private readonly hasher: PasswordHasher,
    private readonly audit: AuditLogger,
  ) {}

  /** Atualiza número da equipe e/ou adiciona/remove/edita associados. */
  async execute(
    actor: AuthenticatedUser,
    teamId: string,
    changes: {
      number?: number;
      addAssociates?: MemberInput[];
      removeMemberIds?: string[];
      updateMembers?: Array<{ id: string; name?: string; whatsapp?: string | null; password?: string }>;
    },
  ): Promise<MedicalTeam> {
    AccessControl.assertCanManageTeam(actor, teamId);
    const team = await this.teams.findById(teamId);
    if (!team) throw new NotFoundError('Equipe não encontrada.');

    if (changes.number != null && changes.number !== team.number) {
      const existing = await this.teams.findByNumber(changes.number);
      if (existing && existing.id !== teamId) {
        throw new ConflictError(`Já existe uma equipe com o número ${changes.number}.`);
      }
      await this.teams.updateNumber(teamId, changes.number);
    }

    for (const m of changes.addAssociates ?? []) {
      if (await this.users.existsByEmail(normalizeEmail(m.email))) {
        throw new ConflictError(`O e-mail ${m.email} já está cadastrado.`);
      }
      await this.teams.addAssociate(teamId, {
        name: m.name.trim(),
        email: normalizeEmail(m.email),
        passwordHash: await this.hasher.hash(m.password),
        whatsapp: m.whatsapp ? onlyDigits(m.whatsapp) : null,
      });
    }

    for (const m of changes.updateMembers ?? []) {
      await this.teams.updateMember(m.id, {
        name: m.name?.trim(),
        whatsapp: m.whatsapp != null ? onlyDigits(m.whatsapp) : undefined,
        passwordHash: m.password ? await this.hasher.hash(m.password) : undefined,
      });
    }

    for (const id of changes.removeMemberIds ?? []) {
      if (id === team.surgeonId) {
        throw new ValidationError('Não é possível remover o cirurgião principal da equipe.');
      }
      await this.teams.removeMember(teamId, id);
    }

    await this.audit.log({
      userId: actor.id,
      action: 'TEAM_UPDATE',
      entityType: 'MedicalTeam',
      entityId: teamId,
      metadata: changes as Record<string, unknown>,
    });

    return (await this.teams.findById(teamId))!;
  }
}

export class DeleteTeamUseCase {
  constructor(
    private readonly teams: TeamRepository,
    private readonly audit: AuditLogger,
  ) {}

  async execute(actor: AuthenticatedUser, teamId: string): Promise<void> {
    AccessControl.assertCanManageTeam(actor, teamId);
    const team = await this.teams.findById(teamId);
    if (!team) throw new NotFoundError('Equipe não encontrada.');

    const patients = await this.teams.countPatients(teamId);
    if (patients > 0) {
      throw new ConflictError(
        `Esta equipe possui ${patients} paciente(s) em monitoramento. Transfira ou finalize os pacientes antes de excluir.`,
      );
    }
    await this.teams.delete(teamId);
    await this.audit.log({
      userId: actor.id,
      action: 'TEAM_DELETE',
      entityType: 'MedicalTeam',
      entityId: teamId,
      metadata: { number: team.number },
    });
  }
}
