import {
  Body, Controller, Get, ParseIntPipe, Post, Query, Req, UseGuards,
} from '@nestjs/common';
import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { JwtAuthGuard, type RequisicaoAutenticada } from '../auth/strategies/jwt.strategy.js';
import { GerenciaGuard } from '../auth/guards/gerencia.guard.js';
import { CaixaService } from './caixa.service.js';

class FecharDiaDto {
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  data!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  observacao?: string;
}

@Controller('caixa')
@UseGuards(JwtAuthGuard, GerenciaGuard)
export class CaixaController {
  constructor(private readonly caixa: CaixaService) {}

  @Get('relatorio')
  relatorio(
    @Req() requisicao: RequisicaoAutenticada,
    @Query('dias', new ParseIntPipe({ optional: true })) dias?: number,
    @Query('dataFinal') dataFinal?: string,
  ) {
    return this.caixa.relatorio(requisicao.user.empresaId, dias ?? 1, dataFinal);
  }

  /** Ranking por valor bruto e quantidade (com unidades separadas). */
  @Get('ranking-produtos')
  rankingProdutos(
    @Req() requisicao: RequisicaoAutenticada,
    @Query('dias', new ParseIntPipe({ optional: true })) dias?: number,
    @Query('dataFinal') dataFinal?: string,
  ) {
    return this.caixa.rankingProdutos(requisicao.user.empresaId, dias ?? 1, dataFinal);
  }

  @Post('fechamentos')
  fechar(
    @Req() requisicao: RequisicaoAutenticada,
    @Body() dto: FecharDiaDto,
  ) {
    return this.caixa.fecharDia(
      requisicao.user.empresaId, requisicao.user.sub,
      dto.data, dto.observacao,
    );
  }
}
