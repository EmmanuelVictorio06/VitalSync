import { describe, it, expect } from 'vitest';
import { lerTemaSalvo, resolverTemaEfetivo, themeColorPara } from './theme';

describe('lerTemaSalvo', () => {
  it('aceita os três valores válidos', () => {
    expect(lerTemaSalvo('claro')).toBe('claro');
    expect(lerTemaSalvo('escuro')).toBe('escuro');
    expect(lerTemaSalvo('sistema')).toBe('sistema');
  });

  it('cai em "sistema" quando não há valor salvo (primeiro acesso)', () => {
    expect(lerTemaSalvo(null)).toBe('sistema');
  });

  it('cai em "sistema" para lixo/valor corrompido no localStorage', () => {
    expect(lerTemaSalvo('')).toBe('sistema');
    expect(lerTemaSalvo('dark')).toBe('sistema');
    expect(lerTemaSalvo('{"tema":"escuro"}')).toBe('sistema');
  });
});

describe('resolverTemaEfetivo', () => {
  it('escolha explícita "claro" ignora a preferência do SO', () => {
    expect(resolverTemaEfetivo('claro', true)).toBe('claro');
    expect(resolverTemaEfetivo('claro', false)).toBe('claro');
  });

  it('escolha explícita "escuro" ignora a preferência do SO', () => {
    expect(resolverTemaEfetivo('escuro', true)).toBe('escuro');
    expect(resolverTemaEfetivo('escuro', false)).toBe('escuro');
  });

  it('"sistema" acompanha a preferência do SO', () => {
    expect(resolverTemaEfetivo('sistema', true)).toBe('escuro');
    expect(resolverTemaEfetivo('sistema', false)).toBe('claro');
  });
});

describe('themeColorPara', () => {
  it('retorna uma cor diferente para cada tema efetivo', () => {
    expect(themeColorPara('claro')).not.toBe(themeColorPara('escuro'));
  });
});
