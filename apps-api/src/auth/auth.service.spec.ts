
import { Test, TestingModule } from '@nestjs/testing';

import { JwtService } from '@nestjs/jwt';

import {
  Logger,
  HttpException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';

import {
  ResultadoAuditoria,
  TipoAtorAuditoria,
} from '@prisma/client';

import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

// Simula o Argon2 antes de importar o serviço de autenticação.
vi.mock('argon2', () => ({
  verify: vi.fn(),
}));

import * as argon2 from 'argon2';

import { AuthService } from './auth.service.js';

import { LoginRateLimitService } from './login-rate-limit.service.js';

import type { ReservaTentativaLogin } from './login-rate-limit.service.js';

import { PrismaService } from '../prisma/prisma.service.js';

import { AuditoriaService } from '../auditoria/auditoria.service.js';
import { AplicacaoLogger } from '../logging/logger.service.js';

/**
 * Testes do serviço responsável pela autenticação empresarial.
 *
 * Os cenários verificam:
 * - Validação de empresas e usuários.
 * - Conferência das senhas com Argon2.
 * - Geração dos tokens JWT.
 * - Registro de auditoria.
 * - Reserva e liberação de tentativas pelo Redis.
 * - Comportamento diante de erros internos.
 *
 * Todas as dependências externas são simuladas.
 * Nenhum teste utiliza PostgreSQL ou Redis reais.
 */
describe('AuthService', () => {
  let service: AuthService;

  /**
   * Simula as consultas ao banco de dados.
   *
   * Impede que os testes de autenticação acessem
   * registros reais de empresas ou usuários.
   */
  const prismaMock = {
    empresa: {
      findUnique: vi.fn(),
    },

    usuario: {
      findUnique: vi.fn(),
    },
  };

  /**
   * Simula a geração e validação de tokens JWT.
   *
   * O AuthService utiliza signAsync para emitir o token
   * depois que as credenciais são confirmadas.
   */
  const jwtMock = {
    signAsync: vi.fn(),
    verifyAsync: vi.fn(),
  };

  /**
   * Simula o serviço central de auditoria.
   *
   * Permite verificar tanto os logins bem-sucedidos
   * quanto as tentativas recusadas.
   */
  const auditoriaMock = {
    registrar: vi.fn(),
  };

  // Simula o registro técnico complementar de segurança.
  const aplicacaoLoggerMock = {
    registrarSeguranca: vi.fn(),
  };

  /**
   * Representa a infraestrutura de controle de tentativas.
   *
   * A reserva é simulada para que os testes possam verificar
   * quando uma tentativa deve ser mantida ou liberada.
   */
  const loginRateLimitMock = {
    reservarTentativa: vi.fn(),
  };

  /**
   * Simula a reserva individual criada pelo limitador.
   *
   * O método liberar representa a devolução da posição
   * reservada no Redis pela requisição atual.
   */
  const reservaMock: ReservaTentativaLogin = {
    liberar: vi.fn(),
  };

  // IP fictício utilizado nas tentativas de autenticação.
  const ipTeste = '192.0.2.10';

  /**
   * Retorna os dados padrão enviados para a autenticação.
   *
   * O uso de uma função permite criar DTOs independentes
   * em cada cenário de teste.
   */
  function criarDtoLogin(
    sobrescritos: Record<string, unknown> = {},
  ) {
    return {
      empresaId: 'empresa-1',
      email: 'teste@exemplo.com',
      senha: 'senha-de-teste',
      ...sobrescritos,
    };
  }

  /**
   * Empresa fictícia utilizada nos cenários de login.
   */
  const empresaAtiva = {
    id: 'empresa-1',
    nome: 'Empresa de Teste',
    ativo: true,
  };

  /**
   * Usuário fictício vinculado à empresa de teste.
   *
   * O hash é fictício porque o Argon2 está sendo simulado.
   */
  const usuarioAtivo = {
    id: 'usuario-1',
    empresaId: 'empresa-1',
    nome: 'Usuário de Teste',
    email: 'teste@exemplo.com',
    hashSenha: 'hash-ficticio',
    perfil: 'GERENTE',
    ativo: true,
  };

  /**
   * Dados esperados para auditoria de tentativa recusada.
   *
   * O ator permanece ANONIMO porque as credenciais
   * ainda não foram confirmadas.
   */
  const auditoriaFalhaEsperada = {
    empresaId: 'empresa-1',
    tipoAtor: TipoAtorAuditoria.ANONIMO,
    modulo: 'AUTH',
    acao: 'LOGIN',
    resultado: ResultadoAuditoria.FALHA,
    motivo: 'Tentativa de autenticação recusada.',
  };

  /**
   * Prepara o ambiente isolado antes de cada teste.
   *
   * Os mocks recebem comportamentos padrão e o módulo NestJS
   * é criado com todas as dependências substituídas.
   */
  beforeEach(async () => {
    // Limpa o histórico de chamadas anteriores.
    vi.clearAllMocks();

    // Simula uma empresa ativa.
    prismaMock.empresa.findUnique.mockResolvedValue(
      empresaAtiva,
    );

    // Simula um usuário ativo pertencente à empresa.
    prismaMock.usuario.findUnique.mockResolvedValue(
      usuarioAtivo,
    );

    // Simula a geração de um token JWT.
    jwtMock.signAsync.mockResolvedValue('token-ficticio');

    // Simula a gravação bem-sucedida de auditoria.
    auditoriaMock.registrar.mockResolvedValue({
      id: 'evento-auditoria-1',
    });

    // Simula a liberação bem-sucedida da reserva Redis.
    vi.mocked(reservaMock.liberar).mockResolvedValue(
      undefined,
    );

    // Permite a reserva de uma tentativa durante o login.
    loginRateLimitMock.reservarTentativa.mockResolvedValue(
      reservaMock,
    );

    // Simula a confirmação correta da senha pelo Argon2.
    vi.mocked(argon2.verify).mockResolvedValue(true);

    /**
     * Cria o módulo de testes do NestJS.
     *
     * Todas as dependências são simuladas para garantir
     * isolamento e previsibilidade nos testes.
     */
    const modulo: TestingModule =
      await Test.createTestingModule({
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
          {
            provide: AuditoriaService,
            useValue: auditoriaMock,
          },
          {
            provide: AplicacaoLogger,
            useValue: aplicacaoLoggerMock,
          },
          {
            provide: LoginRateLimitService,
            useValue: loginRateLimitMock,
          },
        ],
      }).compile();

    // Recupera o serviço de autenticação criado pelo NestJS.
    service = modulo.get<AuthService>(AuthService);
  });

  /**
   * TESTE 1 — Inicialização.
   *
   * Confirma que o serviço pode ser criado com todas
   * as dependências necessárias.
   */
  it('deve estar definido', () => {
    expect(service).toBeDefined();
  });

  /**
   * TESTE 2 — Reserva antes da consulta de credenciais.
   *
   * Garante que o controle de tentativas seja executado
   * antes de qualquer consulta de empresa ou usuário.
   */
  it('deve reservar a tentativa antes de consultar as credenciais', async () => {
    await service.login(
      criarDtoLogin(),
      ipTeste,
    );

    // A identidade enviada ao limitador deve estar normalizada.
    expect(
      loginRateLimitMock.reservarTentativa,
    ).toHaveBeenCalledWith(
      'empresa-1',
      'teste@exemplo.com',
      ipTeste,
    );

    // Confirma que a reserva aconteceu antes da consulta ao banco.
    expect(
      loginRateLimitMock.reservarTentativa.mock.invocationCallOrder[0],
    ).toBeLessThan(
      prismaMock.empresa.findUnique.mock.invocationCallOrder[0],
    );
  });

  /**
   * TESTE 3 — Login bem-sucedido.
   *
   * Verifica a autenticação completa, a geração do JWT,
   * a liberação da reserva e o registro de auditoria.
   */
  it('deve autenticar o usuário, liberar a reserva e registrar auditoria', async () => {
    const resultado = await service.login(
      criarDtoLogin({
        email: ' TESTE@EXEMPLO.COM ',
      }),
      ipTeste,
    );

    // Confirma que a empresa foi consultada pelo identificador informado.
    expect(prismaMock.empresa.findUnique).toHaveBeenCalledWith({
      where: {
        id: 'empresa-1',
      },
      select: {
        id: true,
        nome: true,
        ativo: true,
      },
    });

    // Confirma que o usuário foi localizado dentro da empresa correta.
    expect(prismaMock.usuario.findUnique).toHaveBeenCalledWith({
      where: {
        empresaId_email: {
          empresaId: 'empresa-1',
          email: 'teste@exemplo.com',
        },
      },
    });

    // Confirma a verificação da senha pelo Argon2.
    expect(argon2.verify).toHaveBeenCalledWith(
      'hash-ficticio',
      'senha-de-teste',
    );

    // Confirma os dados incluídos no token JWT.
    expect(jwtMock.signAsync).toHaveBeenCalledWith({
      sub: 'usuario-1',
      empresaId: 'empresa-1',
      perfil: 'GERENTE',
    });

    // A reserva da autenticação válida deve ser liberada.
    expect(reservaMock.liberar).toHaveBeenCalled();

    // Confirma o registro do login com o ator já identificado.
    expect(auditoriaMock.registrar).toHaveBeenCalledWith({
      empresaId: 'empresa-1',
      atorId: 'usuario-1',
      tipoAtor: TipoAtorAuditoria.USUARIO_EMPRESA,
      modulo: 'AUTH',
      acao: 'LOGIN',
      resultado: ResultadoAuditoria.SUCESSO,
    });

    // Confirma os campos públicos da resposta.
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

    // Garante que o hash da senha nunca seja enviado ao frontend.
    expect(resultado.usuario).not.toHaveProperty('hashSenha');
    // Confirma que o evento também foi enviado ao log técnico de segurança.
    expect(aplicacaoLoggerMock.registrarSeguranca).toHaveBeenCalledWith(
      'Login empresarial concluído.',
      {
        modulo: 'AUTH',
        acao: 'LOGIN',
        resultado: ResultadoAuditoria.SUCESSO,
      },
      'info',
    );
  });

  /**
   * TESTE 4 — Empresa inexistente.
   *
   * Uma tentativa com empresa não encontrada permanece contabilizada,
   * porque as credenciais informadas não foram aceitas.
   */
  it('deve rejeitar empresa inexistente e manter a tentativa contabilizada', async () => {
    prismaMock.empresa.findUnique.mockResolvedValue(null);

    await expect(
      service.login(criarDtoLogin(), ipTeste),
    ).rejects.toThrow(UnauthorizedException);

    // Não deve procurar usuários de uma empresa inexistente.
    expect(prismaMock.usuario.findUnique).not.toHaveBeenCalled();

    // A tentativa deve ser registrada como anônima.
    expect(auditoriaMock.registrar).toHaveBeenCalledWith(
      auditoriaFalhaEsperada,
    );

    // A reserva permanece contabilizada por se tratar de credencial recusada.
    expect(reservaMock.liberar).not.toHaveBeenCalled();

    // Nenhum token deve ser produzido.
    expect(jwtMock.signAsync).not.toHaveBeenCalled();
  });

  /**
   * TESTE 5 — Empresa desativada.
   *
   * Impede autenticação em empresas que não estejam ativas.
   */
  it('deve rejeitar empresa desativada e manter a tentativa contabilizada', async () => {
    prismaMock.empresa.findUnique.mockResolvedValue({
      ...empresaAtiva,
      ativo: false,
    });

    await expect(
      service.login(criarDtoLogin(), ipTeste),
    ).rejects.toThrow(UnauthorizedException);

    expect(prismaMock.usuario.findUnique).not.toHaveBeenCalled();

    expect(auditoriaMock.registrar).toHaveBeenCalledWith(
      auditoriaFalhaEsperada,
    );

    expect(reservaMock.liberar).not.toHaveBeenCalled();
    expect(jwtMock.signAsync).not.toHaveBeenCalled();
  });

  /**
   * TESTE 6 — Usuário inexistente.
   *
   * Impede autenticação quando o e-mail não pertence à empresa informada.
   */
  it('deve rejeitar usuário inexistente e manter a tentativa contabilizada', async () => {
    prismaMock.usuario.findUnique.mockResolvedValue(null);

    await expect(
      service.login(
        criarDtoLogin({
          email: 'naoexiste@exemplo.com',
        }),
        ipTeste,
      ),
    ).rejects.toThrow(UnauthorizedException);

    expect(auditoriaMock.registrar).toHaveBeenCalledWith(
      auditoriaFalhaEsperada,
    );

    expect(reservaMock.liberar).not.toHaveBeenCalled();
    expect(jwtMock.signAsync).not.toHaveBeenCalled();
  });

  /**
   * TESTE 7 — Usuário desativado.
   *
   * Um usuário inativo não recebe token e permanece contabilizado
   * como tentativa de autenticação recusada.
   */
  it('deve rejeitar usuário desativado e manter a tentativa contabilizada', async () => {
    prismaMock.usuario.findUnique.mockResolvedValue({
      ...usuarioAtivo,
      ativo: false,
    });

    await expect(
      service.login(criarDtoLogin(), ipTeste),
    ).rejects.toThrow(UnauthorizedException);

    expect(auditoriaMock.registrar).toHaveBeenCalledWith(
      auditoriaFalhaEsperada,
    );

    expect(reservaMock.liberar).not.toHaveBeenCalled();
    expect(jwtMock.signAsync).not.toHaveBeenCalled();
  });

  /**
   * TESTE 8 — Senha incorreta.
   *
   * Confirma que a tentativa permanece contabilizada no Redis
   * e que o sistema não entrega um token.
   */
  it('deve rejeitar senha incorreta e manter a tentativa contabilizada', async () => {
    vi.mocked(argon2.verify).mockResolvedValue(false);

    await expect(
      service.login(
        criarDtoLogin({
          senha: 'senha-incorreta',
        }),
        ipTeste,
      ),
    ).rejects.toThrow(UnauthorizedException);

    expect(auditoriaMock.registrar).toHaveBeenCalledWith(
      auditoriaFalhaEsperada,
    );

    // Senhas incorretas não devem liberar a reserva.
    expect(reservaMock.liberar).not.toHaveBeenCalled();

    expect(jwtMock.signAsync).not.toHaveBeenCalled();
    // Confirma que o evento também foi enviado ao log técnico de segurança.
    expect(aplicacaoLoggerMock.registrarSeguranca).toHaveBeenCalledWith(
      'Tentativa de login empresarial recusada.',
      {
        modulo: 'AUTH',
        acao: 'LOGIN',
        resultado: ResultadoAuditoria.FALHA,
      },
      'warn',
    );
  });

  /**
   * TESTE 9 — Hash inválido.
   *
   * Confirma que uma falha na verificação do hash
   * resulta em credenciais recusadas.
   */
  it('deve rejeitar hash inválido e manter a tentativa contabilizada', async () => {
    vi.mocked(argon2.verify).mockRejectedValue(
      new Error('Hash inválido'),
    );

    await expect(
      service.login(criarDtoLogin(), ipTeste),
    ).rejects.toThrow(UnauthorizedException);

    expect(auditoriaMock.registrar).toHaveBeenCalledWith(
      auditoriaFalhaEsperada,
    );

    expect(reservaMock.liberar).not.toHaveBeenCalled();
    expect(jwtMock.signAsync).not.toHaveBeenCalled();
  });

  /**
   * TESTE 10 — Falha na auditoria de tentativa recusada.
   *
   * Uma falha no registro da auditoria não deve transformar
   * um login recusado em erro interno nem liberar sua reserva.
   */
  it('deve preservar HTTP 401 quando a auditoria da tentativa recusada falhar', async () => {
    auditoriaMock.registrar.mockRejectedValueOnce(
      new Error('Falha simulada na auditoria'),
    );

    prismaMock.empresa.findUnique.mockResolvedValue(null);

    // Evita poluir a saída dos testes com o log esperado.
    const loggerSpy = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);

    try {
      await expect(
        service.login(criarDtoLogin(), ipTeste),
      ).rejects.toThrow(UnauthorizedException);

      expect(loggerSpy).toHaveBeenCalled();

      // A falha da auditoria não deve liberar uma credencial recusada.
      expect(reservaMock.liberar).not.toHaveBeenCalled();
    } finally {
      // Restaura o comportamento original do logger.
      loggerSpy.mockRestore();
    }
  });

  /**
   * TESTE 11 — Falha no banco de dados.
   *
   * Problemas internos do PostgreSQL não são erros de senha.
   * Por isso, a reserva deve ser liberada.
   */
  it('deve liberar a reserva quando ocorrer falha na consulta ao banco', async () => {
    const erro = new Error('Banco de dados indisponível');

    prismaMock.empresa.findUnique.mockRejectedValueOnce(erro);

    await expect(
      service.login(criarDtoLogin(), ipTeste),
    ).rejects.toBe(erro);

    expect(reservaMock.liberar).toHaveBeenCalled();

    // Uma falha interna não deve produzir auditoria de senha incorreta.
    expect(auditoriaMock.registrar).not.toHaveBeenCalled();

    expect(jwtMock.signAsync).not.toHaveBeenCalled();
  });

  /**
   * TESTE 12 — Falha na geração do JWT.
   *
   * Uma falha técnica ao assinar o token não representa
   * tentativa de senha incorreta.
   */
  it('deve liberar a reserva quando ocorrer falha na geração do JWT', async () => {
    const erro = new Error('Falha ao assinar o token');

    jwtMock.signAsync.mockRejectedValueOnce(erro);

    await expect(
      service.login(criarDtoLogin(), ipTeste),
    ).rejects.toBe(erro);

    expect(reservaMock.liberar).toHaveBeenCalled();

    // O login não deve ser registrado como sucesso.
    expect(auditoriaMock.registrar).not.toHaveBeenCalled();
  });

  /**
   * TESTE 13 — Falha na auditoria de login bem-sucedido.
   *
   * O token não deve ser entregue quando a auditoria obrigatória
   * não puder ser persistida.
   *
   * A reserva da autenticação válida já terá sido liberada.
   */
  it('não deve entregar o token quando a auditoria do login bem-sucedido falhar', async () => {
    const erro = new Error('Falha na auditoria de sucesso');

    auditoriaMock.registrar.mockRejectedValueOnce(erro);

    await expect(
      service.login(criarDtoLogin(), ipTeste),
    ).rejects.toBe(erro);

    expect(jwtMock.signAsync).toHaveBeenCalledOnce();

    // Confirma que a reserva foi liberada após validar a senha.
    expect(reservaMock.liberar).toHaveBeenCalled();

    // A auditoria continua obrigatória antes da entrega do token.
    expect(auditoriaMock.registrar).toHaveBeenCalledOnce();
  });

  /**
   * TESTE 14 — Redis indisponível.
   *
   * O sistema não deve consultar o banco ou permitir autenticação
   * quando não consegue validar os limites de tentativas.
   */
  it('deve impedir login quando o Redis estiver indisponível', async () => {
    const erro = new ServiceUnavailableException(
      'Redis indisponível.',
    );

    loginRateLimitMock.reservarTentativa.mockRejectedValueOnce(
      erro,
    );

    await expect(
      service.login(criarDtoLogin(), ipTeste),
    ).rejects.toBe(erro);

    // A consulta ao banco não deve ser iniciada.
    expect(prismaMock.empresa.findUnique).not.toHaveBeenCalled();
    expect(prismaMock.usuario.findUnique).not.toHaveBeenCalled();

    // Não deve existir registro de auditoria de credenciais.
    expect(auditoriaMock.registrar).not.toHaveBeenCalled();
  });

  /**
   * TESTE 15 — Limite de tentativas ultrapassado.
   *
   * Confirma que o HTTP 429 produzido pelo limitador
   * é preservado pelo AuthService.
   */
  it('deve preservar HTTP 429 quando o limite de tentativas for ultrapassado', async () => {
    const erro = new HttpException(
      'Muitas tentativas.',
      429,
    );

    loginRateLimitMock.reservarTentativa.mockRejectedValueOnce(
      erro,
    );

    await expect(
      service.login(criarDtoLogin(), ipTeste),
    ).rejects.toBe(erro);

    expect(prismaMock.empresa.findUnique).not.toHaveBeenCalled();

    expect(jwtMock.signAsync).not.toHaveBeenCalled();
  });

  /**
   * Garante que uma falha no log técnico complementar
   * não impeça a autenticação empresarial válida.
   */
  it('deve autenticar mesmo quando o logger de segurança falhar', async () => {
    aplicacaoLoggerMock.registrarSeguranca.mockImplementationOnce(() => {
      throw new Error('Falha simulada no logger de segurança');
    });

    const resultado = await service.login(
      criarDtoLogin(),
      ipTeste,
    );

    // A autenticação e a auditoria oficial devem continuar funcionando.
    expect(resultado).toMatchObject({
      accessToken: 'token-ficticio',
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
