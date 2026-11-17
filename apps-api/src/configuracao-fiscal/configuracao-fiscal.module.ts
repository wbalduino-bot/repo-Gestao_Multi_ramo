import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { AuditoriaModule } from '../auditoria/auditoria.module.js';

import { JwtAuthGuard } from '../auth/strategies/jwt.strategy.js';
import { GerenciaGuard } from '../auth/guards/gerencia.guard.js';

import { ConfiguracaoFiscalController } from './configuracao-fiscal.controller.js';
import { ConfiguracaoFiscalService } from './configuracao-fiscal.service.js';

/**
 * Módulo responsável pelo cadastro fiscal de cada empresa.
 *
 * Reutiliza a autenticação, o acesso ao PostgreSQL e a
 * auditoria central já existentes na aplicação.
 *
 * As rotas de configuração exigem JWT válido e perfil
 * ADMINISTRADOR ou GERENTE.
 *
 * Este módulo não disponibiliza emissão de NF-e ou NFC-e.
 */
@Module({
  imports: [
    AuthModule,
    PrismaModule,
    AuditoriaModule,
  ],

  controllers: [
    ConfiguracaoFiscalController,
  ],

  providers: [
    ConfiguracaoFiscalService,
    JwtAuthGuard,
    GerenciaGuard,
  ],
})
export class ConfiguracaoFiscalModule {}
