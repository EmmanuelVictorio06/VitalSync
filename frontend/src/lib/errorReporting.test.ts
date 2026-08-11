import { describe, expect, it, beforeEach, vi } from 'vitest';

/**
 * `errorReporting` importa `lib/supabase`, que valida env vars reais e aborta
 * fora do navegador. O mock isola a redação (o que importa aqui) da infra.
 */
const inserted: Array<Record<string, unknown>> = [];
let insertDeveFalhar = false;

vi.mock('./supabase', () => ({
  supabase: {
    auth: { getUser: async () => ({ data: { user: null } }) },
    from: () => ({
      insert: async (row: Record<string, unknown>) => {
        if (insertDeveFalhar) throw new Error('falha de rede simulada');
        inserted.push(row);
        return { error: null };
      },
    }),
  },
}));

const { redigir, padraoDaRota, reportError, _limparDedup } = await import('./errorReporting');

beforeEach(() => {
  inserted.length = 0;
  insertDeveFalhar = false;
  _limparDedup();
});

describe('redigir — nada sensível pode sobreviver', () => {
  it('remove o secure_token do paciente (48 chars) de um stack', () => {
    const token = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4';
    const stack = `Error: falhou\n  at /registro-sinais/${token}:12:3`;
    const out = redigir(stack)!;
    expect(out).not.toContain(token);
    expect(out).toContain('[REDIGIDO]');
  });

  it('remove token de exatamente 20 caracteres (fronteira da regra)', () => {
    const token = 'abcdefghij1234567890';
    expect(token).toHaveLength(20);
    expect(redigir(`token=${token}`)).not.toContain(token);
  });

  it('remove CPF com e sem máscara', () => {
    expect(redigir('cpf 123.456.789-09 invalido')).not.toContain('123.456.789-09');
    expect(redigir('cpf 12345678909 invalido')).not.toContain('12345678909');
  });

  it('remove e-mail', () => {
    expect(redigir('falha para joao.silva@hospital.com.br')).not.toContain('joao.silva@hospital.com.br');
  });

  it('remove telefone com e sem DDI/máscara', () => {
    expect(redigir('ligar (41) 99876-5432')).not.toContain('99876-5432');
    expect(redigir('ligar +55 41 998765432')).not.toContain('998765432');
  });

  it('preserva o texto útil para diagnóstico', () => {
    expect(redigir('TypeError: Cannot read properties of undefined')).toContain('TypeError');
  });

  it('null/undefined não quebram', () => {
    expect(redigir(null)).toBeNull();
    expect(redigir(undefined)).toBeNull();
  });
});

describe('padraoDaRota — nunca devolve a URL real do paciente', () => {
  it('troca o token pelo padrão da rota', () => {
    const p = padraoDaRota('/registro-sinais/a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6');
    expect(p).toBe('/registro-sinais/:token');
  });

  it('cobre o alias curto /r/:token', () => {
    expect(padraoDaRota('/r/a1b2c3d4e5f6a7b8c9d0e1f2')).toBe('/r/:token');
  });

  it('troca o id do paciente nas rotas internas', () => {
    expect(padraoDaRota('/patients/123e4567-e89b-12d3-a456-426614174000')).toBe('/patients/:id');
  });

  it('rota sem parâmetro passa direto', () => {
    expect(padraoDaRota('/dashboard')).toBe('/dashboard');
  });
});

describe('reportError', () => {
  it('grava a mensagem e o stack já redigidos', async () => {
    const token = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6';
    const err = new Error(`falhou com token ${token} e cpf 123.456.789-09`);
    await reportError(err, { contexto: 'registro-paciente' });

    expect(inserted).toHaveLength(1);
    const row = inserted[0]!;
    expect(String(row.message)).not.toContain(token);
    expect(String(row.message)).not.toContain('123.456.789-09');
    expect(row.contexto).toBe('registro-paciente');
  });

  it('NÃO lança quando a gravação falha (senão vira loop dentro do boundary)', async () => {
    insertDeveFalhar = true;
    await expect(reportError(new Error('qualquer'), { contexto: 'app' })).resolves.toBeUndefined();
    expect(inserted).toHaveLength(0);
  });

  it('deduplica o mesmo erro dentro de 60s', async () => {
    await reportError(new Error('mesmo erro'), { contexto: 'app' });
    await reportError(new Error('mesmo erro'), { contexto: 'app' });
    await reportError(new Error('mesmo erro'), { contexto: 'app' });
    expect(inserted).toHaveLength(1);
  });

  it('erros diferentes não são deduplicados entre si', async () => {
    await reportError(new Error('erro A'), { contexto: 'app' });
    await reportError(new Error('erro B'), { contexto: 'app' });
    expect(inserted).toHaveLength(2);
  });

  it('mesmo texto em contextos diferentes conta como erros distintos', async () => {
    await reportError(new Error('igual'), { contexto: 'app' });
    await reportError(new Error('igual'), { contexto: 'registro-paciente' });
    expect(inserted).toHaveLength(2);
  });

  it('aceita valor que não é Error sem quebrar', async () => {
    await reportError('string solta', { contexto: 'app' });
    expect(inserted).toHaveLength(1);
  });
});
