import {
  Body, Controller, DefaultValuePipe, Get, ParseIntPipe,
  Param, ParseUUIDPipe, Post, Query, Req, UseGuards,
} from '@nestjs/common';
import { GerenciaGuard } from '../auth/guards/gerencia.guard.js';
import {
  JwtAuthGuard, type RequisicaoAutenticada,
} from '../auth/strategies/jwt.strategy.js';
import { ConfirmarRecebimentoCompraDto } from './confirmar-recebimento-compra.dto.js';
import { ConfirmarNotaAgenteDto, VincularProdutoNotaDto } from './confirmar-nota-agente.dto.js';
import { RevisarNotaAgenteDto } from './revisar-nota-agente.dto.js';
import { ReprocessarNotaVaziaDto } from './reprocessar-nota-vazia.dto.js';
import { RecebimentosCompraService } from './recebimentos-compra.service.js';

@Controller('recebimentos-compra')
@UseGuards(JwtAuthGuard, GerenciaGuard)
export class RecebimentosCompraController {
  constructor(private readonly recebimentos: RecebimentosCompraService) {}

  @Get()
  listar(
    @Req() requisicao: RequisicaoAutenticada,
    @Query('pagina', new DefaultValuePipe(1), ParseIntPipe) pagina: number,
    @Query('limite', new DefaultValuePipe(20), ParseIntPipe) limite: number,
  ) {
    return this.recebimentos.listar(requisicao.user.empresaId, pagina, limite);
  }

  @Get('notas-pendentes')
  listarNotasPendentes(
    @Req() requisicao: RequisicaoAutenticada,
    @Query('pagina', new DefaultValuePipe(1), ParseIntPipe) pagina: number,
  ) {
    return this.recebimentos.listarNotasPendentes(requisicao.user.empresaId, pagina);
  }

  @Get('notas-pendentes/:id/vinculos')
  listarVinculosNotaPendente(
    @Req() requisicao: RequisicaoAutenticada,
    @Param('id', ParseUUIDPipe) arquivoId: string,
  ) {
    return this.recebimentos.listarVinculosNotaPendente(
      requisicao.user.empresaId,
      arquivoId,
    );
  }

  @Post('notas-pendentes/:id/itens/:indice/vinculo')
  vincularProdutoNota(
    @Req() requisicao: RequisicaoAutenticada,
    @Param('id', ParseUUIDPipe) arquivoId: string,
    @Param('indice', ParseIntPipe) indice: number,
    @Body() dto: VincularProdutoNotaDto,
  ) {
    const { empresaId, sub } = requisicao.user;
    return this.recebimentos.vincularProdutoNota(empresaId, sub, arquivoId, indice, dto.produtoId);
  }

  /**
   * Salva a revisao fiscal de uma nota extraida pelo OCR.
   * Nao confirma o recebimento nem movimenta estoque.
   */
  @Post('notas-pendentes/:id/revisar')
  revisarNotaAgente(
    @Req() requisicao: RequisicaoAutenticada,
    @Param('id', ParseUUIDPipe) arquivoId: string,
    @Body() dto: RevisarNotaAgenteDto,
  ) {
    const { empresaId, sub } = requisicao.user;

    return this.recebimentos.revisarNotaAgente(
      empresaId,
      sub,
      arquivoId,
      dto,
    );
  }

  @Post('notas-pendentes/:id/reprocessar')
  reprocessarNotaAgente(
    @Req() requisicao: RequisicaoAutenticada,
    @Param('id', ParseUUIDPipe) arquivoId: string,
    @Body() dto: ReprocessarNotaVaziaDto,
  ) {
    const { empresaId, sub } = requisicao.user;
    return this.recebimentos.reprocessarNotaAgente(empresaId, sub, arquivoId, dto);
  }

  @Post('notas-pendentes/:id/confirmar')
  confirmarNotaAgente(
    @Req() requisicao: RequisicaoAutenticada,
    @Param('id', ParseUUIDPipe) arquivoId: string,
    @Body() dto: ConfirmarNotaAgenteDto,
  ) {
    const { empresaId, sub } = requisicao.user;
    return this.recebimentos.confirmarNotaAgente(empresaId, sub, arquivoId, dto);
  }

  @Post('confirmar')
  confirmar(
    @Req() requisicao: RequisicaoAutenticada,
    @Body() dto: ConfirmarRecebimentoCompraDto,
  ) {
    const { empresaId, sub } = requisicao.user;
    return this.recebimentos.confirmar(empresaId, sub, dto);
  }
}
