import { Module } from '@nestjs/common';
import { MonitorNotasCompraService } from './monitor-notas-compra.service.js';
import { SimuladorNotasCompraService } from './simulador-notas-compra.service.js';
import { AuditoriaModule } from '../auditoria/auditoria.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { GerenciaGuard } from '../auth/guards/gerencia.guard.js';
import { JwtAuthGuard } from '../auth/strategies/jwt.strategy.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { ProdutosModule } from '../produtos/produtos.module.js';
import { RecebimentosCompraController } from './recebimentos-compra.controller.js';
import { RecebimentosCompraService } from './recebimentos-compra.service.js';

@Module({
  imports: [AuthModule, PrismaModule, AuditoriaModule, ProdutosModule],
  controllers: [RecebimentosCompraController],
  providers: [
    RecebimentosCompraService,
    MonitorNotasCompraService,
    SimuladorNotasCompraService,
    JwtAuthGuard,
    GerenciaGuard,
  ],
})
export class RecebimentosCompraModule {}
