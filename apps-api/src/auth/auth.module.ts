
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';

import { AuditoriaModule } from '../auditoria/auditoria.module.js';
import { RedisModule } from '../redis/redis.module.js';

// Importa o controller responsável pela rota de login.
import { AuthController } from './auth.controller.js';

// Importa o serviço que valida credenciais, registra auditoria e gera tokens.
import { AuthService } from './auth.service.js';

// Importa o serviço que controla tentativas excessivas de autenticação.
import { LoginRateLimitService } from './login-rate-limit.service.js';

// Importa o guard que valida os tokens JWT nas rotas protegidas.
import { JwtAuthGuard } from './strategies/jwt.strategy.js';

/**
 * Módulo de autenticação dos usuários empresariais.
 *
 * Centraliza:
 * - Validação das credenciais.
 * - Geração e validação dos tokens JWT.
 * - Registro dos eventos de autenticação.
 * - Proteção contra tentativas excessivas de login.
 */
@Module({
  imports: [
    // Disponibiliza o serviço central de auditoria.
    AuditoriaModule,

    // Disponibiliza a infraestrutura Redis para controlar tentativas de login.
    RedisModule,

    /**
     * Configura o serviço JWT.
     *
     * A chave secreta precisa existir no ambiente.
     * Não utilizamos uma chave padrão, pois isso comprometeria
     * a segurança dos tokens em produção.
     */
    JwtModule.registerAsync({
      useFactory: () => {
        // Obtém a chave secreta das variáveis de ambiente.
        const secret = process.env.JWT_SECRET;

        // Impede a inicialização se a chave não estiver configurada.
        if (!secret) {
          throw new Error(
            'A variável JWT_SECRET não está configurada.',
          );
        }

        // Define a chave e o prazo de validade dos tokens.
        return {
          secret,
          signOptions: {
            expiresIn: '15m',
          },
        };
      },
    }),
  ],

  // Registra o endpoint responsável pelo login empresarial.
  controllers: [AuthController],

  providers: [
    // Executa a autenticação e as regras de negócio do login.
    AuthService,

    // Valida os tokens JWT nas rotas protegidas.
    JwtAuthGuard,

    // Controla os limites de tentativas utilizando o Redis.
    LoginRateLimitService,
  ],

  // Permite que outros módulos utilizem o serviço JWT.
  exports: [JwtModule],
})
export class AuthModule {}
