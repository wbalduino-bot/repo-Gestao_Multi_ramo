
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { UnauthorizedException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Simula o Argon2 antes de importar o serviço de autenticação.
vi.mock('argon2', () => ({
  verify: vi.fn(),
}));

import * as argon2 from 'argon2';
import { AuthService } from './auth.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

// Agrupa os testes do serviço de autenticação.
describe('AuthService', () => {
  let service: AuthService;

  // Simula o Prisma e impede o acesso ao banco de dados real.
  const prismaMock = {
    empresa: {
      findUnique: vi.fn(),
    },
    usuario: {
      findUnique: vi.fn(),
    },
  };

  // Simula a geração do token JWT.
  const jwtMock = {
    signAsync: vi.fn(),
    verifyAsync: vi.fn(),
  };

  // Dados fictícios usados nos testes.
  const empresaAtiva = {
    id: 'empresa-1',
    ativo: true,
  };

  const usuarioAtivo = {
    id: 'usuario-1',
    empresaId: 'empresa-1',
    nome: 'Usuário de Teste',
    email: 'teste@exemplo.com',
    hashSenha: 'hash-ficticio',
    perfil: 'GERENTE',
    ativo: true,
  };

  beforeEach(async () => {
    vi.clearAllMocks();

    // Define os comportamentos padrão das dependências simuladas.
    prismaMock.empresa.findUnique.mockResolvedValue(empresaAtiva);
    prismaMock.usuario.findUnique.mockResolvedValue(usuarioAtivo);
    jwtMock.signAsync.mockResolvedValue('token-ficticio');
    vi.mocked(argon2.verify).mockResolvedValue(true);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: PrismaService,
          useValue: prismaMock,
        },
        {
          provide: JwtService,
          useValue: jwtMock,
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  it('deve estar definido', () => {
    expect(service).toBeDefined();
  });

  it('deve autenticar o usuário e retornar um token', async () => {
    const resultado = await service.login({
      empresaId: 'empresa-1',
      email: ' TESTE@EXEMPLO.COM ',
      senha: 'senha-de-teste',
    });

    expect(prismaMock.empresa.findUnique).toHaveBeenCalledWith({
      where: { id: 'empresa-1' },
      select: { id: true, ativo: true },
    });

    expect(prismaMock.usuario.findUnique).toHaveBeenCalledWith({
      where: {
        empresaId_email: {
          empresaId: 'empresa-1',
          email: 'teste@exemplo.com',
        },
      },
    });

    expect(argon2.verify).toHaveBeenCalledWith(
      'hash-ficticio',
      'senha-de-teste',
    );

    expect(jwtMock.signAsync).toHaveBeenCalledWith({
      sub: 'usuario-1',
      empresaId: 'empresa-1',
      perfil: 'GERENTE',
    });

    expect(resultado).toMatchObject({
      accessToken: 'token-ficticio',
      tokenType: 'Bearer',
      expiresIn: 900,
      usuario: {
        id: 'usuario-1',
        empresaId: 'empresa-1',
        perfil: 'GERENTE',
      },
    });

    // Garante que o hash da senha não seja enviado ao cliente.
    expect(resultado.usuario).not.toHaveProperty('hashSenha');
  });

  it('deve rejeitar uma empresa inexistente', async () => {
    prismaMock.empresa.findUnique.mockResolvedValue(null);

    await expect(
      service.login({
        empresaId: 'empresa-inexistente',
        email: 'teste@exemplo.com',
        senha: 'senha-de-teste',
      }),
    ).rejects.toThrow(UnauthorizedException);

    expect(prismaMock.usuario.findUnique).not.toHaveBeenCalled();
  });

  it('deve rejeitar uma empresa desativada', async () => {
    prismaMock.empresa.findUnique.mockResolvedValue({
      id: 'empresa-1',
      ativo: false,
    });

    await expect(
      service.login({
        empresaId: 'empresa-1',
        email: 'teste@exemplo.com',
        senha: 'senha-de-teste',
      }),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('deve rejeitar um usuário inexistente', async () => {
    prismaMock.usuario.findUnique.mockResolvedValue(null);

    await expect(
      service.login({
        empresaId: 'empresa-1',
        email: 'naoexiste@exemplo.com',
        senha: 'senha-de-teste',
      }),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('deve rejeitar um usuário desativado', async () => {
    prismaMock.usuario.findUnique.mockResolvedValue({
      ...usuarioAtivo,
      ativo: false,
    });

    await expect(
      service.login({
        empresaId: 'empresa-1',
        email: 'teste@exemplo.com',
        senha: 'senha-de-teste',
      }),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('deve rejeitar uma senha incorreta', async () => {
    vi.mocked(argon2.verify).mockResolvedValue(false);

    await expect(
      service.login({
        empresaId: 'empresa-1',
        email: 'teste@exemplo.com',
        senha: 'senha-incorreta',
      }),
    ).rejects.toThrow(UnauthorizedException);

    expect(jwtMock.signAsync).not.toHaveBeenCalled();
  });
});
