
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { Logger, UnauthorizedException } from '@nestjs/common';
import {
  ResultadoAuditoria,
  TipoAtorAuditoria,
} from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Simula o Argon2 antes de importar o serviço administrativo.
vi.mock('argon2', () => ({
  verify: vi.fn(),
}));

import * as argon2 from 'argon2';

import { AdminPlataformaService } from './admin-plataforma.service.js';
import { LoginAdminPlataformaDto } from './dto/login-admin-plataforma.dto.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditoriaService } from '../auditoria/auditoria.service.js';
import { AplicacaoLogger } from '../logging/logger.service.js';

/**
 * Testes do serviço de autenticação administrativa.
 *
 * As dependências são simuladas para não utilizar banco de dados
 * ou gerar tokens reais durante os testes.
 */
describe('AdminPlataformaService', () => {
  let service: AdminPlataformaService;

  // Simula a consulta do administrador no Prisma.
  const prismaMock = {
    administradorPlataforma: {
      findUnique: vi.fn(),
    },
  };

  // Simula a geração de tokens JWT.
  const jwtMock = {
    signAsync: vi.fn(),
    verifyAsync: vi.fn(),
  };

  // Simula o serviço central de auditoria.
  const auditoriaMock = {
    registrar: vi.fn(),
  };

  // Simula o registro técnico complementar de segurança.
  const aplicacaoLoggerMock = {
    registrarSeguranca: vi.fn(),
  };

  // Administrador fictício utilizado nos cenários válidos.
  const administradorAtivo = {
    id: 'administrador-1',
    nome: 'Administrador de Teste',
    email: 'admin@exemplo.com',
    hashSenha: 'hash-ficticio',
    ativo: true,
  };

  // Dados utilizados nos testes de autenticação.
  const credenciais: LoginAdminPlataformaDto = {
    email: ' ADMIN@EXEMPLO.COM ',
    senha: 'senha-de-teste',
  };

  // Evento esperado quando uma tentativa de login é recusada.
  const auditoriaFalhaEsperada = {
    tipoAtor: TipoAtorAuditoria.ANONIMO,
    modulo: 'ADMIN_PLATAFORMA',
    acao: 'LOGIN',
    resultado: ResultadoAuditoria.FALHA,
    motivo: 'Tentativa de autenticação recusada.',
  };

  beforeEach(async () => {
    // Limpa chamadas anteriores sem perder as implementações padrão.
    vi.clearAllMocks();

    // Simula administrador existente e ativo.
    prismaMock.administradorPlataforma.findUnique.mockResolvedValue(
      administradorAtivo,
    );

    // Simula a geração de um token.
    jwtMock.signAsync.mockResolvedValue('token-admin-ficticio');

    // Simula o registro de auditoria.
    auditoriaMock.registrar.mockResolvedValue({
      id: 'evento-auditoria-admin-1',
    });

    // Simula senha válida por padrão.
    vi.mocked(argon2.verify).mockResolvedValue(true);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminPlataformaService,
        {
          provide: PrismaService,
          useValue: prismaMock,
        },
        {
          provide: JwtService,
          useValue: jwtMock,
        },
        {
          provide: AuditoriaService,
          useValue: auditoriaMock,
        },
        {
          provide: AplicacaoLogger,
          useValue: aplicacaoLoggerMock,
        },
      ],
    }).compile();

    service = module.get<AdminPlataformaService>(
      AdminPlataformaService,
    );
  });

  it('deve estar definido', () => {
    expect(service).toBeDefined();
  });

  /**
   * Verifica o fluxo completo de autenticação administrativa.
   *
   * Confirma a normalização do e-mail, a verificação da senha,
   * a geração do JWT e o registro do evento de auditoria.
   */
  it('deve autenticar o administrador e registrar o login na auditoria', async () => {
    const resultado = await service.login(credenciais);

    // Confirma a consulta utilizando o e-mail normalizado.
    expect(
      prismaMock.administradorPlataforma.findUnique,
    ).toHaveBeenCalledWith({
      where: {
        email: 'admin@exemplo.com',
      },
    });

    // Confirma a validação da senha por meio do Argon2.
    expect(argon2.verify).toHaveBeenCalledWith(
      'hash-ficticio',
      'senha-de-teste',
    );

    // Confirma que o JWT contém a identidade administrativa correta.
    expect(jwtMock.signAsync).toHaveBeenCalledWith({
      sub: 'administrador-1',
      tipo: 'ADMIN_PLATAFORMA',
    });

    // Confirma que a auditoria identifica o administrador validado.
    expect(auditoriaMock.registrar).toHaveBeenCalledWith({
      atorId: 'administrador-1',
      tipoAtor: TipoAtorAuditoria.ADMIN_PLATAFORMA,
      modulo: 'ADMIN_PLATAFORMA',
      acao: 'LOGIN',
      resultado: ResultadoAuditoria.SUCESSO,
    });

    // Confirma o formato da resposta pública.
    expect(resultado).toMatchObject({
      accessToken: 'token-admin-ficticio',
      tokenType: 'Bearer',
      expiresIn: 900,
      administrador: {
        id: 'administrador-1',
        nome: 'Administrador de Teste',
        email: 'admin@exemplo.com',
      },
    });

    // O hash da senha não pode ser enviado ao cliente.
    expect(resultado.administrador).not.toHaveProperty('hashSenha');
    // Confirma que o evento também foi enviado ao log técnico de segurança.
    expect(aplicacaoLoggerMock.registrarSeguranca).toHaveBeenCalledWith(
      'Login administrativo da plataforma concluído.',
      {
        modulo: 'ADMIN_PLATAFORMA',
        acao: 'LOGIN',
        resultado: ResultadoAuditoria.SUCESSO,
      },
      'info',
    );
  });

  /**
   * Administradores inexistentes não podem se autenticar.
   *
   * A tentativa deve ser registrada como ANONIMO, sem atribuir
   * a ação a uma identidade que não foi confirmada.
   */
  it('deve rejeitar administrador inexistente e registrar tentativa anônima', async () => {
    prismaMock.administradorPlataforma.findUnique.mockResolvedValue(null);

    await expect(
      service.login(credenciais),
    ).rejects.toThrow(UnauthorizedException);

    expect(auditoriaMock.registrar).toHaveBeenCalledWith(
      auditoriaFalhaEsperada,
    );

    expect(jwtMock.signAsync).not.toHaveBeenCalled();
  });

  /**
   * Administradores desativados não podem se autenticar.
   *
   * Mesmo que a senha corresponda ao hash, a situação inativa
   * deve impedir a emissão de um novo token.
   */
  it('deve rejeitar administrador desativado e registrar tentativa anônima', async () => {
    prismaMock.administradorPlataforma.findUnique.mockResolvedValue({
      ...administradorAtivo,
      ativo: false,
    });

    await expect(
      service.login(credenciais),
    ).rejects.toThrow(UnauthorizedException);

    expect(auditoriaMock.registrar).toHaveBeenCalledWith(
      auditoriaFalhaEsperada,
    );

    expect(jwtMock.signAsync).not.toHaveBeenCalled();
  });

  /**
   * Verifica a rejeição de uma senha incorreta.
   *
   * A tentativa deve ser auditada como ANONIMO, sem armazenar
   * a senha informada ou atribuir a tentativa ao administrador.
   */
  it('deve rejeitar senha incorreta e registrar tentativa anônima', async () => {
    vi.mocked(argon2.verify).mockResolvedValue(false);

    await expect(
      service.login(credenciais),
    ).rejects.toThrow(UnauthorizedException);

    expect(auditoriaMock.registrar).toHaveBeenCalledWith(
      auditoriaFalhaEsperada,
    );

    expect(jwtMock.signAsync).not.toHaveBeenCalled();
    // Confirma que o evento também foi enviado ao log técnico de segurança.
    expect(aplicacaoLoggerMock.registrarSeguranca).toHaveBeenCalledWith(
      'Tentativa de login administrativo recusada.',
      {
        modulo: 'ADMIN_PLATAFORMA',
        acao: 'LOGIN',
        resultado: ResultadoAuditoria.FALHA,
      },
      'warn',
    );
  });

  /**
   * Um hash inválido ou corrompido também deve resultar
   * em rejeição da autenticação.
   *
   * A exceção interna do Argon2 não deve ser apresentada ao cliente.
   */
  it('deve rejeitar hash inválido e registrar tentativa anônima', async () => {
    vi.mocked(argon2.verify).mockRejectedValue(
      new Error('Hash inválido'),
    );

    await expect(
      service.login(credenciais),
    ).rejects.toThrow(UnauthorizedException);

    expect(auditoriaMock.registrar).toHaveBeenCalledWith(
      auditoriaFalhaEsperada,
    );

    expect(jwtMock.signAsync).not.toHaveBeenCalled();
  });

  /**
   * A falha no registro de uma tentativa recusada não deve alterar
   * o comportamento de segurança do login.
   *
   * O cliente continua recebendo HTTP 401, sem detalhes da falha
   * ocorrida na infraestrutura de auditoria.
   */
  it('deve preservar HTTP 401 quando a auditoria da tentativa recusada falhar', async () => {
    prismaMock.administradorPlataforma.findUnique.mockResolvedValue(null);

    auditoriaMock.registrar.mockRejectedValueOnce(
      new Error('Falha simulada na auditoria'),
    );

    const loggerSpy = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);

    try {
      await expect(
        service.login(credenciais),
      ).rejects.toThrow(UnauthorizedException);

      // Confirma que a falha interna foi registrada pelo Logger.
      expect(loggerSpy).toHaveBeenCalled();
    } finally {
      loggerSpy.mockRestore();
    }
  });

  /**
   * A auditoria do login bem-sucedido é obrigatória antes da entrega
   * do token.
   *
   * Caso a gravação falhe, o serviço não deve retornar uma sessão
   * cuja autenticação não tenha sido registrada.
   */
  it('não deve entregar token quando a auditoria do login administrativo falhar', async () => {
    auditoriaMock.registrar.mockRejectedValueOnce(
      new Error('Falha simulada na auditoria'),
    );

    await expect(
      service.login(credenciais),
    ).rejects.toThrow('Falha simulada na auditoria');

    // A geração ocorreu, mas a resposta com o token não foi entregue.
    expect(jwtMock.signAsync).toHaveBeenCalledOnce();

    expect(auditoriaMock.registrar).toHaveBeenCalledOnce();
  });

  /**
   * Garante que uma falha no log técnico complementar
   * não impeça a autenticação do administrador da plataforma.
   */
  it('deve autenticar o administrador mesmo quando o logger de segurança falhar', async () => {
    aplicacaoLoggerMock.registrarSeguranca.mockImplementationOnce(() => {
      throw new Error('Falha simulada no logger de segurança');
    });

    const resultado = await service.login(credenciais);

    // O token deve ser entregue porque a auditoria oficial foi gravada.
    expect(resultado).toMatchObject({
      accessToken: 'token-admin-ficticio',
      tokenType: 'Bearer',
      expiresIn: 900,
    });

    expect(auditoriaMock.registrar).toHaveBeenCalledWith(
      expect.objectContaining({
        resultado: ResultadoAuditoria.SUCESSO,
      }),
    );
  });
});
