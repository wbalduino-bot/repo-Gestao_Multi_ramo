
import { Module } from '@nestjs/common';

// Importa o módulo de autenticação, que disponibiliza
// o JwtService para a validação dos tokens JWT.
import { AuthModule } from '../auth/auth.module.js';

// Importa o guard responsável por proteger as rotas
// e verificar se o token de acesso é válido.
import { JwtAuthGuard } from '../auth/strategies/jwt.strategy.js';

// Importa o controller que define as rotas HTTP de usuários.
import { UsuariosController } from './usuarios.controller.js';

// Importa o serviço responsável pelas regras de negócio
// e pelas operações relacionadas aos usuários.
import { UsuariosService } from './usuarios.service.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { AuditoriaModule } from '../auditoria/auditoria.module.js';
import { GerenciaGuard } from '../auth/guards/gerencia.guard.js';


@Module({
  // Permite utilizar os recursos exportados pelo AuthModule.
  imports: [
    AuthModule,
    PrismaModule,
    AuditoriaModule,
  ],

  // Registra o controller que recebe as requisições
  // direcionadas às rotas de usuários.
  controllers: [UsuariosController],

  // Registra os componentes que o NestJS disponibiliza
  // por meio do sistema de injeção de dependências.
  providers: [
    UsuariosService,
    JwtAuthGuard,
    GerenciaGuard,
  ],
})
export class UsuariosModule {}
