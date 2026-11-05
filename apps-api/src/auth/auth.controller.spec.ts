
import { Test, TestingModule } from '@nestjs/testing';

import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import {
  HttpException,
  HttpStatus,
  RequestMethod,
  ServiceUnavailableException,
} from '@nestjs/common';

import {
  HTTP_CODE_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants';

import type { Request } from 'express';

import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { LoginDto } from './dto/login.dto.js';

/**
 * Testes do controller responsável pelo endpoint:
 *
 * POST /auth/login
 *
 * Verifica:
 * - Encaminhamento das credenciais ao AuthService.
 * - Identificação correta do endereço IP.
 * - Não utilização direta do cabeçalho X-Forwarded-For.
 * - Comportamento quando o IP não está disponível.
 * - Propagação dos erros HTTP do serviço.
 * - Preservação do contrato da rota.
 *
 * O AuthService é substituído por um mock.
 * Nenhum banco de dados ou Redis real é utilizado.
 */
describe('AuthController', () => {
  let controller: AuthController;

  /**
   * Simula o serviço responsável pela autenticação.
   *
   * A lógica de validação das credenciais e limitação de tentativas
   * pertence ao AuthService, não ao controller.
   */
  const authServiceMock = {
    login: vi.fn(),
  };

  /**
   * Resposta fictícia de uma autenticação bem-sucedida.
   *
   * Contém somente informações públicas do usuário.
   */
  const respostaLogin = {
    accessToken: 'token-ficticio',
    tokenType: 'Bearer',
    expiresIn: 900,
    usuario: {
      id: 'usuario-1',
      empresaId: 'empresa-1',
      empresaNome: 'Empresa de Teste',
      nome: 'Usuário de Teste',
      email: 'teste@exemplo.com',
      perfil: 'GERENTE',
    },
  };

  /**
   * Cria uma requisição HTTP fictícia.
   *
   * Permite controlar o IP reconhecido pelo Express
   * e simular cabeçalhos enviados pelo cliente.
   */
  function criarRequisicao(
    ip?: string,
    xForwardedFor?: string,
  ): Request {
    return {
      ip,

      headers: {
        'x-forwarded-for': xForwardedFor,
      },
    } as unknown as Request;
  }

  /**
   * Dados de autenticação utilizados nos cenários de teste.
   */
  function criarDtoLogin(): LoginDto {
    return {
      empresaId: 'empresa-1',
      email: 'teste@exemplo.com',
      senha: 'SenhaSegura123',
    };
  }

  /**
   * Prepara um ambiente isolado antes de cada teste.
   *
   * Reseta o histórico dos mocks e cria uma nova instância
   * do controller utilizando o AuthService simulado.
   */
  beforeEach(async () => {
    // Limpa chamadas anteriores dos mocks.
    vi.clearAllMocks();

    // Define uma resposta padrão para login bem-sucedido.
    authServiceMock.login.mockResolvedValue(respostaLogin);

    /**
     * Cria o módulo de testes do NestJS.
     *
     * O AuthService real é substituído para evitar acesso
     * ao PostgreSQL, Redis, Argon2 e JWT.
     */
    const modulo: TestingModule =
      await Test.createTestingModule({
        controllers: [AuthController],

        providers: [
          {
            provide: AuthService,
            useValue: authServiceMock,
          },
        ],
      }).compile();

    // Recupera o controller criado pelo NestJS.
    controller = modulo.get<AuthController>(AuthController);
  });

  /**
   * TESTE 1 — Inicialização do controller.
   *
   * Confirma que o NestJS consegue instanciar o controller.
   */
  it('deve estar definido', () => {
    expect(controller).toBeDefined();
  });

  /**
   * TESTE 2 — Encaminhamento das credenciais e do IP.
   *
   * Confirma que o controller encaminha ao AuthService
   * tanto o DTO de autenticação quanto o IP da requisição.
   */
  it('deve encaminhar as credenciais e o IP ao AuthService', async () => {
    const dto = criarDtoLogin();

    const requisicao = criarRequisicao(
      '192.0.2.10',
    );

    // Executa o endpoint diretamente.
    const resultado = await controller.login(
      dto,
      requisicao,
    );

    // Confirma que o serviço recebeu as credenciais e o IP.
    expect(authServiceMock.login).toHaveBeenCalledOnce();

    expect(authServiceMock.login).toHaveBeenCalledWith(
      dto,
      '192.0.2.10',
    );

    // Confirma que a resposta do serviço foi preservada.
    expect(resultado).toEqual(respostaLogin);
  });

  /**
   * TESTE 3 — Proteção contra IP enviado livremente pelo cliente.
   *
   * O controller deve utilizar request.ip e não confiar
   * diretamente no cabeçalho X-Forwarded-For.
   *
   * O cabeçalho só pode ser considerado posteriormente
   * mediante configuração explícita de proxy confiável no Express.
   */
  it('não deve utilizar diretamente o X-Forwarded-For enviado pelo cliente', async () => {
    const dto = criarDtoLogin();

    const requisicao = criarRequisicao(
      '192.0.2.10',
      '203.0.113.99',
    );

    await controller.login(
      dto,
      requisicao,
    );

    // O IP encaminhado deve ser o reconhecido pelo Express.
    expect(authServiceMock.login).toHaveBeenCalledWith(
      dto,
      '192.0.2.10',
    );

    // O IP informado no cabeçalho não deve ser utilizado diretamente.
    expect(authServiceMock.login).not.toHaveBeenCalledWith(
      dto,
      '203.0.113.99',
    );
  });

  /**
   * TESTE 4 — IP não identificado.
   *
   * Quando request.ip não estiver disponível, o controller
   * encaminha uma string vazia.
   *
   * O AuthService e o limitador serão responsáveis por rejeitar
   * a tentativa sem uma origem confiável.
   */
  it('deve encaminhar IP vazio quando a requisição não apresentar endereço reconhecido', async () => {
    const dto = criarDtoLogin();

    const requisicao = criarRequisicao();

    await controller.login(
      dto,
      requisicao,
    );

    expect(authServiceMock.login).toHaveBeenCalledWith(
      dto,
      '',
    );
  });

  /**
   * TESTE 5 — Propagação do bloqueio HTTP 429.
   *
   * Confirma que o controller não transforma ou oculta
   * o bloqueio por excesso de tentativas.
   */
  it('deve propagar HTTP 429 quando o limite de tentativas for ultrapassado', async () => {
    const erro = new HttpException(
      'Muitas tentativas.',
      HttpStatus.TOO_MANY_REQUESTS,
    );

    authServiceMock.login.mockRejectedValueOnce(erro);

    await expect(
      controller.login(
        criarDtoLogin(),
        criarRequisicao('192.0.2.10'),
      ),
    ).rejects.toBe(erro);
  });

  /**
   * TESTE 6 — Propagação da indisponibilidade HTTP 503.
   *
   * Confirma que a indisponibilidade do Redis chega ao cliente
   * como erro de serviço indisponível.
   */
  it('deve propagar HTTP 503 quando o Redis estiver indisponível', async () => {
    const erro = new ServiceUnavailableException(
      'Serviço temporariamente indisponível.',
    );

    authServiceMock.login.mockRejectedValueOnce(erro);

    await expect(
      controller.login(
        criarDtoLogin(),
        criarRequisicao('192.0.2.10'),
      ),
    ).rejects.toBe(erro);
  });

  /**
   * TESTE 7 — Contrato HTTP do endpoint.
   *
   * Confirma que a rota continua configurada como:
   *
   * POST /auth/login
   * HTTP 200
   *
   * Protege a definição da API contra alterações acidentais.
   */
  it('deve manter a rota POST /auth/login com resposta HTTP 200', () => {
    // Recupera a referência ao método de login.
    const metodo = AuthController.prototype.login;

    // Confirma o caminho definido pelo decorator @Post('login').
    expect(
      Reflect.getMetadata(PATH_METADATA, metodo),
    ).toBe('login');

    // Confirma que a rota utiliza HTTP POST.
    expect(
      Reflect.getMetadata(METHOD_METADATA, metodo),
    ).toBe(RequestMethod.POST);

    // Confirma que uma autenticação bem-sucedida retorna HTTP 200.
    expect(
      Reflect.getMetadata(HTTP_CODE_METADATA, metodo),
    ).toBe(HttpStatus.OK);
  });
});
