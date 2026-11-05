import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard, type RequisicaoAutenticada } from '../auth/strategies/jwt.strategy.js';
import { GerenciaGuard } from '../auth/guards/gerencia.guard.js';
import { UnidadesService } from './unidades.service.js';
import { CriarUnidadeDto } from './dto/criar-unidade.dto.js';
import { EditarUnidadeDto } from './dto/editar-unidade.dto.js';

@Controller('unidades')
@UseGuards(JwtAuthGuard)
export class UnidadesController {
  constructor(private readonly unidades: UnidadesService) {}

  @Get()
  listar(@Req() req: RequisicaoAutenticada) {
    return this.unidades.listar(req.user.empresaId);
  }

  @Post()
  @UseGuards(GerenciaGuard)
  criar(@Req() req: RequisicaoAutenticada, @Body() dto: CriarUnidadeDto) {
    return this.unidades.criar(req.user.empresaId, req.user.sub, dto);
  }

  /** Restrito à gestão da empresa do usuário autenticado. */
  @Patch(':id')
  @UseGuards(GerenciaGuard)
  editar(
    @Req() req: RequisicaoAutenticada,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: EditarUnidadeDto,
  ) {
    return this.unidades.editar(req.user.empresaId, req.user.sub, id, dto);
  }
}
