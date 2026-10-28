
import { Test, TestingModule } from '@nestjs/testing';
import {
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { JwtAuthGuard } from './jwt.strategy.js';
import { PrismaService } from '../../prisma/prisma.service.js';

// Testa a validação do token e a situação atual do usuário no banco.
describe('JwtAuthGuard', () => {
  let guard: JwtAuthGuard;

  // Simula a validação do token JWT, sem utilizar um token real.
  const jwtMock = {
    verifyAsync: vi.fn(),
  };

  // Simula a consulta ao banco de dados, evitando acesso ao PostgreSQL.
  const prismaMock = {
    usuario: {
      findFirst: vi.fn(),
    },
  };

  // Payload padrão de um token válido da empresa 1.
  const payloadValido = {
    sub: 'usuario-1',
    empresaId: 'empresa-1',
    perfil: 'GERENTE',
  };

  // Registro fictício de um usuário ativo no banco de dados.
  const usuarioAtivo = {
    id: 'usuario-1',
    empresaId: 'empresa-1',
    perfil: 'GERENTE',
  };

  // Simula uma requisição HTTP com o cabeçalho de autenticação.
  function criarContexto(authorization?: string): ExecutionContext {
    const request: Record<string, unknown> = {
      headers: authorization ? { authorization } : {},
    };

    return {
      switchToHttp: () => ({
        getRequest: () => request,
      }),
    } as unknown as ExecutionContext;
  }

  beforeEach(async () => {
    // Limpa o histórico de chamadas dos mocks antes de cada teste.
    vi.clearAllMocks();

    // Define os comportamentos padrão das dependências simuladas.
    jwtMock.verifyAsync.mockResolvedValue(payloadValido);
    prismaMock.usuario.findFirst.mockResolvedValue(usuarioAtivo);

    // Monta o módulo de teste com as dependências simuladas.
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JwtAuthGuard,
        {
          provide: JwtService,
          useValue: jwtMock,
        },
        {
          provide: PrismaService,
          useValue: prismaMock,
        },
      ],
    }).compile();

    guard = module.get<JwtAuthGuard>(JwtAuthGuard);
  });

  it('deve estar definido', () => {
    expect(guard).toBeDefined();
  });

  it('deve rejeitar uma requisição sem token', async () => {
    await expect(
      guard.canActivate(criarContexto()),
    ).rejects.toThrow(UnauthorizedException);

    // Sem token, a validação JWT não deve ser executada.
    expect(jwtMock.verifyAsync).not.toHaveBeenCalled();
  });

  it('deve rejeitar um cabeçalho Bearer vazio', async () => {
    await expect(
      guard.canActivate(criarContexto('Bearer   ')),
    ).rejects.toThrow(UnauthorizedException);

    // Um token vazio não deve chegar ao serviço JWT.
    expect(jwtMock.verifyAsync).not.toHaveBeenCalled();
  });

  it('deve aceitar token válido e anexar a identidade confirmada pelo banco', async () => {
    const contexto = criarContexto('Bearer token-valido');

    await expect(
      guard.canActivate(contexto),
    ).resolves.toBe(true);

    // Confirma que o guard encaminhou o token para validação.
    expect(jwtMock.verifyAsync).toHaveBeenCalledWith(
      'token-valido',
    );

    // Confirma que a consulta considera a identidade e a empresa do token.
    expect(prismaMock.usuario.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'usuario-1',
        empresaId: 'empresa-1',
        ativo: true,
        empresa: {
          is: {
            ativo: true,
          },
        },
      },
      select: {
        id: true,
        empresaId: true,
        perfil: true,
      },
    });

    // Confirma que a requisição recebe a identidade validada pelo banco.
    expect(
      contexto.switchToHttp().getRequest().user,
    ).toEqual(payloadValido);
  });

  it('deve rejeitar token inválido ou expirado', async () => {
    jwtMock.verifyAsync.mockRejectedValue(
      new Error('Token expirado'),
    );

    await expect(
      guard.canActivate(
        criarContexto('Bearer token-expirado'),
      ),
    ).rejects.toThrow('Token inválido ou expirado.');

    // Um token inválido não deve provocar consulta ao usuário.
    expect(prismaMock.usuario.findFirst).not.toHaveBeenCalled();
  });

  it('deve rejeitar token sem os campos obrigatórios', async () => {
    jwtMock.verifyAsync.mockResolvedValue({
      sub: 'usuario-1',
      empresaId: 'empresa-1',
    });

    await expect(
      guard.canActivate(
        criarContexto('Bearer token-incompleto'),
      ),
    ).rejects.toThrow(UnauthorizedException);

    // Payload incompleto deve ser rejeitado antes da consulta ao banco.
    expect(prismaMock.usuario.findFirst).not.toHaveBeenCalled();
  });

  it('deve rejeitar usuário ou empresa inativa ou inexistente', async () => {
    // Simula que não existe associação válida para a consulta realizada.
    prismaMock.usuario.findFirst.mockResolvedValue(null);

    await expect(
      guard.canActivate(
        criarContexto('Bearer token-valido'),
      ),
    ).rejects.toThrow(
      'Usuário ou empresa inativa ou não encontrada.',
    );
  });

  it('deve rejeitar token quando o perfil mudou no banco', async () => {
    // O perfil atual no banco é diferente do perfil presente no token.
    prismaMock.usuario.findFirst.mockResolvedValue({
      ...usuarioAtivo,
      perfil: 'CAIXA',
    });

    await expect(
      guard.canActivate(
        criarContexto('Bearer token-valido'),
      ),
    ).rejects.toThrow(
      'Perfil alterado. Faça login novamente.',
    );
  });

  it('deve restringir a consulta de autorização à empresa informada no token', async () => {
    /**
     * Simula um token cujo empresaId identifica a empresa 2.
     * A autorização precisa consultar a associação do usuário
     * dentro dessa empresa, sem confiar apenas no identificador.
     */
    const payloadEmpresaB = {
      ...payloadValido,
      empresaId: 'empresa-2',
    };

    jwtMock.verifyAsync.mockResolvedValue(payloadEmpresaB);

    // Simula que não existe associação ativa nessa empresa.
    prismaMock.usuario.findFirst.mockResolvedValue(null);

    await expect(
      guard.canActivate(
        criarContexto('Bearer token-empresa-b'),
      ),
    ).rejects.toThrow(
      'Usuário ou empresa inativa ou não encontrada.',
    );

    // Verifica que a consulta está vinculada à empresa 2.
    expect(prismaMock.usuario.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'usuario-1',
        empresaId: 'empresa-2',
        ativo: true,
        empresa: {
          is: {
            ativo: true,
          },
        },
      },
      select: {
        id: true,
        empresaId: true,
        perfil: true,
      },
    });
  });
});
