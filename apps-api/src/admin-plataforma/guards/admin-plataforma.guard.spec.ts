
import {
  ForbiddenException,
  UnauthorizedException,
  type ExecutionContext,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AdminPlataformaGuard } from './admin-plataforma.guard.js';

/**
 * Testes unitários do guard administrativo.
 *
 * Os mocks substituem JWT e Prisma para testar as regras de
 * autorização sem acessar o banco de dados real.
 */
describe('AdminPlataformaGuard', () => {
  const jwtServiceMock = {
    verifyAsync: vi.fn(),
  };

  const prismaMock = {
    administradorPlataforma: {
      findUnique: vi.fn(),
    },
  };

  let guard: AdminPlataformaGuard;

  // Representa a requisição HTTP simulada durante os testes.
  let requisicao: {
    headers: { authorization?: string };
    user?: { sub: string; tipo: 'ADMIN_PLATAFORMA' };
  };

  // Monta um contexto HTTP simples para executar o guard.
  function criarContexto(): ExecutionContext {
    return {
      switchToHttp: () => ({
        getRequest: () => requisicao,
      }),
    } as unknown as ExecutionContext;
  }

  beforeEach(() => {
    // Limpa chamadas e implementações anteriores dos mocks.
    vi.resetAllMocks();

    requisicao = {
      headers: {},
    };

    guard = new AdminPlataformaGuard(
      jwtServiceMock as unknown as JwtService,
      prismaMock as unknown as PrismaService,
    );
  });

  it('deve rejeitar uma requisição sem token', async () => {
    await expect(
      guard.canActivate(criarContexto()),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    expect(jwtServiceMock.verifyAsync).not.toHaveBeenCalled();
    expect(
      prismaMock.administradorPlataforma.findUnique,
    ).not.toHaveBeenCalled();
  });

  it('deve rejeitar um cabeçalho Authorization fora do formato Bearer', async () => {
    requisicao.headers.authorization = 'Basic token-invalido';

    await expect(
      guard.canActivate(criarContexto()),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    expect(jwtServiceMock.verifyAsync).not.toHaveBeenCalled();
  });

  it('deve rejeitar um token inválido ou expirado', async () => {
    requisicao.headers.authorization = 'Bearer token-invalido';
    jwtServiceMock.verifyAsync.mockRejectedValue(new Error('Token inválido'));

    await expect(
      guard.canActivate(criarContexto()),
    ).rejects.toThrow('Token inválido ou expirado.');

    expect(
      prismaMock.administradorPlataforma.findUnique,
    ).not.toHaveBeenCalled();
  });

  it.each([
    null,
    [],
    {},
    { sub: 123, tipo: 'ADMIN_PLATAFORMA' },
    { sub: 'admin-1' },
    { sub: 'admin-1', tipo: 'USUARIO_EMPRESA' },
  ])('deve rejeitar um payload que não identifica um administrador válido', async (payload) => {
    requisicao.headers.authorization = 'Bearer token-valido';
    jwtServiceMock.verifyAsync.mockResolvedValue(payload);

    await expect(
      guard.canActivate(criarContexto()),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(
      prismaMock.administradorPlataforma.findUnique,
    ).not.toHaveBeenCalled();
  });

  it('deve rejeitar o acesso quando o administrador não existe', async () => {
    requisicao.headers.authorization = 'Bearer token-valido';

    jwtServiceMock.verifyAsync.mockResolvedValue({
      sub: 'admin-1',
      tipo: 'ADMIN_PLATAFORMA',
    });

    prismaMock.administradorPlataforma.findUnique.mockResolvedValue(null);

    await expect(
      guard.canActivate(criarContexto()),
    ).rejects.toThrow('Administrador inexistente ou inativo.');

    expect(
      prismaMock.administradorPlataforma.findUnique,
    ).toHaveBeenCalledWith({
      where: { id: 'admin-1' },
      select: { id: true, ativo: true },
    });
  });

  it('deve rejeitar o acesso quando o administrador está inativo', async () => {
    requisicao.headers.authorization = 'Bearer token-valido';

    jwtServiceMock.verifyAsync.mockResolvedValue({
      sub: 'admin-1',
      tipo: 'ADMIN_PLATAFORMA',
    });

    prismaMock.administradorPlataforma.findUnique.mockResolvedValue({
      id: 'admin-1',
      ativo: false,
    });

    await expect(
      guard.canActivate(criarContexto()),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('deve autorizar um administrador ativo e preencher a identidade da requisição', async () => {
    requisicao.headers.authorization = 'Bearer token-valido';

    jwtServiceMock.verifyAsync.mockResolvedValue({
      sub: 'admin-1',
      tipo: 'ADMIN_PLATAFORMA',
    });

    prismaMock.administradorPlataforma.findUnique.mockResolvedValue({
      id: 'admin-1',
      ativo: true,
    });

    await expect(
      guard.canActivate(criarContexto()),
    ).resolves.toBe(true);

    expect(requisicao.user).toEqual({
      sub: 'admin-1',
      tipo: 'ADMIN_PLATAFORMA',
    });
  });
});
