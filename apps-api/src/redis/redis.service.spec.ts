
import { Test, TestingModule } from '@nestjs/testing';

import {
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';

import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import { REDIS_CLIENT } from './redis.constants.js';
import { RedisService } from './redis.service.js';

describe('RedisService', () => {
  let service: RedisService;

  /**
   * Cliente fictício que substitui a conexão real com Redis.
   *
   * Permite verificar os comandos e scripts enviados ao Redis
   * sem depender do Docker ou alterar dados reais.
   */
  const clienteMock = {
    isReady: true,
    isOpen: true,

    connect: vi.fn(),
    close: vi.fn(),
    on: vi.fn(),

    eval: vi.fn(),
    mGet: vi.fn(),
    del: vi.fn(),
    ping: vi.fn(),
  };

  /**
   * Prepara o serviço e redefine os comportamentos dos mocks.
   */
  beforeEach(async () => {
    // Limpa o histórico de chamadas dos mocks.
    vi.clearAllMocks();

    // Simula uma conexão que já está disponível.
    clienteMock.isReady = true;
    clienteMock.isOpen = true;

    // Define as respostas padrão das operações Redis.
    clienteMock.eval.mockResolvedValue([1, 2]);
    clienteMock.mGet.mockResolvedValue(['3', null]);
    clienteMock.del.mockResolvedValue(1);
    clienteMock.ping.mockResolvedValue('PONG');

    // Cria o módulo de teste com o cliente Redis simulado.
    const modulo: TestingModule =
      await Test.createTestingModule({
        providers: [
          RedisService,
          {
            provide: REDIS_CLIENT,
            useValue: clienteMock,
          },
        ],
      }).compile();

    // Recupera o serviço criado pelo NestJS.
    service = modulo.get<RedisService>(RedisService);
  });

  /**
   * TESTE 1 — Inicialização.
   *
   * Confirma que o serviço pode ser criado pelo NestJS
   * e registra o listener para erros emitidos pelo Redis.
   */
  it('deve estar definido e registrar tratamento de erros', () => {
    expect(service).toBeDefined();

    expect(clienteMock.on).toHaveBeenCalledWith(
      'error',
      expect.any(Function),
    );
  });

  /**
   * TESTE 2 — Reserva identificada autorizada.
   *
   * Confirma que o Redis recebe:
   * - As chaves de controle.
   * - O identificador exclusivo da tentativa.
   * - Os limites individuais.
   * - O prazo de expiração.
   */
  it('deve autorizar reserva identificada quando todos os limites forem respeitados', async () => {
    clienteMock.eval.mockResolvedValueOnce(1);

    const resultado =
      await service.reservarTentativaIdentificada(
        ['chave-ip', 'chave-identidade'],
        'reserva-uuid-123',
        [120, 5],
        900,
      );

    expect(clienteMock.eval).toHaveBeenCalledWith(
      expect.stringContaining(
        "redis.call('SADD', chave, identificador)",
      ),
      {
        keys: ['chave-ip', 'chave-identidade'],
        arguments: [
          'reserva-uuid-123',
          '900',
          '120',
          '5',
        ],
      },
    );

    expect(resultado).toBe(true);
  });

  /**
   * TESTE 3 — Estrutura do script de reserva identificada.
   *
   * Confirma que o script:
   * - Consulta os membros dos Sets com SCARD.
   * - Verifica todos os limites antes de registrar a tentativa.
   * - Utiliza SADD com o identificador individual.
   * - Define expiração somente quando a chave ainda não possui TTL.
   *
   * Essa organização impede reservas parciais quando um limite
   * é ultrapassado.
   */
  it('deve verificar os limites antes de registrar os identificadores', async () => {
    await service.reservarTentativaIdentificada(
      ['chave-ip', 'chave-identidade'],
      'reserva-uuid-123',
      [120, 5],
      900,
    );

    const [script] = clienteMock.eval.mock.calls[0];

    expect(script).toContain("redis.call('SCARD', chave)");
    expect(script).toContain('if quantidade >= limite then');
    expect(script).toContain("redis.call('SADD', chave, identificador)");
    expect(script).toContain("redis.call('TTL', chave)");
    expect(script).toContain("redis.call('EXPIRE', chave, validade)");

    // A recusa deve acontecer antes de qualquer inclusão nos Sets.
    expect(script.indexOf('return 0')).toBeLessThan(
      script.indexOf("redis.call('SADD', chave, identificador)"),
    );
  });

  /**
   * TESTE 4 — Reserva identificada recusada.
   *
   * Confirma que o serviço reconhece quando algum limite
   * já foi atingido.
   */
  it('deve recusar reserva identificada quando algum limite for atingido', async () => {
    clienteMock.eval.mockResolvedValueOnce(0);

    const resultado =
      await service.reservarTentativaIdentificada(
        ['chave-ip', 'chave-identidade'],
        'reserva-uuid-123',
        [120, 5],
        900,
      );

    expect(resultado).toBe(false);
  });

  /**
   * TESTE 5 — Reserva identificada sem chaves.
   *
   * Impede a execução do script sem identificadores de controle.
   */
  it('deve rejeitar reserva identificada sem chaves', async () => {
    await expect(
      service.reservarTentativaIdentificada(
        [],
        'reserva-uuid-123',
        [],
        900,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(clienteMock.eval).not.toHaveBeenCalled();
  });

  /**
   * TESTE 6 — Chaves inválidas ou duplicadas.
   *
   * Evita executar uma reserva com chaves vazias ou repetidas,
   * o que poderia distorcer a contagem de tentativas.
   */
  it('deve rejeitar chaves vazias ou duplicadas na reserva identificada', async () => {
    await expect(
      service.reservarTentativaIdentificada(
        ['chave-ip', ''],
        'reserva-uuid-123',
        [120, 5],
        900,
      ),
    ).rejects.toThrow(
      'As chaves Redis devem ser válidas e únicas.',
    );

    await expect(
      service.reservarTentativaIdentificada(
        ['chave-ip', 'chave-ip'],
        'reserva-uuid-123',
        [120, 5],
        900,
      ),
    ).rejects.toThrow(
      'As chaves Redis devem ser válidas e únicas.',
    );

    expect(clienteMock.eval).not.toHaveBeenCalled();
  });

  /**
   * TESTE 7 — Identificador obrigatório.
   *
   * Impede a criação de uma reserva sem identidade individual.
   */
  it('deve rejeitar identificador vazio na reserva identificada', async () => {
    await expect(
      service.reservarTentativaIdentificada(
        ['chave-ip'],
        ' ',
        [120],
        900,
      ),
    ).rejects.toThrow(
      'Informe o identificador da tentativa de autenticação.',
    );

    expect(clienteMock.eval).not.toHaveBeenCalled();
  });

  /**
   * TESTE 8 — Quantidade de limites incorreta.
   *
   * Impede que uma chave seja utilizada sem seu limite correspondente.
   */
  it('deve rejeitar quantidade de limites diferente da quantidade de chaves identificadas', async () => {
    await expect(
      service.reservarTentativaIdentificada(
        ['chave-ip', 'chave-identidade'],
        'reserva-uuid-123',
        [120],
        900,
      ),
    ).rejects.toThrow(
      'A quantidade de limites deve corresponder à quantidade de chaves.',
    );

    expect(clienteMock.eval).not.toHaveBeenCalled();
  });

  /**
   * TESTE 9 — Limites inválidos.
   *
   * Aceita somente inteiros positivos e seguros para operações numéricas.
   */
  it('deve rejeitar limites inválidos na reserva identificada', async () => {
    for (const limite of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      await expect(
        service.reservarTentativaIdentificada(
          ['chave-ip'],
          'reserva-uuid-123',
          [limite],
          900,
        ),
      ).rejects.toThrow(
        'Todos os limites devem ser inteiros positivos.',
      );
    }

    expect(clienteMock.eval).not.toHaveBeenCalled();
  });

  /**
   * TESTE 10 — Validade inválida.
   *
   * Impede a criação de reservas sem prazo de expiração válido.
   */
  it('deve rejeitar validade inválida na reserva identificada', async () => {
    await expect(
      service.reservarTentativaIdentificada(
        ['chave-ip'],
        'reserva-uuid-123',
        [120],
        0,
      ),
    ).rejects.toThrow(
      'A validade dos contadores deve ser um inteiro positivo.',
    );

    expect(clienteMock.eval).not.toHaveBeenCalled();
  });

  /**
   * TESTE 11 — Liberação identificada.
   *
   * Confirma que o serviço encaminha somente as chaves
   * e o identificador da reserva que deve ser removida.
   */
  it('deve liberar somente o identificador da reserva informada', async () => {
    await service.liberarTentativaIdentificada(
      ['chave-ip', 'chave-identidade'],
      'reserva-uuid-123',
    );

    expect(clienteMock.eval).toHaveBeenCalledWith(
      expect.stringContaining(
        "redis.call('SREM', chave, identificador)",
      ),
      {
        keys: ['chave-ip', 'chave-identidade'],
        arguments: ['reserva-uuid-123'],
      },
    );
  });

  /**
   * TESTE 12 — Segurança da liberação identificada.
   *
   * Confirma que o script:
   * - Valida os tipos das chaves antes de alterar os conjuntos.
   * - Remove somente o membro informado por SREM.
   * - Exclui conjuntos vazios.
   *
   * Não existe decremento de contador compartilhado.
   */
  it('deve remover somente o identificador e preservar outras reservas', async () => {
    await service.liberarTentativaIdentificada(
      ['chave-ip', 'chave-identidade'],
      'reserva-antiga',
    );

    const [script] = clienteMock.eval.mock.calls[0];

    expect(script).toContain("redis.call('TYPE', chave).ok");
    expect(script).toContain("redis.call('SREM', chave, identificador)");
    expect(script).toContain("redis.call('SCARD', chave) == 0");
    expect(script).toContain("redis.call('DEL', chave)");
    expect(script).toContain("return redis.error_reply");

    // A remoção é individual; não utiliza decremento numérico.
    expect(script).not.toContain("redis.call('DECR', chave)");
  });

  /**
   * TESTE 13 — Liberação identificada sem chaves.
   *
   * Evita operações desnecessárias quando não há conjuntos associados.
   */
  it('deve ignorar liberação identificada quando não houver chaves', async () => {
    await service.liberarTentativaIdentificada(
      [],
      'reserva-uuid-123',
    );

    expect(clienteMock.eval).not.toHaveBeenCalled();
  });

  /**
   * TESTE 14 — Identificador obrigatório na liberação.
   *
   * Impede remover reservas com identificadores vazios.
   */
  it('deve rejeitar identificador vazio na liberação identificada', async () => {
    await expect(
      service.liberarTentativaIdentificada(
        ['chave-ip'],
        '',
      ),
    ).rejects.toThrow(
      'Informe o identificador da tentativa de autenticação.',
    );

    expect(clienteMock.eval).not.toHaveBeenCalled();
  });

  /**
   * TESTE 15 — Chaves inválidas na liberação.
   *
   * Evita executar uma remoção com chaves vazias ou duplicadas.
   */
  it('deve rejeitar chaves vazias ou duplicadas na liberação identificada', async () => {
    await expect(
      service.liberarTentativaIdentificada(
        ['chave-ip', ' '],
        'reserva-uuid-123',
      ),
    ).rejects.toThrow(
      'As chaves Redis devem ser válidas e únicas.',
    );

    await expect(
      service.liberarTentativaIdentificada(
        ['chave-ip', 'chave-ip'],
        'reserva-uuid-123',
      ),
    ).rejects.toThrow(
      'As chaves Redis devem ser válidas e únicas.',
    );

    expect(clienteMock.eval).not.toHaveBeenCalled();
  });

  /**
   * TESTE 16 — Reserva antiga já expirada.
   *
   * Representa a operação necessária para o cenário de concorrência:
   * a reserva antiga tenta remover seu identificador depois de expirar.
   *
   * A remoção individual não deve afetar outras reservas.
   * A execução real desse comportamento também foi verificada no Redis.
   */
  it('deve utilizar remoção individual mesmo quando a reserva não existir mais', async () => {
    await service.liberarTentativaIdentificada(
      ['chave-ip', 'chave-identidade'],
      'reserva-que-ja-expirou',
    );

    const [script, parametros] = clienteMock.eval.mock.calls[0];

    expect(script).toContain(
      "redis.call('SREM', chave, identificador)",
    );

    expect(parametros.arguments).toEqual([
      'reserva-que-ja-expirou',
    ]);

    // Não existe decremento que possa afetar uma reserva nova.
    expect(script).not.toContain("redis.call('DECR', chave)");
  });

  /**
   * TESTE 17 — Incremento genérico de contadores.
   *
   * Mantém a operação genérica que ainda está disponível no serviço.
   */
  it('deve incrementar vários contadores com validade definida', async () => {
    const resultado = await service.incrementarContadores(
      ['chave-1', 'chave-2'],
      900,
    );

    expect(clienteMock.eval).toHaveBeenCalledWith(
      expect.stringContaining('redis.call'),
      {
        keys: ['chave-1', 'chave-2'],
        arguments: ['900'],
      },
    );

    expect(resultado).toEqual([1, 2]);
  });

  /**
   * TESTE 18 — Consulta de contadores.
   *
   * Confirma que os valores devolvidos pelo Redis são convertidos
   * para números e que chaves inexistentes recebem valor zero.
   */
  it('deve consultar contadores e converter valores inexistentes para zero', async () => {
    const resultado = await service.obterContagens([
      'chave-1',
      'chave-2',
    ]);

    expect(clienteMock.mGet).toHaveBeenCalledWith([
      'chave-1',
      'chave-2',
    ]);

    expect(resultado).toEqual([3, 0]);
  });

  /**
   * TESTE 19 — Consulta vazia.
   *
   * Evita consultas desnecessárias quando não existem chaves.
   */
  it('deve retornar lista vazia sem consultar o Redis', async () => {
    const resultado = await service.obterContagens([]);

    expect(resultado).toEqual([]);
    expect(clienteMock.mGet).not.toHaveBeenCalled();
  });

  /**
   * TESTE 20 — Exclusão de chave.
   *
   * Confirma que a exclusão é encaminhada corretamente ao Redis.
   */
  it('deve excluir uma chave', async () => {
    await service.excluirChave('chave-1');

    expect(clienteMock.del).toHaveBeenCalledWith('chave-1');
  });

  /**
   * TESTE 21 — Verificação de conexão.
   *
   * Confirma que o método ping consegue consultar o servidor Redis.
   */
  it('deve executar o comando PING', async () => {
    const resultado = await service.ping();

    expect(resultado).toBe('PONG');
    expect(clienteMock.ping).toHaveBeenCalledOnce();
  });

  /**
   * TESTE 22 — Conexão sob demanda.
   *
   * Confirma que o serviço estabelece a conexão quando
   * uma operação é solicitada pela primeira vez.
   */
  it('deve conectar quando o cliente ainda não estiver aberto', async () => {
    clienteMock.isReady = false;
    clienteMock.isOpen = false;

    clienteMock.connect.mockImplementation(async () => {
      clienteMock.isReady = true;
      clienteMock.isOpen = true;
    });

    await service.ping();

    expect(clienteMock.connect).toHaveBeenCalledOnce();
    expect(clienteMock.ping).toHaveBeenCalledOnce();
  });

  /**
   * TESTE 23 — Conexão em andamento.
   *
   * Confirma que o serviço não tenta abrir outra conexão
   * quando o socket está aberto, mas ainda não está pronto.
   */
  it('deve rejeitar operações quando a conexão estiver reconectando', async () => {
    clienteMock.isReady = false;
    clienteMock.isOpen = true;

    await expect(
      service.ping(),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);

    expect(clienteMock.connect).not.toHaveBeenCalled();
    expect(clienteMock.ping).not.toHaveBeenCalled();
  });

  /**
   * TESTE 24 — Falha de conexão.
   *
   * Confirma que uma falha técnica é convertida em HTTP 503,
   * sem revelar detalhes internos do Redis.
   */
  it('deve tratar falha de conexão como serviço indisponível', async () => {
    clienteMock.isReady = false;
    clienteMock.isOpen = false;

    clienteMock.connect.mockRejectedValue(
      new Error('ECONNREFUSED'),
    );

    await expect(
      service.ping(),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);

    expect(clienteMock.ping).not.toHaveBeenCalled();
  });

  /**
   * TESTE 25 — Falha durante um comando.
   *
   * Confirma que erros de operações Redis também são convertidos
   * em uma resposta segura de indisponibilidade.
   */
  it('deve tratar falha na execução de um comando Redis', async () => {
    clienteMock.ping.mockRejectedValue(
      new Error('Socket fechado'),
    );

    await expect(
      service.ping(),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  /**
   * TESTE 26 — Incremento sem chaves.
   *
   * Impede executar um script sem identificadores.
   */
  it('deve rejeitar incremento sem chaves', async () => {
    await expect(
      service.incrementarContadores([], 900),
    ).rejects.toThrow(
      'Informe pelo menos uma chave Redis.',
    );

    expect(clienteMock.eval).not.toHaveBeenCalled();
  });

  /**
   * TESTE 27 — Validade inválida no incremento.
   *
   * Garante que o incremento genérico utilize um TTL positivo.
   */
  it('deve rejeitar prazo de expiração inválido', async () => {
    await expect(
      service.incrementarContadores(['chave-1'], 0),
    ).rejects.toThrow(
      'A validade dos contadores deve ser um inteiro positivo.',
    );

    expect(clienteMock.eval).not.toHaveBeenCalled();
  });

  /**
   * TESTE 28 — Encerramento da conexão.
   *
   * Confirma que o serviço fecha o cliente quando o NestJS
   * executa seu ciclo de encerramento.
   */
  it('deve encerrar a conexão Redis ao destruir o módulo', async () => {
    await service.onModuleDestroy();

    expect(clienteMock.close).toHaveBeenCalledOnce();
  });

  /**
   * TESTE 29 — Conexão já encerrada.
   *
   * Evita tentar fechar novamente um cliente que já está fechado.
   */
  it('não deve tentar fechar um cliente que já está fechado', async () => {
    clienteMock.isOpen = false;

    await service.onModuleDestroy();

    expect(clienteMock.close).not.toHaveBeenCalled();
  });
});
