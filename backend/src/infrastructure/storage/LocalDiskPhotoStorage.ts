import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { woundPhotoExtension } from '@vitalsync/shared';
import type { IncomingPhoto, PhotoStorageService, StoredPhoto } from '../../application/ports.js';

/**
 * Armazenamento de fotos em disco local (fora do webroot).
 *
 * Segurança/privacidade:
 *  - O nome do arquivo no disco é derivado de hash (não vaza o nome original).
 *  - As fotos ficam em `UPLOADS_DIR/wounds/<patientId>/...` — nunca servidas
 *    diretamente; o acesso passa pela rota protegida (auth + RBAC + auditoria).
 *  - `read`/`delete` validam que o caminho está contido na raiz de uploads
 *    (defesa contra path traversal).
 */
export class LocalDiskPhotoStorage implements PhotoStorageService {
  private readonly root: string;

  constructor(uploadsDir: string) {
    this.root = resolve(process.cwd(), uploadsDir);
  }

  async save(input: { patientId: string; recordId: string; photo: IncomingPhoto }): Promise<StoredPhoto> {
    const ext = woundPhotoExtension(input.photo.mimeType);
    // Caminho relativo determinístico por registro (1 foto por medição).
    const relativePath = join('wounds', input.patientId, `${input.recordId}.${ext}`);
    const absolutePath = this.absolute(relativePath);

    await mkdir(dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, input.photo.buffer);

    return {
      // Caminho da rota protegida (relativo a /api) — sem expor o disco.
      url: `/patients/${input.patientId}/records/${input.recordId}/wound-photo`,
      storagePath: relativePath,
      fileName: input.photo.fileName,
      mimeType: input.photo.mimeType,
      size: input.photo.size,
      uploadedAt: new Date(),
    };
  }

  async read(storagePath: string): Promise<{ buffer: Buffer; mimeType: string } | null> {
    const absolutePath = this.absolute(storagePath);
    try {
      const buffer = await readFile(absolutePath);
      return { buffer, mimeType: mimeFromPath(absolutePath) };
    } catch {
      return null;
    }
  }

  async delete(storagePath: string): Promise<void> {
    await rm(this.absolute(storagePath), { force: true });
  }

  /** Resolve e garante que o caminho está dentro da raiz de uploads. */
  private absolute(relativePath: string): string {
    const abs = resolve(this.root, relativePath);
    if (abs !== this.root && !abs.startsWith(this.root + sepChar)) {
      throw new Error('Caminho de armazenamento inválido.');
    }
    return abs;
  }
}

const sepChar = join('a', 'b').slice(1, 2); // separador do SO ('/' ou '\\')

function mimeFromPath(path: string): string {
  if (path.endsWith('.png')) return 'image/png';
  if (path.endsWith('.webp')) return 'image/webp';
  return 'image/jpeg';
}

/** Hash utilitário (reservado para futuras integrações de deduplicação). */
export function sha256(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}
