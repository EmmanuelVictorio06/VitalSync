/**
 * Contrato SQL ↔ TypeScript do vocabulário de `clinical_alerts.type`.
 *
 * Este é o único teste do frontend que lê arquivo do repositório, e é de
 * propósito: TODA a família de bugs da aba Alertas (valor que disparou vazio,
 * regra clínica genérica, filtro "Pressão" sem resultado) nasceu da mesma
 * causa — uma lista escrita à mão no TS que parou de acompanhar o `vtype` de
 * `eval_clinical_status`. Um teste de lógica pura não pega isso, porque os dois
 * lados estavam internamente consistentes; o que quebrou foi a relação entre
 * eles.
 *
 * Ele lê a migration VIVA (a de maior número que define a função) e compara o
 * `case` do `vtype` com `ALERT_TYPE_OPTIONS`. Ao acrescentar uma métrica no
 * SQL, este teste falha até o TS ser atualizado — que é exatamente o lembrete
 * que faltava.
 *
 * Se a formatação do `case` mudar a ponto de o parser não achar o bloco, o
 * teste falha alto em vez de passar vazio: ver a asserção de sanidade.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ALERT_TYPE_OPTIONS } from './alertTrigger';

/** <raiz>/supabase/migrations — este arquivo está em <raiz>/frontend/src/lib/. */
const MIGRATIONS_DIR = fileURLToPath(new URL('../../../supabase/migrations/', import.meta.url));

/** Migration viva de uma função: a de maior número que a define (CLAUDE.md). */
function migrationViva(nomeDaFuncao: string): { arquivo: string; sql: string } {
  const arquivos = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  // Exige a DEFINIÇÃO (`create [or replace] function`): só citar o nome não
  // conta. A 0081 apenas comenta a função (`comment on function public.
  // eval_clinical_status`) e chegou a ser eleita como viva por um regex que
  // casava qualquer `function public.<nome>`, quebrando o parser do `vtype`.
  const encontrados = arquivos.filter((f) =>
    new RegExp(`create\\s+(or\\s+replace\\s+)?function\\s+public\\.${nomeDaFuncao}\\b`).test(
      readFileSync(MIGRATIONS_DIR + f, 'utf8'),
    ),
  );
  const arquivo = encontrados[encontrados.length - 1];
  if (!arquivo) throw new Error(`Nenhuma migration define public.${nomeDaFuncao}`);
  return { arquivo, sql: readFileSync(MIGRATIONS_DIR + arquivo, 'utf8') };
}

describe('contrato: vtype da RPC x ALERT_TYPE_OPTIONS', () => {
  const { arquivo, sql } = migrationViva('eval_clinical_status');
  const bloco = sql.match(/vtype\s*:=\s*case([\s\S]*?)end\s*;/);

  it(`acha o case do vtype na migration viva (${arquivo})`, () => {
    // Sanidade do parser: sem isto, uma mudança de formatação faria os testes
    // abaixo compararem listas vazias e passarem sem verificar nada.
    expect(bloco, 'o parser não achou o bloco `vtype := case ... end;`').not.toBeNull();
    expect(bloco![1].length).toBeGreaterThan(100);
  });

  it('cada tipo que o banco grava tem opção de filtro no TS', () => {
    const doBanco = [...bloco![1].matchAll(/then\s+'([^']+)'/g)].map((m) => m[1]);
    expect(doBanco.length).toBeGreaterThan(0);
    // Mesma ordem de propósito: `ALERT_TYPE_OPTIONS` espelha a ordem de decisão
    // da RPC, e manter isso alinhado facilita conferir os dois lado a lado.
    expect(doBanco).toEqual([...ALERT_TYPE_OPTIONS]);
  });

  it('o fallback GREEN do banco fica fora das opções de filtro', () => {
    const fallback = [...bloco![1].matchAll(/else\s+'([^']+)'/g)].map((m) => m[1]);
    expect(fallback).toContain('Sinais vitais');
    for (const t of fallback) {
      expect(ALERT_TYPE_OPTIONS, `fallback virou opção de filtro: ${t}`).not.toContain(t);
    }
  });
});
