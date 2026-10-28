
import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module.js';
import { JwtAuthGuard } from '../auth/strategies/jwt.strategy.js';
import { PrismaModule } from '../prisma/prisma.module.js';

import { ProdutosController } from './produtos.controller.js';
import { ProdutosService } from './produtos.service.js';

/**
 * Módulo responsável pelo cadastro, consulta e manutenção
 * dos produtos de cada empresa.
 */
@Module({
  // Disponibiliza JWT e acesso ao PostgreSQL via Prisma.
  imports: [AuthModule, PrismaModule],

  // Registra as rotas HTTP de produtos.
  controllers: [ProdutosController],

  // O guard é registrado neste módulo para poder ser injetado.
  providers: [ProdutosService, JwtAuthGuard],
})
export class ProdutosModule {}
