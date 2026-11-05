
import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  ServiceUnavailableException,
} from '@nestjs/common';

import { createClient } from 'redis';

import { REDIS_CLIENT } from './redis.constants.js';

// Representa o tipo do cliente oficial do Node Redis.
type ClienteRedis = ReturnType<typeof createClient>;

/**
 * Reserva uma tentativa com identificador exclusivo.
 *
 * Primeiro verifica todos os limites, sem alterar nenhuma chave.
 * Se todos forem respeitados, registra o identificador em cada Set.
 *
 * A operação inteira é atômica dentro do Redis.
 */
const SCRIPT_RESERVAR_TENTATIVA_IDENTIFICADA = `
  local identificador = ARGV[1]
  local validade = tonumber(ARGV[2])

  -- Verifica todos os limites antes de modificar qualquer chave.
  for indice, chave in ipairs(KEYS) do
    local quantidade = redis.call('SCARD', chave)
    local limite = tonumber(ARGV[indice + 2])

    if quantidade >= limite then
      return 0
    end
  end

  -- Registra a tentativa somente depois de todos os limites aprovados.
  for _, chave in ipairs(KEYS) do
    redis.call('SADD', chave, identificador)

    -- Mantém a janela fixa iniciada na primeira reserva.
    -- Uma chave sem expiração recebe o prazo configurado.
    local ttlAtual = redis.call('TTL', chave)

    if ttlAtual < 0 then
      redis.call('EXPIRE', chave, validade)
    end
  end

  return 1
`;

/**
 * Libera exclusivamente uma tentativa identificada.
 *
 * A remoção utiliza SREM com o identificador da requisição.
 * Se a reserva antiga já expirou, sua remoção não afeta
 * identificadores registrados posteriormente.
 */
const SCRIPT_LIBERAR_TENTATIVA_IDENTIFICADA = `
  local identificador = ARGV[1]

  -- Valida os tipos de todas as chaves antes de realizar alterações.
  for _, chave in ipairs(KEYS) do
    local tipo = redis.call('TYPE', chave).ok

    if tipo ~= 'none' and tipo ~= 'set' then
      return redis.error_reply(
        'A chave Redis utilizada para o controle de tentativas possui tipo inválido.'
      )
    end
  end

  -- Remove somente o identificador pertencente à requisição atual.
  for _, chave in ipairs(KEYS) do
    redis.call('SREM', chave, identificador)

    -- Exclui conjuntos vazios para não manter chaves desnecessárias.
    if redis.call('SCARD', chave) == 0 then
      redis.call('DEL', chave)
    end
  end

  return 1
`;

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);

  /**
   * Compartilha a tentativa de conexão entre chamadas simultâneas.
   * Evita que várias requisições abram conexões ao mesmo tempo.
   */
  private tentativaConexao: Promise<void> | null = null;

  constructor(
    @Inject(REDIS_CLIENT)
    private readonly cliente: ClienteRedis,
  ) {
    /**
     * O Node Redis emite eventos de erro durante falhas de conexão.
     *
     * O listener registra os problemas internamente e evita
     * eventos de erro sem tratamento.
     */
    this.cliente.on('error', (erro) => {
      this.logger.error(
        'Falha na comunicação com o Redis.',
        erro instanceof Error ? erro.stack : undefined,
      );
    });
  }

  /**
   * RESERVA UMA TENTATIVA COM IDENTIFICADOR EXCLUSIVO.
   *
   * Cada requisição recebe um identificador próprio, armazenado
   * nos conjuntos Redis correspondentes ao IP e à identidade.
   *
   * Retorna:
   * - true: reserva autorizada.
   * - false: algum limite foi ultrapassado.
   *
   * A operação utiliza Sets para permitir que uma liberação
   * remova somente a tentativa que pertence àquela requisição.
   */
  async reservarTentativaIdentificada(
    chaves: string[],
    identificador: string,
    limites: number[],
    validadeSegundos: number,
  ): Promise<boolean> {
    // Exige pelo menos uma chave para executar a operação.
    if (chaves.length === 0) {
      throw new BadRequestException(
        'Informe pelo menos uma chave Redis.',
      );
    }

    // Impede chaves vazias ou duplicadas na mesma operação.
    if (
      chaves.some((chave) => !chave?.trim()) ||
      new Set(chaves).size !== chaves.length
    ) {
      throw new BadRequestException(
        'As chaves Redis devem ser válidas e únicas.',
      );
    }

    // Exige um identificador exclusivo para a tentativa atual.
    if (!identificador?.trim()) {
      throw new BadRequestException(
        'Informe o identificador da tentativa de autenticação.',
      );
    }

    // Cada chave precisa possuir exatamente um limite correspondente.
    if (chaves.length !== limites.length) {
      throw new BadRequestException(
        'A quantidade de limites deve corresponder à quantidade de chaves.',
      );
    }

    // Valida todos os limites antes de enviar os dados ao Redis.
    if (
      limites.some(
        (limite) =>
          !Number.isSafeInteger(limite) ||
          limite < 1,
      )
    ) {
      throw new BadRequestException(
        'Todos os limites devem ser inteiros positivos.',
      );
    }

    // Garante uma janela de expiração válida.
    if (
      !Number.isSafeInteger(validadeSegundos) ||
      validadeSegundos < 1
    ) {
      throw new BadRequestException(
        'A validade dos contadores deve ser um inteiro positivo.',
      );
    }

    return this.executar(async () => {
      /**
       * O script verifica todos os limites antes de registrar
       * o identificador em qualquer conjunto.
       *
       * Isso impede reservas parciais quando um limite é ultrapassado.
       */
      const resultado = await this.cliente.eval(
        SCRIPT_RESERVAR_TENTATIVA_IDENTIFICADA,
        {
          keys: chaves,
          arguments: [
            identificador.trim(),
            String(validadeSegundos),
            ...limites.map((limite) => String(limite)),
          ],
        },
      );

      // O Redis retorna 1 para autorização e 0 para bloqueio.
      return Number(resultado) === 1;
    });
  }

  /**
   * LIBERA SOMENTE UMA TENTATIVA IDENTIFICADA.
   *
   * Remove o identificador fornecido dos conjuntos associados
   * à requisição atual.
   *
   * Uma reserva antiga já expirada não consegue remover
   * uma nova tentativa que tenha sido registrada posteriormente.
   */
  async liberarTentativaIdentificada(
    chaves: string[],
    identificador: string,
  ): Promise<void> {
    // Não executa operações desnecessárias sem chaves.
    if (chaves.length === 0) {
      return;
    }

    // Evita executar a remoção com identificadores inválidos.
    if (!identificador?.trim()) {
      throw new BadRequestException(
        'Informe o identificador da tentativa de autenticação.',
      );
    }

    // Impede operações com chaves vazias ou duplicadas.
    if (
      chaves.some((chave) => !chave?.trim()) ||
      new Set(chaves).size !== chaves.length
    ) {
      throw new BadRequestException(
        'As chaves Redis devem ser válidas e únicas.',
      );
    }

    return this.executar(async () => {
      /**
       * O SREM remove somente o membro informado.
       *
       * Se ele não existir porque a reserva expirou, nenhuma
       * outra tentativa será decrementada ou removida.
       */
      await this.cliente.eval(
        SCRIPT_LIBERAR_TENTATIVA_IDENTIFICADA,
        {
          keys: chaves,
          arguments: [identificador.trim()],
        },
      );
    });
  }

  /**
   * INCREMENTA CONTADORES COM EXPIRAÇÃO.
   *
   * Mantido como operação genérica para outros controles futuros.
   * Todas as chaves recebem o mesmo período de expiração,
   * iniciado somente na primeira incrementação.
   */
  async incrementarContadores(
    chaves: string[],
    validadeSegundos: number,
  ): Promise<number[]> {
    // Impede a execução de um script sem chaves válidas.
    if (chaves.length === 0) {
      throw new BadRequestException(
        'Informe pelo menos uma chave Redis.',
      );
    }

    // Garante que a expiração seja um inteiro positivo.
    if (
      !Number.isInteger(validadeSegundos) ||
      validadeSegundos < 1
    ) {
      throw new BadRequestException(
        'A validade dos contadores deve ser um inteiro positivo.',
      );
    }

    return this.executar(async () => {
      const resultado = await this.cliente.eval(
        `
          local resultados = {}

          for indice, chave in ipairs(KEYS) do
            local quantidade = redis.call('INCR', chave)

            if quantidade == 1 then
              redis.call('EXPIRE', chave, ARGV[1])
            end

            table.insert(resultados, quantidade)
          end

          return resultados
        `,
        {
          keys: chaves,
          arguments: [String(validadeSegundos)],
        },
      );

      // Confirma que o script retornou uma lista.
      if (!Array.isArray(resultado)) {
        throw new Error(
          'O Redis retornou um resultado inesperado ao incrementar contadores.',
        );
      }

      // Converte os resultados para números.
      return resultado.map((valor) => Number(valor));
    });
  }

  /**
   * CONSULTA CONTADORES.
   *
   * Recupera os valores atuais de várias chaves em uma única operação.
   * Chaves ainda inexistentes são representadas pelo valor zero.
   */
  async obterContagens(chaves: string[]): Promise<number[]> {
    // Uma lista vazia não precisa gerar uma consulta.
    if (chaves.length === 0) {
      return [];
    }

    return this.executar(async () => {
      // MGET consulta várias chaves em uma única operação.
      const resultados = await this.cliente.mGet(chaves);

      // Converte valores existentes e trata chaves inexistentes.
      return resultados.map((valor) => {
        const quantidade = Number(valor ?? 0);

        if (
          !Number.isSafeInteger(quantidade) ||
          quantidade < 0
        ) {
          throw new Error(
            'O Redis retornou um contador inválido.',
          );
        }

        return quantidade;
      });
    });
  }

  /**
   * EXCLUI UMA CHAVE.
   *
   * Mantido para operações que realmente necessitem excluir
   * uma chave Redis específica.
   */
  async excluirChave(chave: string): Promise<void> {
    await this.executar(async () => {
      await this.cliente.del(chave);
    });
  }

  /**
   * TESTA A CONEXÃO.
   *
   * Também pode ser utilizado futuramente por verificações
   * de disponibilidade da infraestrutura.
   */
  async ping(): Promise<string> {
    return this.executar(async () => {
      return this.cliente.ping();
    });
  }

  /**
   * ENCERRA A CONEXÃO QUANDO A APLICAÇÃO É DESLIGADA.
   *
   * Evita deixar sockets abertos durante o encerramento do NestJS.
   */
  async onModuleDestroy(): Promise<void> {
    if (!this.cliente.isOpen) {
      return;
    }

    try {
      await this.cliente.close();
    } catch (erro) {
      this.logger.warn(
        'Não foi possível encerrar normalmente a conexão Redis.',
        erro instanceof Error ? erro.message : undefined,
      );
    }
  }

  /**
   * GARANTE QUE O CLIENTE ESTEJA CONECTADO.
   *
   * A conexão acontece somente quando uma operação realmente
   * precisa acessar o Redis.
   */
  private async garantirConexao(): Promise<void> {
    // Não inicia conexão quando o cliente já está pronto.
    if (this.cliente.isReady) {
      return;
    }

    // Reutiliza uma tentativa de conexão que já esteja em andamento.
    if (this.tentativaConexao) {
      return this.tentativaConexao;
    }

    /**
     * Se o socket já estiver aberto, mas ainda não estiver pronto,
     * significa que o cliente está conectando ou reconectando.
     *
     * Não iniciamos outra conexão em paralelo.
     */
    if (this.cliente.isOpen) {
      throw new ServiceUnavailableException(
        'O serviço de autenticação está temporariamente indisponível.',
      );
    }

    // Inicia uma única tentativa de conexão com o Redis.
    this.tentativaConexao = this.cliente
      .connect()
      .then(() => {
        // Confirma que a conexão realmente ficou pronta.
        if (!this.cliente.isReady) {
          throw new Error(
            'A conexão Redis não ficou pronta após conectar.',
          );
        }
      })
      .catch((erro: unknown) => {
        this.logger.error(
          'Não foi possível conectar ao Redis.',
          erro instanceof Error ? erro.stack : undefined,
        );

        throw new ServiceUnavailableException(
          'O serviço de autenticação está temporariamente indisponível.',
        );
      })
      .finally(() => {
        // Libera o controle para permitir novas tentativas.
        this.tentativaConexao = null;
      });

    return this.tentativaConexao;
  }

  /**
   * EXECUTA UMA OPERAÇÃO REDIS COM TRATAMENTO CENTRALIZADO.
   *
   * Impede que detalhes internos da infraestrutura sejam
   * enviados diretamente nas respostas HTTP.
   */
  private async executar<T>(
    operacao: () => Promise<T>,
  ): Promise<T> {
    try {
      // Garante uma conexão válida antes de executar o comando.
      await this.garantirConexao();

      // Executa a operação solicitada.
      return await operacao();
    } catch (erro) {
      // Preserva erros de indisponibilidade já padronizados.
      if (erro instanceof ServiceUnavailableException) {
        throw erro;
      }

      // Registra os detalhes técnicos internamente.
      this.logger.error(
        'Falha ao executar uma operação no Redis.',
        erro instanceof Error ? erro.stack : undefined,
      );

      // Retorna uma resposta segura ao cliente HTTP.
      throw new ServiceUnavailableException(
        'O serviço de autenticação está temporariamente indisponível.',
      );
    }
  }
}
