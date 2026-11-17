import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { AuditoriaModule } from '../auditoria/auditoria.module.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { JwtAuthGuard } from '../auth/strategies/jwt.strategy.js';
import { GerenciaGuard } from '../auth/guards/gerencia.guard.js';
import { CaixaController } from './caixa.controller.js';
import { CaixaService } from './caixa.service.js';

@Module({
  imports: [AuthModule, AuditoriaModule, PrismaModule],
  controllers: [CaixaController],
  providers: [CaixaService, JwtAuthGuard, GerenciaGuard],
})
export class CaixaModule {}
