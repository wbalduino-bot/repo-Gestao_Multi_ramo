import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { AuditoriaModule } from '../auditoria/auditoria.module.js';
import { JwtAuthGuard } from '../auth/strategies/jwt.strategy.js';
import { GerenciaGuard } from '../auth/guards/gerencia.guard.js';
import { UnidadesController } from './unidades.controller.js';
import { UnidadesService } from './unidades.service.js';

@Module({
  imports: [AuthModule, AuditoriaModule],
  controllers: [UnidadesController],
  providers: [UnidadesService, JwtAuthGuard, GerenciaGuard],
})
export class UnidadesModule {}
