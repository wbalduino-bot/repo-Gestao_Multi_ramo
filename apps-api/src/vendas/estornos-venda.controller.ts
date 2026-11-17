import {
  Body, Controller, Get, Param, ParseUUIDPipe,
  Post, Req, UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/strategies/jwt.strategy.js';
import type { RequisicaoAutenticada } from '../auth/strategies/jwt.strategy.js';
import { GerenciaGuard } from '../auth/guards/gerencia.guard.js';
import { CriarEstornoVendaDto } from './dto/criar-estorno-venda.dto.js';
import { EstornosVendaService } from './estornos-venda.service.js';

/** Separado do VendasController para manter compatibilidade das rotas existentes. */
@Controller('vendas')
@UseGuards(JwtAuthGuard, GerenciaGuard)
export class EstornosVendaController {
  constructor(private readonly estornos: EstornosVendaService) {}

  @Get(':id/estornos')
  listar(@Req() requisicao: RequisicaoAutenticada,
    @Param('id', new ParseUUIDPipe()) id: string) {
    return this.estornos.listar(requisicao.user.empresaId, requisicao.user.sub, id);
  }

  @Post(':id/estornos')
  criar(@Req() requisicao: RequisicaoAutenticada,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: CriarEstornoVendaDto) {
    return this.estornos.criar(requisicao.user.empresaId, requisicao.user.sub, id, dto);
  }
}
