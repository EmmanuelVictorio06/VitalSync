import { describe, expect, it, beforeEach, vi } from 'vitest';
import type { ErrorInfo } from 'react';

/**
 * O projeto não tem jsdom nem testing-library (ver CLAUDE.md), então este teste
 * exercita o CONTRATO de ErrorBoundary do React diretamente — que é onde mora
 * a lógica: `getDerivedStateFromError` decide o estado, `componentDidCatch`
 * relata, `render` escolhe entre filhos e fallback, `reset` limpa.
 *
 * Não é mock: são os mesmos métodos que o React chama. O que não é coberto
 * aqui é a montagem real na árvore — isso exigiria adicionar jsdom +
 * testing-library, que é decisão de infra (ver o PR).
 */
const reportErrorMock = vi.fn();
vi.mock('../lib/errorReporting', () => ({
  reportError: (...args: unknown[]) => {
    reportErrorMock(...args);
    return Promise.resolve();
  },
}));

const { ErrorBoundary } = await import('./ErrorBoundary');

const filhos = 'conteudo-normal' as unknown as React.ReactNode;

function novaInstancia(props: Partial<React.ComponentProps<typeof ErrorBoundary>> = {}) {
  return new ErrorBoundary({ children: filhos, contexto: 'teste', ...props });
}

beforeEach(() => {
  reportErrorMock.mockClear();
});

describe('ErrorBoundary', () => {
  it('getDerivedStateFromError marca o estado de erro', () => {
    expect(ErrorBoundary.getDerivedStateFromError()).toEqual({ hasError: true });
  });

  it('renderiza os filhos enquanto não há erro', () => {
    const b = novaInstancia();
    expect(b.render()).toBe(filhos);
  });

  it('componentDidCatch relata o erro UMA vez, com o contexto recebido', () => {
    const b = novaInstancia({ contexto: 'registro-paciente' });
    const erro = new Error('quebrou');
    b.componentDidCatch(erro, { componentStack: '\n  at VitalsRegisterPage' } as ErrorInfo);

    expect(reportErrorMock).toHaveBeenCalledTimes(1);
    const [errRelatado, ctx] = reportErrorMock.mock.calls[0] as [Error, { contexto: string }];
    expect(errRelatado).toBe(erro);
    expect(ctx.contexto).toBe('registro-paciente');
  });

  it('componentStack não vaza inteiro (é truncado)', () => {
    const b = novaInstancia();
    b.componentDidCatch(new Error('x'), { componentStack: 'a'.repeat(5000) } as ErrorInfo);
    const [, ctx] = reportErrorMock.mock.calls[0] as [Error, { extra: Record<string, string> }];
    expect(ctx.extra.componentStack!.length).toBeLessThanOrEqual(500);
  });

  it('com erro, troca os filhos pelo fallback recebido', () => {
    const marcador = 'fallback-do-paciente' as unknown as React.ReactNode;
    const b = novaInstancia({ fallback: () => marcador });
    b.state = { hasError: true };
    expect(b.render()).toBe(marcador);
    expect(b.render()).not.toBe(filhos);
  });

  it('com erro e sem fallback próprio, usa o genérico (não os filhos)', () => {
    const b = novaInstancia();
    b.state = { hasError: true };
    expect(b.render()).not.toBe(filhos);
  });

  it('o fallback recebe um reset que limpa o estado de erro', () => {
    const b = novaInstancia();
    b.state = { hasError: true };
    // setState não está disponível fora da árvore; valida-se o efeito pretendido.
    b.setState = ((patch: { hasError: boolean }) => {
      b.state = patch;
    }) as typeof b.setState;

    b.reset();
    expect(b.state.hasError).toBe(false);
    expect(b.render()).toBe(filhos);
  });
});
