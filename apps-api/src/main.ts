import { NestFactory } from '@nestjs/core';
import { TracerService } from '@nestjs/observe';

import {
  AppModule,
  ObserveInstrument,
} from './app.module.js';

import { configurarAplicacao } from './configurar-aplicacao.js';
import { AplicacaoLogger } from './logging/logger.service.js';

/**
 * Inicializa a API e aplica as configurações de infraestrutura.
 *
 * O Winston será utilizado como logger central, gravando os registros
 * no terminal e em arquivos locais.
 *
 * O identificador de rastreamento será obtido do Observe, permitindo
 * relacionar os registros técnicos de uma mesma requisição.
 */
async function bootstrap() {
  /**
   * BUFFER DE LOGS
   *
   * Mantém os registros iniciais do NestJS em memória até que
   * o logger central seja recuperado e configurado.
   *
   * A instrumentação existente do Observe permanece habilitada.
   */
  const app = await NestFactory.create(AppModule, {
    instrument: ObserveInstrument,
    bufferLogs: true,
  });

  /**
   * LOGGER CENTRAL
   *
   * Recupera a instância única disponibilizada pelo LoggingModule.
   * Não criamos outro logger para evitar duplicidade de arquivos.
   */
  const logger = app.get(AplicacaoLogger);

  // Recupera o serviço de rastreamento disponibilizado pelo Observe.
  const tracer = app.get(TracerService);

  /**
   * ASSOCIAÇÃO DO IDENTIFICADOR DA REQUISIÇÃO
   *
   * Cada registro consulta o contexto atual do Observe.
   * Fora de uma requisição rastreada, o método retorna null,
   * sem impedir a gravação do log.
   */
  logger.definirProvedorTraceId(() => tracer.currentTraceId());

  // Substitui o logger padrão do NestJS e libera os registros armazenados.
  app.useLogger(logger);

  /**
   * ORIGENS AUTORIZADAS PELO CORS
   *
   * Permite configurar vários endereços separados por vírgula.
   *
   * Exemplo:
   * CORS_ORIGINS=http://localhost:3000,https://sistema.exemplo.com
   *
   * No desenvolvimento local, permite somente o frontend local
   * quando a variável ainda não estiver configurada.
   */
  const origensPermitidas = (
    process.env.CORS_ORIGINS ?? 'http://localhost:3000'
  )
    .split(',')
    .map((origem) => origem.trim())
    .filter((origem) => origem.length > 0);

  // Restringe o acesso entre origens aos endereços autorizados.
  app.enableCors({
    origin: origensPermitidas,
  });

  // Aplica as validações globais utilizadas também nos testes E2E.
  configurarAplicacao(app);

  /**
   * ENCERRAMENTO CONTROLADO
   *
   * Habilita os hooks do NestJS para executar os métodos
   * onApplicationShutdown dos serviços durante o desligamento.
   *
   * O AplicacaoLogger utiliza esse ciclo de vida para finalizar
   * os arquivos e preservar os registros pendentes.
   */
  app.enableShutdownHooks();

  /**
   * PORTA DA API
   *
   * A porta 3001 é utilizada como padrão para manter a API
   * separada do frontend Next.js e do PostgreSQL.
   */
  const porta = Number(process.env.PORT ?? 3001);

  if (
    !Number.isSafeInteger(porta) ||
    porta < 1 ||
    porta > 65535
  ) {
    throw new Error(
      'A variável PORT deve ser um número inteiro entre 1 e 65535.',
    );
  }

  await app.listen(porta);
}

// Executa a inicialização da aplicação.
await bootstrap();
