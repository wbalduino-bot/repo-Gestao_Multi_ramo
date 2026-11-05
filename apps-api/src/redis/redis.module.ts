
import { Module } from '@nestjs/common';
import { createClient } from 'redis';

import { REDIS_CLIENT } from './redis.constants.js';
import { RedisService } from './redis.service.js';

/**
 * Módulo de infraestrutura responsável pela conexão Redis.
 *
 * A conexão é compartilhada pelos serviços que importarem
 * este módulo, evitando múltiplas conexões desnecessárias.
 *
 * Em produção, a URL do Redis deve ser informada explicitamente
 * para impedir que a aplicação utilize acidentalmente o endereço
 * local da máquina onde o backend estiver hospedado.
 */
@Module({
  providers: [
    {
      /**
       * Cria o cliente Redis que será injetado pelo NestJS.
       *
       * REDIS_URL permite configurar endereços diferentes
       * nos ambientes de desenvolvimento, homologação e produção.
       */
      provide: REDIS_CLIENT,

      useFactory: () => {
        // Normaliza o ambiente para evitar diferenças de capitalização.
        const ambiente = (
          process.env.NODE_ENV ?? 'development'
        ).trim().toLowerCase();

        // Lê a URL sem exibir credenciais nos logs.
        const urlConfigurada = process.env.REDIS_URL?.trim();

        /**
         * Produção exige uma URL Redis explícita.
         *
         * Essa validação impede que uma API hospedada em outro servidor
         * tente acessar acidentalmente o Redis da própria máquina.
         */
        if (ambiente === 'production' && !urlConfigurada) {
          throw new Error(
            'A variável REDIS_URL é obrigatória em produção.',
          );
        }

        /**
         * Em desenvolvimento e testes, permite utilizar o Redis local
         * quando REDIS_URL não estiver configurada.
         *
         * Em produção, este endereço alternativo nunca será utilizado.
         */
        const url =
          urlConfigurada ?? 'redis://127.0.0.1:6379';

        return createClient({
          url,

          // Define limites para tentativas de conexão e reconexão.
          socket: {
            connectTimeout: 3000,

            reconnectStrategy: (tentativas) => {
              // Encerra as tentativas automáticas após três falhas.
              if (tentativas >= 3) {
                return new Error(
                  'Redis indisponível após múltiplas tentativas.',
                );
              }

              // Aumenta gradualmente o intervalo entre tentativas.
              return Math.min((tentativas + 1) * 250, 750);
            },
          },

          /**
           * Impede que comandos permaneçam acumulados em memória
           * enquanto o Redis estiver indisponível.
           *
           * Uma operação sem conexão será tratada pelo RedisService
           * como indisponibilidade temporária.
           */
          disableOfflineQueue: true,
        });
      },
    },

    // Serviço responsável pelas operações e pelo ciclo de vida da conexão.
    RedisService,
  ],

  // Disponibiliza o RedisService para os módulos consumidores.
  exports: [RedisService],
})
export class RedisModule {}
