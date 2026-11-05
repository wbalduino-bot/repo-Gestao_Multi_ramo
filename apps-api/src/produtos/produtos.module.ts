
import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module.js';
import { AuditoriaModule } from '../auditoria/auditoria.module.js';
import { JwtAuthGuard } from '../auth/strategies/jwt.strategy.js';
import { GerenciaGuard } from '../auth/guards/gerencia.guard.js';
import { PrismaModule } from '../prisma/prisma.module.js';

import { ProdutosController } from './produtos.controller.js';
import { ProdutosService } from './produtos.service.js';

/**
 * Módulo responsável pelo cadastro, consulta e manutenção
 * dos produtos e estoques de cada empresa.
 */
@Module({
  imports: [
    AuthModule,
    PrismaModule,
    AuditoriaModule,
  ],
  controllers: [ProdutosController],
  providers: [
    ProdutosService,
    JwtAuthGuard,
    GerenciaGuard,
  ],
})
export class ProdutosModule {}
