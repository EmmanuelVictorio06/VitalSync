import bcrypt from 'bcryptjs';
import { createHash, randomBytes } from 'node:crypto';
import jwt from 'jsonwebtoken';
import type { AuthenticatedUser } from '../../domain/entities.js';
import { UnauthorizedError } from '../../domain/errors.js';
import type { LinkTokenService, PasswordHasher, TokenService } from '../../application/ports.js';

/** Hash de senha com bcrypt (custo 10). Protege as senhas em repouso. */
export class BcryptPasswordHasher implements PasswordHasher {
  constructor(private readonly rounds = 10) {}
  hash(plain: string): Promise<string> {
    return bcrypt.hash(plain, this.rounds);
  }
  compare(plain: string, hash: string): Promise<boolean> {
    return bcrypt.compare(plain, hash);
  }
}

/** Emissão/validação de JWT para a sessão dos profissionais. */
export class JwtTokenService implements TokenService {
  constructor(
    private readonly secret: string,
    private readonly expiresIn: string,
  ) {}

  sign(payload: AuthenticatedUser): string {
    return jwt.sign(payload, this.secret, { expiresIn: this.expiresIn } as jwt.SignOptions);
  }

  verify(token: string): AuthenticatedUser {
    try {
      const decoded = jwt.verify(token, this.secret) as jwt.JwtPayload;
      return {
        id: String(decoded.id),
        role: decoded.role,
        teamId: decoded.teamId ?? null,
        name: String(decoded.name ?? ''),
      };
    } catch {
      throw new UnauthorizedError('Sessão inválida ou expirada. Faça login novamente.');
    }
  }
}

/**
 * Token do link do paciente: aleatório forte (256 bits) e armazenado apenas
 * como hash SHA-256. O valor cru existe somente na URL enviada por WhatsApp,
 * nunca persistido — mesmo um vazamento do banco não revela links válidos.
 */
export class CryptoLinkTokenService implements LinkTokenService {
  generate(): { raw: string; hash: string } {
    const raw = randomBytes(32).toString('base64url');
    return { raw, hash: this.hash(raw) };
  }
  hash(raw: string): string {
    return createHash('sha256').update(raw).digest('hex');
  }
}
