
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import {
  HttpStatus,
  ServiceUnavailableException,
} from '@nestjs/common';

import { RedisService } from '../redis/redis.service.js';

import { LoginRateLimitService } from './login-rate-limit.service.js';

describe('LoginRateLimitService', () => {
  let service: LoginRateLimitService;

  /**
   * Simula o Redis sem utilizar o servidor real.
   *
   * Os testes verificam os identificadores, parâmetros e
   * comportamento do controle de tentativas de autenticação.
   */
  const redisMock = {
    reservarTentativaIdentificada: vi.fn(),
    liberarTentativaIdentificada: vi.fn(),
  };

  /**
   * Preserva as configurações anteriores para evitar
   * interferência com outros testes.
   */
  const variaveisAmbiente = [
    'AUTH_LOGIN_JANELA_SEGUNDOS',
    'AUTH_LOGIN_LIMITE_IP',
    'AUTH_LOGIN_LIMITE_IDENTIDADE_IP',
  ];

  let valoresAmbienteAnteriores: Record<
    string,
    string | undefined
  >;

  /**
   * Prepara um ambiente isolado antes de cada teste.
   */
  beforeEach(() => {
    vi.clearAllMocks();

    // Guarda as configurações existentes antes de aplicar os padrões.
    valoresAmbienteAnteriores = {};

    for (const nome of variaveisAmbiente) {
      valoresAmbienteAnteriores[nome] = process.env[nome];
      delete process.env[nome];
    }

    // Simula uma reserva identificada autorizada pelo Redis.
    redisMock.reservarTentativaIdentificada.mockResolvedValue(true);

    // Simula uma liberação identificada bem-sucedida.
    redisMock.liberarTentativaIdentificada.mockResolvedValue(undefined);

    // Cria o serviço utilizando o Redis simulado.
    service = new LoginRateLimitService(
      redisMock as unknown as RedisService,
    );
  });

  /**
   * Restaura as configurações originais depois de cada teste.
   */
  afterEach(() => {
    for (const nome of variaveisAmbiente) {
      const valorAnterior = valoresAmbienteAnteriores[nome];

      if (valorAnterior === undefined) {
        delete process.env[nome];
      } else {
        process.env[nome] = valorAnterior;
      }
    }
  });

  /**
   * TESTE 1 — Reserva de uma tentativa.
   *
   * Confirma:
   * - A utilização das duas chaves de controle.
   * - Os limites padrão de 120 e 5 tentativas.
   * - A janela padrão de 900 segundos.
   * - A geração de um UUID exclusivo.
   */
  it('deve reservar uma tentativa com UUID, limites e janela configurados', async () => {
    const reserva = await service.reservarTentativa(
      'empresa-1',
      'teste@empresa.com',
      '192.0.2.10',
    );

    expect(
      redisMock.reservarTentativaIdentificada,
    ).toHaveBeenCalledOnce();

    const [
      chaves,
      identificador,
      limites,
      validade,
    ] = redisMock.reservarTentativaIdentificada.mock.calls[0];

    expect(chaves).toHaveLength(2);

    // Confirma a nova versão das chaves de controle.
    expect(chaves[0]).toMatch(
      /^gestao:auth:login:v2:ip:[a-f0-9]{64}$/,
    );

    expect(chaves[1]).toMatch(
      /^gestao:auth:login:v2:identidade:[a-f0-9]{64}$/,
    );

    // Confirma que cada tentativa recebe um UUID válido.
    expect(identificador).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );

    expect(limites).toEqual([120, 5]);
    expect(validade).toBe(900);

    // Mantém a reserva enquanto a autenticação não for concluída.
    expect(reserva.liberar).toBeTypeOf('function');

    expect(
      redisMock.liberarTentativaIdentificada,
    ).not.toHaveBeenCalled();
  });

  /**
   * TESTE 2 — Bloqueio pelo limite geral do IP.
   *
   * Confirma que uma reserva recusada pelo Redis
   * é transformada em HTTP 429.
   */
  it('deve bloquear quando o limite do IP for ultrapassado', async () => {
    redisMock.reservarTentativaIdentificada.mockResolvedValue(false);

    await expect(
      service.reservarTentativa(
        'empresa-1',
        'teste@empresa.com',
        '192.0.2.10',
      ),
    ).rejects.toMatchObject({
      status: HttpStatus.TOO_MANY_REQUESTS,
    });

    expect(
      redisMock.liberarTentativaIdentificada,
    ).not.toHaveBeenCalled();
  });

  /**
   * TESTE 3 — Bloqueio específico da identidade.
   *
   * O Redis verifica o limite de identidade independentemente
   * do limite geral do IP.
   */
  it('deve bloquear quando o limite da identidade for ultrapassado', async () => {
    redisMock.reservarTentativaIdentificada.mockResolvedValue(false);

    await expect(
      service.reservarTentativa(
        'empresa-1',
        'teste@empresa.com',
        '192.0.2.10',
      ),
    ).rejects.toMatchObject({
      status: HttpStatus.TOO_MANY_REQUESTS,
    });
  });

  /**
   * TESTE 4 — Separação entre empresas.
   *
   * Confirma que o mesmo e-mail e IP produzem chaves de identidade
   * diferentes quando pertencem a empresas diferentes.
   */
  it('deve manter os contadores de identidade separados por empresa', async () => {
    await service.reservarTentativa(
      'empresa-1',
      'teste@empresa.com',
      '192.0.2.10',
    );

    await service.reservarTentativa(
      'empresa-2',
      'teste@empresa.com',
      '192.0.2.10',
    );

    const primeiraChamada =
      redisMock.reservarTentativaIdentificada.mock.calls[0];

    const segundaChamada =
      redisMock.reservarTentativaIdentificada.mock.calls[1];

    // O contador geral é igual porque o IP de origem é o mesmo.
    expect(primeiraChamada[0][0]).toBe(
      segundaChamada[0][0],
    );

    // As chaves de identidade são independentes por empresa.
    expect(primeiraChamada[0][1]).not.toBe(
      segundaChamada[0][1],
    );
  });

  /**
   * TESTE 5 — Normalização dos identificadores.
   *
   * Confirma que diferenças de maiúsculas e espaços no e-mail
   * não criam conjuntos de identidade duplicados.
   */
  it('deve normalizar o e-mail e os espaços antes de reservar', async () => {
    await service.reservarTentativa(
      'empresa-1',
      'TESTE@EMPRESA.COM',
      '192.0.2.10',
    );

    await service.reservarTentativa(
      ' empresa-1 ',
      ' teste@empresa.com ',
      ' 192.0.2.10 ',
    );

    const primeiraChamada =
      redisMock.reservarTentativaIdentificada.mock.calls[0];

    const segundaChamada =
      redisMock.reservarTentativaIdentificada.mock.calls[1];

    // As chaves são iguais, mas cada requisição tem UUID próprio.
    expect(primeiraChamada[0]).toEqual(segundaChamada[0]);
    expect(primeiraChamada[1]).not.toBe(segundaChamada[1]);
  });

  /**
   * TESTE 6 — Ausência de exposição dos identificadores.
   *
   * Confirma que as chaves não armazenam diretamente
   * o e-mail, a empresa ou o endereço IP.
   */
  it('não deve expor dados pessoais nas chaves Redis', async () => {
    const email = 'teste@empresa.com';
    const ip = '192.0.2.10';

    await service.reservarTentativa(
      'empresa-1',
      email,
      ip,
    );

    const [chaves] =
      redisMock.reservarTentativaIdentificada.mock.calls[0];

    const identificadores = chaves.join(' ');

    expect(identificadores).not.toContain(email);
    expect(identificadores).not.toContain(ip);
    expect(identificadores).not.toContain('empresa-1');
  });

  /**
   * TESTE 7 — Liberação individual de uma reserva.
   *
   * Confirma que a liberação utiliza exatamente as mesmas
   * chaves e o UUID gerado durante a reserva.
   */
  it('deve liberar somente o identificador da reserva atual', async () => {
    const reserva = await service.reservarTentativa(
      'empresa-1',
      'teste@empresa.com',
      '192.0.2.10',
    );

    const [
      chaves,
      identificador,
    ] = redisMock.reservarTentativaIdentificada.mock.calls[0];

    await reserva.liberar();

    expect(
      redisMock.liberarTentativaIdentificada,
    ).toHaveBeenCalledWith(
      chaves,
      identificador,
    );

    expect(
      redisMock.liberarTentativaIdentificada,
    ).toHaveBeenCalledOnce();
  });

  /**
   * TESTE 8 — Liberação duplicada.
   *
   * Confirma que uma reserva já liberada não executa
   * outra remoção desnecessária.
   */
  it('deve impedir a liberação duplicada da mesma reserva', async () => {
    const reserva = await service.reservarTentativa(
      'empresa-1',
      'teste@empresa.com',
      '192.0.2.10',
    );

    await reserva.liberar();
    await reserva.liberar();

    expect(
      redisMock.liberarTentativaIdentificada,
    ).toHaveBeenCalledOnce();
  });

  /**
   * TESTE 9 — Reservas simultâneas independentes.
   *
   * Confirma que requisições para a mesma identidade recebem
   * UUIDs diferentes e podem ser liberadas individualmente.
   */
  it('deve manter reservas simultâneas com identificadores independentes', async () => {
    const primeiraReserva =
      await service.reservarTentativa(
        'empresa-1',
        'teste@empresa.com',
        '192.0.2.10',
      );

    const segundaReserva =
      await service.reservarTentativa(
        'empresa-1',
        'teste@empresa.com',
        '192.0.2.10',
      );

    const primeiraChamada =
      redisMock.reservarTentativaIdentificada.mock.calls[0];

    const segundaChamada =
      redisMock.reservarTentativaIdentificada.mock.calls[1];

    expect(primeiraChamada[0]).toEqual(segundaChamada[0]);

    // Cada tentativa tem uma identidade exclusiva, mesmo nas mesmas chaves.
    expect(primeiraChamada[1]).not.toBe(segundaChamada[1]);

    // Libera somente a primeira tentativa.
    await primeiraReserva.liberar();

    expect(
      redisMock.liberarTentativaIdentificada,
    ).toHaveBeenCalledWith(
      primeiraChamada[0],
      primeiraChamada[1],
    );

    expect(
      redisMock.liberarTentativaIdentificada,
    ).toHaveBeenCalledOnce();

    // A segunda reserva continua independente.
    await segundaReserva.liberar();

    expect(
      redisMock.liberarTentativaIdentificada,
    ).toHaveBeenCalledWith(
      segundaChamada[0],
      segundaChamada[1],
    );

    expect(
      redisMock.liberarTentativaIdentificada,
    ).toHaveBeenCalledTimes(2);
  });

  /**
   * TESTE 10 — Liberações simultâneas da mesma reserva.
   *
   * Confirma que chamadas concorrentes compartilham
   * a mesma operação de liberação.
   */
  it('deve compartilhar a liberação quando houver chamadas simultâneas', async () => {
    let concluirLiberacao: (() => void) | undefined;

    redisMock.liberarTentativaIdentificada.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          concluirLiberacao = resolve;
        }),
    );

    const reserva = await service.reservarTentativa(
      'empresa-1',
      'teste@empresa.com',
      '192.0.2.10',
    );

    const primeiraLiberacao = reserva.liberar();
    const segundaLiberacao = reserva.liberar();

    expect(
      redisMock.liberarTentativaIdentificada,
    ).toHaveBeenCalledOnce();

    concluirLiberacao?.();

    await Promise.all([
      primeiraLiberacao,
      segundaLiberacao,
    ]);

    expect(
      redisMock.liberarTentativaIdentificada,
    ).toHaveBeenCalledOnce();
  });

  /**
   * TESTE 11 — Nova tentativa de liberação após falha.
   *
   * Como a remoção SREM é idempotente, uma operação que falhou
   * pode ser repetida com o mesmo UUID sem afetar outras reservas.
   */
  it('deve permitir repetir a liberação quando a primeira tentativa falhar', async () => {
    redisMock.liberarTentativaIdentificada
      .mockRejectedValueOnce(
        new ServiceUnavailableException(
          'Redis indisponível.',
        ),
      )
      .mockResolvedValueOnce(undefined);

    const reserva = await service.reservarTentativa(
      'empresa-1',
      'teste@empresa.com',
      '192.0.2.10',
    );

    await expect(
      reserva.liberar(),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);

    // A segunda chamada usa o mesmo identificador exclusivo.
    await reserva.liberar();

    const chamadas =
      redisMock.liberarTentativaIdentificada.mock.calls;

    expect(chamadas).toHaveLength(2);
    expect(chamadas[0]).toEqual(chamadas[1]);
  });

  /**
   * TESTE 12 — Indisponibilidade do Redis.
   *
   * Não permite autenticação sem conseguir aplicar os limites.
   */
  it('deve propagar indisponibilidade do Redis durante a reserva', async () => {
    redisMock.reservarTentativaIdentificada.mockRejectedValue(
      new ServiceUnavailableException(
        'Redis indisponível.',
      ),
    );

    await expect(
      service.reservarTentativa(
        'empresa-1',
        'teste@empresa.com',
        '192.0.2.10',
      ),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  /**
   * TESTE 13 — Identificação obrigatória.
   *
   * Impede a criação de reservas sem empresa, e-mail ou IP válidos.
   */
  it('deve rejeitar tentativa sem endereço IP', async () => {
    await expect(
      service.reservarTentativa(
        'empresa-1',
        'teste@empresa.com',
        '',
      ),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);

    expect(
      redisMock.reservarTentativaIdentificada,
    ).not.toHaveBeenCalled();
  });

  /**
   * TESTE 14 — Falha ao liberar reserva.
   *
   * Confirma que uma falha na liberação é propagada.
   * A reserva poderá ser liberada novamente usando o mesmo UUID.
   */
  it('deve propagar indisponibilidade durante a liberação', async () => {
    const reserva = await service.reservarTentativa(
      'empresa-1',
      'teste@empresa.com',
      '192.0.2.10',
    );

    redisMock.liberarTentativaIdentificada.mockRejectedValueOnce(
      new ServiceUnavailableException(
        'Redis indisponível.',
      ),
    );

    await expect(
      reserva.liberar(),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
