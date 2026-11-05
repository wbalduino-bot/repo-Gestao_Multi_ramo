import {
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';

import { describe, expect, it } from 'vitest';

import { GerenciaGuard } from './gerencia.guard.js';

/**
 * Simula uma requisição que já passou pela autenticação JWT.
 * O teste não acessa o banco nem precisa de um token real.
 */
function criarContexto(perfil?: string): ExecutionContext {
  const requisicao = {
    user: perfil
      ? {
          sub: 'usuario-teste',
          empresaId: 'empresa-teste',
          perfil,
        }
      : undefined,
  };

  return {
    switchToHttp: () => ({
      getRequest: () => requisicao,
    }),
  } as unknown as ExecutionContext;
}

describe('GerenciaGuard', () => {
  const guard = new GerenciaGuard();

  it('deve permitir ADMINISTRADOR', () => {
    expect(
      guard.canActivate(criarContexto('ADMINISTRADOR')),
    ).toBe(true);
  });

  it('deve permitir GERENTE', () => {
    expect(
      guard.canActivate(criarContexto('GERENTE')),
    ).toBe(true);
  });

  it.each(['CAIXA', 'ATENDENTE', 'GARCOM'])(
    'deve bloquear o perfil %s',
    (perfil) => {
      expect(() =>
        guard.canActivate(criarContexto(perfil)),
      ).toThrow(ForbiddenException);
    },
  );

  it('deve bloquear uma requisição sem usuário autenticado', () => {
    expect(() =>
      guard.canActivate(criarContexto()),
    ).toThrow(ForbiddenException);
  });
});
