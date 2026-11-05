import { Global, Module } from '@nestjs/common';

import { AplicacaoLogger } from './logger.service.js';

/**
 * MÓDULO CENTRAL DE LOGS
 *
 * Disponibiliza uma única instância do AplicacaoLogger para
 * os demais módulos da API.
 *
 * A criação por useFactory permite configurar posteriormente
 * o logger com o contexto de rastreamento do Observe no main.ts,
 * sem criar instâncias independentes em cada módulo.
 */
@Global()
@Module({
  providers: [
    {
      provide: AplicacaoLogger,
      useFactory: (): AplicacaoLogger => new AplicacaoLogger(),
    },
  ],

  // Permite que a inicialização da aplicação recupere o logger central.
  exports: [AplicacaoLogger],
})
export class LoggingModule {}
