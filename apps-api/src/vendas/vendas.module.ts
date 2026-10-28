import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module.js';
import { JwtAuthGuard } from '../auth/strategies/jwt.strategy.js';
import { PrismaModule } from '../prisma/prisma.module.js';

import { VendasController } from './vendas.controller.js';
import { VendasService } from './vendas.service.js';

/**
 * Módulo responsável pelo registro e pelas consultas de vendas.
 */
@Module({
  imports: [AuthModule, PrismaModule],
  controllers: [VendasController],
  providers: [VendasService, JwtAuthGuard],
})
export class VendasModule {}