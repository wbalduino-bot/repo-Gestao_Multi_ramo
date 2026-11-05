import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { JwtAuthGuard } from '../auth/strategies/jwt.strategy.js';
import { GerenciaGuard } from '../auth/guards/gerencia.guard.js';
import { AuditoriaEmpresaController } from './auditoria-empresa.controller.js';
import { AuditoriaEmpresaService } from './auditoria-empresa.service.js';

/** Módulo isolado para evitar dependência circular com AuthModule. */
@Module({
  imports: [AuthModule],
  controllers: [AuditoriaEmpresaController],
  providers: [AuditoriaEmpresaService, JwtAuthGuard, GerenciaGuard],
})
export class AuditoriaEmpresaModule {}
