
import {
  HttpException,
  HttpStatus,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';

import { createHash, randomUUID } from 'node:crypto';

import { RedisService } from '../redis/redis.service.js';

/**
 * Representa uma tentativa de autenticação reservada no Redis.
 *
 * A reserva é individual e possui um identificador exclusivo.
 *
 * Ela deve ser liberada quando:
 * - O login termina com sucesso.
 * - Ocorre uma falha interna durante a autenticação.
 *
 * Quando as credenciais são incorretas, a reserva permanece
 * contabilizada até a expiração da janela configurada.
 */
export interface ReservaTentativaLogin {
  liberar(): Promise<void>;
}

/**
 * Lê e valida configurações numéricas do ambiente.
 *
 * Impede valores inválidos de desabilitarem acidentalmente
 * a proteção contra tentativas excessivas de autenticação.
 */
function obterConfiguracaoInteira(
  nome: string,
  valorPadrao: number,
  valorMaximo: number,
): number {
  const valor = process.env[nome]?.trim();

  // Utiliza o valor padrão quando a variável não foi configurada.
  if (!valor) {
    return valorPadrao;
  }

  const numero = Number(valor);

  // Aceita somente números inteiros positivos dentro do limite permitido.
  if (
    !Number.isSafeInteger(numero) ||
    numero < 1 ||
    numero > valorMaximo
  ) {
    throw new Error(
      `A configuração ${nome} deve ser um inteiro entre 1 e ${valorMaximo}.`,
    );
  }

  return numero;
}

@Injectable()
export class LoginRateLimitService {
  /**
   * Janela de controle dos conjuntos Redis.
   * Padrão: 15 minutos.
   */
  private readonly janelaSegundos =
    obterConfiguracaoInteira(
      'AUTH_LOGIN_JANELA_SEGUNDOS',
      900,
      86400,
    );

  /**
   * Limite compartilhado por endereço IP.
   *
   * Considera que vários funcionários podem utilizar
   * a aplicação por trás do mesmo roteador empresarial.
   */
  private readonly limitePorIp =
    obterConfiguracaoInteira(
      'AUTH_LOGIN_LIMITE_IP',
      120,
      100000,
    );

  /**
   * Limite específico da combinação empresa, e-mail e IP.
   *
   * Não existe bloqueio global somente pelo e-mail.
   * Isso evita que terceiros provoquem bloqueios deliberados
   * de contas de funcionários.
   */
  private readonly limitePorIdentidadeIp =
    obterConfiguracaoInteira(
      'AUTH_LOGIN_LIMITE_IDENTIDADE_IP',
      5,
      10000,
    );

  constructor(
    private readonly redis: RedisService,
  ) {}

  /**
   * RESERVA UMA TENTATIVA INDIVIDUAL DE AUTENTICAÇÃO.
   *
   * Cada requisição recebe um UUID exclusivo.
   *
   * O Redis registra esse identificador nos conjuntos:
   * - Controle geral do endereço IP.
   * - Controle específico da empresa, e-mail e IP.
   *
   * A reserva é atômica e respeita os dois limites configurados.
   *
   * Retorna um objeto capaz de liberar exclusivamente
   * o identificador desta requisição.
   */
  async reservarTentativa(
    empresaId: string,
    email: string,
    ip: string,
  ): Promise<ReservaTentativaLogin> {
    // Exige os dados necessários para identificar a origem da tentativa.
    if (
      !empresaId?.trim() ||
      !email?.trim() ||
      !ip?.trim()
    ) {
      throw new ServiceUnavailableException(
        'Não foi possível validar a origem da tentativa de autenticação.',
      );
    }

    // Normaliza os identificadores antes de gerar as chaves.
    const empresaNormalizada = empresaId.trim();
    const emailNormalizado = email.trim().toLowerCase();
    const ipNormalizado = ip.trim();

    // Cria uma chave independente para todas as tentativas daquele IP.
    const chaveIp = this.criarChaveIp(ipNormalizado);

    // Cria uma chave específica para empresa, e-mail e IP.
    const chaveIdentidade = this.criarChaveIdentidade(
      empresaNormalizada,
      emailNormalizado,
      ipNormalizado,
    );

    // Agrupa as duas chaves para executar a reserva atomicamente.
    const chaves = [
      chaveIp,
      chaveIdentidade,
    ];

    // Aplica um limite independente para cada conjunto.
    const limites = [
      this.limitePorIp,
      this.limitePorIdentidadeIp,
    ];

    // Gera uma identidade exclusiva para a requisição atual.
    const identificador = randomUUID();

    /**
     * O Redis verifica os limites e registra o UUID nos dois
     * conjuntos em uma única execução de script Lua.
     */
    const autorizada =
      await this.redis.reservarTentativaIdentificada(
        chaves,
        identificador,
        limites,
        this.janelaSegundos,
      );

    // Responde com HTTP 429 quando a reserva não é autorizada.
    if (!autorizada) {
      throw new HttpException(
        'Muitas tentativas de acesso. Aguarde antes de tentar novamente.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    /**
     * Controla o estado da liberação desta reserva.
     *
     * Como SREM é idempotente, uma tentativa de liberação
     * pode ser repetida com segurança quando houver falha
     * de comunicação com o Redis.
     */
    let liberacaoConcluida = false;
    let liberacaoEmAndamento: Promise<void> | null = null;

    return {
      liberar: async () => {
        // Uma reserva já liberada não precisa de outra operação.
        if (liberacaoConcluida) {
          return;
        }

        /**
         * Compartilha uma operação de liberação que já esteja
         * em andamento, evitando chamadas duplicadas simultâneas.
         */
        if (!liberacaoEmAndamento) {
          liberacaoEmAndamento =
            this.redis.liberarTentativaIdentificada(
              chaves,
              identificador,
            )
              .then(() => {
                // Marca a reserva como liberada somente após confirmação.
                liberacaoConcluida = true;
              })
              .finally(() => {
                // Permite nova tentativa caso a operação tenha falhado.
                liberacaoEmAndamento = null;
              });
        }

        // Aguarda a liberação compartilhada e propaga eventual falha.
        await liberacaoEmAndamento;
      },
    };
  }

  /**
   * Gera uma chave de controle por endereço IP.
   *
   * O prefixo v2 separa os novos Redis Sets dos contadores
   * numéricos da implementação anterior.
   *
   * O hash evita armazenar diretamente o endereço IP
   * no nome das chaves Redis.
   */
  private criarChaveIp(ip: string): string {
    return `gestao:auth:login:v2:ip:${this.gerarHash(ip)}`;
  }

  /**
   * Gera uma chave específica para empresa, e-mail e IP.
   *
   * O separador nulo evita ambiguidades na composição
   * dos identificadores utilizados no hash.
   */
  private criarChaveIdentidade(
    empresaId: string,
    email: string,
    ip: string,
  ): string {
    const identificador = [
      empresaId,
      email,
      ip,
    ].join('\0');

    return `gestao:auth:login:v2:identidade:${this.gerarHash(identificador)}`;
  }

  /**
   * Gera identificadores SHA-256 para as chaves Redis.
   *
   * Evita expor informações identificáveis nos nomes das chaves.
   */
  private gerarHash(valor: string): string {
    return createHash('sha256')
      .update(valor)
      .digest('hex');
  }
}
