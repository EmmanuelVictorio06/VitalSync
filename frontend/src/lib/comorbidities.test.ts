import { describe, expect, it } from 'vitest';
import { parseComorbidities } from './comorbidities';

describe('parseComorbidities', () => {
  it('separa por vírgula', () => {
    expect(parseComorbidities('diabetes, hipertensão')).toEqual(['diabetes', 'hipertensão']);
  });

  it('separa por quebra de linha do editor (<div> e <br>)', () => {
    expect(parseComorbidities('<div>diabetes</div><div>hipertensão</div>')).toEqual([
      'diabetes',
      'hipertensão',
    ]);
    expect(parseComorbidities('diabetes<br>hipertensão')).toEqual(['diabetes', 'hipertensão']);
    expect(parseComorbidities('<p>diabetes</p><p>hipertensão</p>')).toEqual([
      'diabetes',
      'hipertensão',
    ]);
  });

  // Regressão: `textContent` sem tratar blocos grudava os itens ("diabeteshipertensão").
  it('nunca gruda itens de blocos adjacentes', () => {
    expect(parseComorbidities('<div>diabetes</div><div>hipertensão</div>')).not.toContain(
      'diabeteshipertensão',
    );
  });

  it('gera um item por <li> da lista com marcadores', () => {
    expect(parseComorbidities('<ul><li>diabetes</li><li>hipertensão</li></ul>')).toEqual([
      'diabetes',
      'hipertensão',
    ]);
  });

  it('descarta formatação inline (negrito, itálico, tamanho, alinhamento)', () => {
    expect(parseComorbidities('<b>diabetes</b>, <i>hipertensão</i>')).toEqual([
      'diabetes',
      'hipertensão',
    ]);
    expect(
      parseComorbidities('<div style="text-align: center"><font size="5">diabetes</font></div>'),
    ).toEqual(['diabetes']);
    expect(parseComorbidities('<ul><li><b>diabetes</b> tipo 2</li></ul>')).toEqual(['diabetes tipo 2']);
  });

  it('retorna lista vazia para campo vazio', () => {
    expect(parseComorbidities('')).toEqual([]);
    expect(parseComorbidities('   ')).toEqual([]);
    expect(parseComorbidities('<div><br></div>')).toEqual([]);
    expect(parseComorbidities('<ul><li></li></ul>')).toEqual([]);
    expect(parseComorbidities(',,,')).toEqual([]);
  });

  it('normaliza espaços extras e vírgulas repetidas', () => {
    expect(parseComorbidities('  diabetes  ,   hipertensão  ')).toEqual(['diabetes', 'hipertensão']);
    expect(parseComorbidities('diabetes,,hipertensão')).toEqual(['diabetes', 'hipertensão']);
    expect(parseComorbidities('diabetes   tipo   2')).toEqual(['diabetes tipo 2']);
    // NBSP inserido pelo contentEditable conta como espaço comum.
    expect(parseComorbidities(`diabetes${String.fromCharCode(160)}tipo 2`)).toEqual(['diabetes tipo 2']);
  });

  it('decodifica entidades HTML escapadas na colagem', () => {
    expect(parseComorbidities('doen&ccedil;a &amp; comorbidade')).toEqual([
      'doen&ccedil;a & comorbidade',
    ]);
    expect(parseComorbidities('&lt;sem tag&gt;')).toEqual(['<sem tag>']);
    expect(parseComorbidities('&#100;iabetes')).toEqual(['diabetes']);
  });

  it('aceita texto puro (pacientes antigos, sem HTML)', () => {
    expect(parseComorbidities('diabetes, hipertensão, obesidade')).toEqual([
      'diabetes',
      'hipertensão',
      'obesidade',
    ]);
  });
});
