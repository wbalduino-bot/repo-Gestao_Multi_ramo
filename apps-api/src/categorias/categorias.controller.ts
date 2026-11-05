import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard, type RequisicaoAutenticada } from '../auth/strategies/jwt.strategy.js';
import { GerenciaGuard } from '../auth/guards/gerencia.guard.js';
import { CategoriasService } from './categorias.service.js';
import { CriarCategoriaDto } from './dto/criar-categoria.dto.js';
import { EditarCategoriaDto } from './dto/editar-categoria.dto.js';

/** O tenant é obtido do JWT; nunca é recebido por parâmetros da página. */
@Controller('categorias')
@UseGuards(JwtAuthGuard)
export class CategoriasController {
  constructor(private readonly categorias: CategoriasService) {}

  @Get()
  listar(@Req() req: RequisicaoAutenticada) {
    return this.categorias.listar(req.user.empresaId);
  }

  @Post()
  @UseGuards(GerenciaGuard)
  criar(@Req() req: RequisicaoAutenticada, @Body() dto: CriarCategoriaDto) {
    return this.categorias.criar(req.user.empresaId, req.user.sub, dto);
  }

  /** Somente a gestão pode corrigir categorias pertencentes à sua empresa. */
  @Patch(':id')
  @UseGuards(GerenciaGuard)
  editar(
    @Req() req: RequisicaoAutenticada,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: EditarCategoriaDto,
  ) {
    return this.categorias.editar(req.user.empresaId, req.user.sub, id, dto);
  }
}
