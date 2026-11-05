
import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module.js';
import { AuditoriaModule } from '../auditoria/auditoria.module.js';
import { JwtAuthGuard } from '../auth/strategies/jwt.strategy.js';
import { GerenciaGuard } from '../auth/guards/gerencia.guard.js';
import { PrismaModule } from '../prisma/prisma.module.js';

import { VendasController } from './vendas.controller.js';
import { VendasService } from './vendas.service.js';

/**
 * Módulo responsável pelo registro e pelas consultas de vendas.
 *
 * Também disponibiliza a auditoria central para registrar
 * operações comerciais de forma integrada às transações.
 */
@Module({
  imports: [
    AuthModule,
    AuditoriaModule,
    PrismaModule,
  ],
  controllers: [VendasController],
  providers: [VendasService, JwtAuthGuard, GerenciaGuard],
})
export class VendasModule {}
