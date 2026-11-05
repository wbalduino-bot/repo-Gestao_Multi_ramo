
import type {
  LoggerService as NestLoggerService,
  OnApplicationShutdown,
} from '@nestjs/common';

import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';

import fs from 'node:fs';
import path from 'node:path';

/**
 * CONFIGURAÇÕES DO LOGGER
 *
 * Permitem personalizar os diretórios, níveis e limites dos arquivos
 * sem alterar a implementação do serviço.
 *
 * As opções também facilitam o isolamento dos arquivos nos testes.
 */
export interface ConfiguracaoLogger {
  diretorio?: string;
  nivel?: string;
  tamanhoMaximo?: string;
  retencao?: string;
  habilitarConsole?: boolean;
  habilitarArquivos?: boolean;
}

/**
 * CATEGORIAS DOS REGISTROS
 *
 * A aplicação e os eventos de segurança são separados para permitir
 * consultas técnicas mais direcionadas.
 *
 * A categoria de segurança somente é utilizada quando um módulo
 * chama explicitamente o método registrarSeguranca().
 */
type CategoriaLog = 'aplicacao' | 'seguranca';

/**
 * NÍVEIS PERMITIDOS PARA REGISTROS DE SEGURANÇA.
 */
type NivelSeguranca = 'info' | 'warn' | 'error';

/**
 * IDENTIFICAÇÃO DE PROPRIEDADES QUE PODEM CONTER SEGREDOS
 *
 * Os valores dessas propriedades são substituídos antes da gravação.
 * A proteção também reconhece variações em camelCase, snake_case
 * e nomes separados por hífen.
 */
const CAMPOS_SENSIVEIS =
  /senha|password|token|secret|segredo|authorization|cookie|credential|credencial|api[_-]?key|private[_-]?key|access[_-]?key|refresh[_-]?key/i;

/**
 * PROTEÇÃO CONTRA CREDENCIAIS EM MENSAGENS DE TEXTO
 *
 * Detecta credenciais que eventualmente apareçam em mensagens,
 * parâmetros, justificativas ou detalhes de exceções.
 */
const CREDENCIAIS_TEXTO_REGEX =
  /\b(password|passwd|senha|token|secret|segredo|api[_-]?key|client[_-]?secret|authorization|cookie|credential|credencial|refresh[_-]?token|access[_-]?token)\b(["']?\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s,;&]+)/gi;

/**
 * IDENTIFICAÇÃO DE TOKENS BEARER
 *
 * Evita que tokens JWT ou outras credenciais Bearer sejam mantidos
 * quando aparecem acidentalmente em mensagens de log.
 */
const TOKEN_BEARER_REGEX = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;

/**
 * IDENTIFICAÇÃO DE TOKENS JWT
 *
 * Remove tokens JWT completos quando aparecem em textos livres.
 */
const TOKEN_JWT_REGEX =
  /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\b/g;

/**
 * IDENTIFICAÇÃO DE SENHAS EM URLS DE CONEXÃO
 *
 * Exemplo:
 * postgresql://usuario:senha@servidor:5432/banco
 *
 * A senha é substituída sem expor as demais informações da conexão.
 */
const SENHA_URL_REGEX =
  /\b(postgres(?:ql)?|mysql|mongodb(?:\+srv)?):\/\/([^:\s/@]+):([^@\s/]+)@/gi;

/**
 * LIMITES DA SANITIZAÇÃO
 *
 * Evitam que objetos muito grandes, profundos ou cíclicos provoquem
 * consumo excessivo de memória durante a geração dos logs.
 */
const LIMITE_PROFUNDIDADE = 8;
const LIMITE_PROPRIEDADES = 100;
const LIMITE_ITENS_ARRAY = 100;
const LIMITE_TEXTO = 4000;

/**
 * SANITIZAÇÃO DE TEXTOS
 *
 * Remove credenciais conhecidas e limita o tamanho das mensagens.
 */
function sanitizarTexto(valor: string): string {
  return valor
    .replace(TOKEN_BEARER_REGEX, 'Bearer [REDACTED]')
    .replace(TOKEN_JWT_REGEX, '[REDACTED_JWT]')
    .replace(CREDENCIAIS_TEXTO_REGEX, '$1$2[REDACTED]')
    .replace(SENHA_URL_REGEX, '$1://$2:[REDACTED]@')
    .slice(0, LIMITE_TEXTO);
}

/**
 * SANITIZAÇÃO RECURSIVA DE DADOS
 *
 * Protege estruturas recebidas pelo logger antes de encaminhá-las
 * para o Winston.
 *
 * Também trata datas, erros, valores especiais, arrays grandes
 * e referências circulares.
 */
function sanitizarValor(
  valor: unknown,
  profundidade = 0,
  referencias = new WeakSet<object>(),
): unknown {
  if (valor === null || valor === undefined) {
    return valor;
  }

  if (typeof valor === 'string') {
    return sanitizarTexto(valor);
  }

  if (
    typeof valor === 'number' ||
    typeof valor === 'boolean'
  ) {
    return valor;
  }

  if (typeof valor === 'bigint') {
    return valor.toString();
  }

  if (typeof valor === 'function') {
    return '[FUNCTION_OMITTED]';
  }

  if (typeof valor === 'symbol') {
    return valor.toString();
  }

  if (profundidade >= LIMITE_PROFUNDIDADE) {
    return '[MAX_DEPTH_REACHED]';
  }

  if (Buffer.isBuffer(valor)) {
    return '[BINARY_DATA_OMITTED]';
  }

  if (valor instanceof Date) {
    return Number.isNaN(valor.getTime())
      ? '[INVALID_DATE]'
      : valor.toISOString();
  }

  if (referencias.has(valor)) {
    return '[CIRCULAR_REFERENCE]';
  }

  referencias.add(valor);

  try {
    /**
     * Exceções são convertidas em objetos controlados.
     *
     * Isso permite preservar a mensagem e a stack trace sem deixar
     * de aplicar a proteção contra credenciais.
     */
    if (valor instanceof Error) {
      const erro = valor as Error & { cause?: unknown };

      return {
        name: sanitizarTexto(erro.name),
        message: sanitizarTexto(erro.message),
        ...(erro.stack
          ? { stack: sanitizarTexto(erro.stack) }
          : {}),
        ...(erro.cause !== undefined
          ? {
              cause: sanitizarValor(
                erro.cause,
                profundidade + 1,
                referencias,
              ),
            }
          : {}),
      };
    }

    if (Array.isArray(valor)) {
      return valor
        .slice(0, LIMITE_ITENS_ARRAY)
        .map((item) =>
          sanitizarValor(item, profundidade + 1, referencias),
        );
    }

    /**
     * Objetos são reconstruídos propriedade por propriedade.
     *
     * Campos com nomes sensíveis recebem [REDACTED], sem expor
     * o conteúdo original.
     */
    if (typeof valor === 'object') {
      const objeto = valor as Record<string, unknown>;
      const resultado: Record<string, unknown> = {};

      for (const [chave, conteudo] of Object.entries(objeto).slice(
        0,
        LIMITE_PROPRIEDADES,
      )) {
        if (CAMPOS_SENSIVEIS.test(chave)) {
          resultado[chave] = '[REDACTED]';
          continue;
        }

        const valorSanitizado = sanitizarValor(
          conteudo,
          profundidade + 1,
          referencias,
        );

        if (valorSanitizado !== undefined) {
          resultado[chave] = valorSanitizado;
        }
      }

      return resultado;
    }

    // Os tipos usuais já foram tratados; evita coerção implícita de objetos inesperados.
    return '[UNSUPPORTED_VALUE]';
  } catch {
    // Objetos com getters ou estruturas incompatíveis não interrompem o log.
    return '[UNSERIALIZABLE_VALUE]';
  } finally {
    referencias.delete(valor);
  }
}

/**
 * CONVERSÃO SEGURA DE MENSAGENS PARA TEXTO
 *
 * O Winston utiliza a propriedade message como mensagem principal.
 * Quando a origem for um objeto ou uma exceção, seu conteúdo sanitizado
 * também é preservado no campo detalhes.
 */
function converterMensagem(valor: unknown): string {
  if (typeof valor === 'string') {
    return sanitizarTexto(valor);
  }

  if (valor instanceof Error) {
    return sanitizarTexto(`${valor.name}: ${valor.message}`);
  }

  const seguro = sanitizarValor(valor);

  try {
    return JSON.stringify(seguro) ?? '[EMPTY_MESSAGE]';
  } catch {
    return '[MESSAGE_CONVERSION_FAILED]';
  }
}

/**
 * LOGGER CENTRAL DA APLICAÇÃO
 *
 * Implementa a interface LoggerService do NestJS.
 *
 * Os serviços que já utilizam o Logger nativo poderão continuar
 * funcionando sem precisar conhecer o Winston.
 *
 * Os registros são encaminhados para:
 * - Console: saída do terminal.
 * - Application: registros gerais.
 * - Errors: erros e exceções.
 * - Security: eventos explicitamente classificados como segurança.
 */
export class AplicacaoLogger implements NestLoggerService, OnApplicationShutdown {
  private readonly instancia: winston.Logger;

  // Referências necessárias para finalizar os fluxos físicos dos arquivos.
  private readonly transportesArquivo: DailyRotateFile[];

  private provedorTraceId?: () => string | null;

  // Compartilha a mesma finalização entre chamadas concorrentes.
  private encerramento: Promise<void> | null = null;

  /**
   * Inicializa os transportes do Winston.
   *
   * As configurações podem vir das variáveis de ambiente ou ser
   * fornecidas diretamente, como acontece nos testes.
   */
  constructor(configuracao: ConfiguracaoLogger = {}) {
    const diretorio = path.resolve(
      configuracao.diretorio ??
        process.env.LOG_DIR ??
        path.join(process.cwd(), 'logs'),
    );

    const nivelInformacao = (
      configuracao.nivel ??
      process.env.LOG_LEVEL ??
      'info'
    ).toLowerCase();

    const niveisValidos = Object.keys(winston.config.npm.levels);

    const nivel =
      niveisValidos.includes(nivelInformacao)
        ? nivelInformacao
        : 'info';

    const tamanhoMaximo =
      configuracao.tamanhoMaximo ??
      process.env.LOG_MAX_SIZE ??
      '20m';

    const retencao =
      configuracao.retencao ??
      process.env.LOG_RETENTION ??
      '30d';

    const habilitarConsole =
      configuracao.habilitarConsole ??
      process.env.LOG_CONSOLE !== 'false';

    const habilitarArquivos =
      configuracao.habilitarArquivos ?? true;

    /**
     * O formato JSON facilita a pesquisa automática por nível,
     * módulo, data, categoria e identificador de rastreamento.
     */
    const formatoEstruturado = winston.format.combine(
      winston.format.timestamp(),
      winston.format.json(),
    );

    const transportes: winston.transport[] = [];

    if (habilitarConsole) {
      transportes.push(
        new winston.transports.Console({
          level: nivel,
          format: formatoEstruturado,
        }),
      );
    }

    if (habilitarArquivos) {
      // Garante a existência dos diretórios antes de iniciar os transportes.
      for (const subdiretorio of [
        'application',
        'errors',
        'security',
      ]) {
        fs.mkdirSync(path.join(diretorio, subdiretorio), {
          recursive: true,
        });
      }

      /**
       * ARQUIVO DE APLICAÇÃO
       *
       * Recebe os registros gerais, mas não duplica os eventos
       * classificados explicitamente como segurança.
       */
      const somenteAplicacao = winston.format((informacao) =>
        informacao.categoria === 'seguranca'
          ? false
          : informacao,
      );

      transportes.push(
        new DailyRotateFile({
          dirname: path.join(diretorio, 'application'),
          filename: 'application-%DATE%.log',
          datePattern: 'YYYY-MM-DD',
          maxSize: tamanhoMaximo,
          maxFiles: retencao,
          zippedArchive: true,
          level: nivel,
          format: somenteAplicacao(),
        }),
      );

      /**
       * ARQUIVO DE ERROS
       *
       * Recebe somente o nível error, independentemente da categoria.
       * Assim, falhas técnicas e falhas de segurança também ficam
       * disponíveis para diagnóstico centralizado.
       */
      transportes.push(
        new DailyRotateFile({
          dirname: path.join(diretorio, 'errors'),
          filename: 'error-%DATE%.log',
          datePattern: 'YYYY-MM-DD',
          maxSize: tamanhoMaximo,
          maxFiles: retencao,
          zippedArchive: true,
          level: 'error',
        }),
      );

      /**
       * ARQUIVO DE SEGURANÇA
       *
       * Recebe somente mensagens encaminhadas por registrarSeguranca().
       */
      const somenteSeguranca = winston.format((informacao) =>
        informacao.categoria === 'seguranca'
          ? informacao
          : false,
      );

      transportes.push(
        new DailyRotateFile({
          dirname: path.join(diretorio, 'security'),
          filename: 'security-%DATE%.log',
          datePattern: 'YYYY-MM-DD',
          maxSize: tamanhoMaximo,
          maxFiles: retencao,
          zippedArchive: true,
          level: nivel,
          format: somenteSeguranca(),
        }),
      );
    }

    this.transportesArquivo = transportes.filter(
      (transporte): transporte is DailyRotateFile =>
        transporte instanceof DailyRotateFile,
    );

    this.instancia = winston.createLogger({
      level: nivel,
      format: formatoEstruturado,
      defaultMeta: {
        service: 'apps-api',
      },
      transports: transportes,
      exitOnError: false,
    });

    /**
     * Fallback para falhas internas dos transportes.
     *
     * Evita que uma falha de escrita no arquivo gere um ciclo de logs
     * ou uma exceção não tratada dentro do próprio logger.
     */
    this.instancia.on('error', (erro: Error) => {
      process.stderr.write(
        `[LOGGER_FAILURE] ${sanitizarTexto(erro.message)}\n`,
      );
    });
  }

  /**
   * CONEXÃO COM O RASTREAMENTO DO OBSERVE
   *
   * O main.ts poderá fornecer uma função que consulta
   * TracerService.currentTraceId().
   *
   * Dessa forma, o logger não precisa depender diretamente
   * do módulo de observabilidade.
   */
  definirProvedorTraceId(
    provedor: () => string | null,
  ): void {
    this.provedorTraceId = provedor;
  }

  /**
   * REGISTRO PADRÃO DO NESTJS
   */
  log(mensagem: unknown, ...parametros: unknown[]): void {
    this.escrever('info', mensagem, parametros);
  }

  /**
   * REGISTRO DE ERROS
   */
  error(mensagem: unknown, ...parametros: unknown[]): void {
    this.escrever('error', mensagem, parametros);
  }

  /**
   * REGISTRO DE AVISOS
   */
  warn(mensagem: unknown, ...parametros: unknown[]): void {
    this.escrever('warn', mensagem, parametros);
  }

  /**
   * REGISTRO DE DEBUG
   */
  debug?(mensagem: unknown, ...parametros: unknown[]): void {
    this.escrever('debug', mensagem, parametros);
  }

  /**
   * REGISTRO DETALHADO
   */
  verbose?(mensagem: unknown, ...parametros: unknown[]): void {
    this.escrever('verbose', mensagem, parametros);
  }

  /**
   * REGISTRO DE FALHAS CRÍTICAS
   *
   * O nível original é preservado no conteúdo do evento, enquanto
   * a severidade do Winston utiliza error para garantir sua gravação
   * também no arquivo de erros.
   */
  fatal?(mensagem: unknown, ...parametros: unknown[]): void {
    this.escrever('error', mensagem, parametros, 'aplicacao', {
      nivelOriginal: 'fatal',
    });
  }

  /**
   * REGISTRO EXPLÍCITO DE EVENTOS DE SEGURANÇA
   *
   * Este método será utilizado futuramente pelos módulos de autenticação,
   * bloqueio de acesso e proteção da plataforma.
   *
   * Ele não substitui o AuditoriaService nem grava eventos comerciais.
   */
  registrarSeguranca(
    mensagem: unknown,
    metadados?: Record<string, unknown>,
    nivel: NivelSeguranca = 'info',
  ): void {
    this.escrever(
      nivel,
      mensagem,
      metadados ? [metadados] : [],
      'seguranca',
    );
  }

  /**
   * IMPLEMENTAÇÃO CENTRAL DA ESCRITA
   *
   * Todos os níveis passam pela mesma sanitização e recebem:
   * - Serviço de origem.
   * - Data e hora.
   * - Categoria.
   * - Identificador de rastreamento, quando disponível.
   * - Parâmetros adicionais sanitizados.
   */
  private escrever(
    nivel: string,
    mensagem: unknown,
    parametros: unknown[] = [],
    categoria: CategoriaLog = 'aplicacao',
    camposAdicionais: Record<string, unknown> = {},
  ): void {
    const mensagemSegura = sanitizarValor(mensagem);

    const dados: Record<string, unknown> = {
      categoria,
      ...camposAdicionais,
    };

    /**
     * Preserva objetos e exceções como detalhes estruturados,
     * evitando perder informações úteis para diagnóstico.
     */
    if (
      mensagemSegura !== null &&
      typeof mensagemSegura === 'object'
    ) {
      dados.detalhes = mensagemSegura;
    }

    if (parametros.length > 0) {
      dados.parametros = sanitizarValor(parametros);
    }

    /**
     * Recupera o identificador da requisição no contexto atual.
     *
     * A consulta é protegida porque chamadas feitas fora de uma
     * requisição HTTP podem não possuir contexto de rastreamento.
     */
    if (this.provedorTraceId) {
      try {
        const traceId = this.provedorTraceId();

        if (traceId) {
          dados.traceId = sanitizarTexto(traceId);
        }
      } catch {
        // A ausência do contexto de rastreamento não impede o registro.
      }
    }

    this.instancia.log({
      level: nivel,
      message: converterMensagem(mensagem),
      ...dados,
    });
  }

  /**
   * ENCERRAMENTO CONTROLADO
   *
   * Permite aguardar a finalização dos transportes, principalmente
   * em testes e durante um encerramento controlado da aplicação.
   */
  /**
   * O NestJS chama este método durante o desligamento da aplicação.
   * O logger aguarda a gravação dos registros pendentes.
   */
  async onApplicationShutdown(): Promise<void> {
    await this.encerrar();
  }

  /**
   * Finalização idempotente: chamadas simultâneas compartilham
   * a mesma promessa e não encerram os transports duas vezes.
   */
  async encerrar(): Promise<void> {
    if (!this.encerramento) {
      this.encerramento = this.finalizarTransportes();
    }

    await this.encerramento;
  }

  private async finalizarTransportes(): Promise<void> {
    // Primeiro aguarda o Winston entregar todas as mensagens aos transports.
    await new Promise<void>((resolve, rejeitar) => {
      const aoFinalizar = () => {
        this.instancia.removeListener('error', aoFalhar);
        resolve();
      };

      const aoFalhar = (erro: Error) => {
        this.instancia.removeListener('finish', aoFinalizar);
        rejeitar(erro);
      };

      this.instancia.once('finish', aoFinalizar);
      this.instancia.once('error', aoFalhar);
      this.instancia.end();
    });

    /**
     * O DailyRotateFile confirma o recebimento da mensagem antes de
     * concluir a escrita física no arquivo. Por isso, também precisamos
     * encerrar seu fluxo interno e aguardar o callback de finalização.
     */
    await Promise.all(
      this.transportesArquivo.map((transporte) =>
        new Promise<void>((resolve, rejeitar) => {
          const fluxo = transporte.logStream;

          const aoFalhar = (erro: Error) => {
            fluxo.removeListener('error', aoFalhar);
            rejeitar(erro);
          };

          fluxo.once('error', aoFalhar);

          fluxo.end(() => {
            fluxo.removeListener('error', aoFalhar);
            resolve();
          });
        }),
      ),
    );
  }
}
