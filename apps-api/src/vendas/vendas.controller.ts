import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';

import {
  JwtAuthGuard,
} from '../auth/strategies/jwt.strategy.js';

import type {
  RequisicaoAutenticada,
} from '../auth/strategies/jwt.strategy.js';

import { CriarVendaDto } from './dto/criar-venda.dto.js';
import { VendasService } from './vendas.service.js';
import { ListarVendasDto } from './dto/listar-vendas.dto.js';

/**
 * Controller responsável pelas operações HTTP de vendas.
 *
 * A empresa e o usuário responsável são obtidos do JWT validado,
 * e nunca de identificadores enviados livremente pelo frontend.
 */
@Controller('vendas')
@UseGuards(JwtAuthGuard)
export class VendasController {
  constructor(
    private readonly vendasService: VendasService,
  ) {}

  /**
   * Lista as vendas da empresa autenticada.
   *
   * Exemplos:
   * GET /vendas
   * GET /vendas?pagina=2&limite=10
   * GET /vendas?formaPagamento=PIX
   */
  @Get()
  listar(
    @Req() requisicao: RequisicaoAutenticada,
    @Query() filtros: ListarVendasDto,
  ) {
    return this.vendasService.listar(
      requisicao.user.empresaId,
      filtros,
    );
  }
    /**
   * Retorna os indicadores comerciais do dashboard.
   * A empresa é obtida exclusivamente da sessão autenticada.
   */
  @Get('dashboard/resumo')
  resumoDashboard(
    @Req() requisicao: RequisicaoAutenticada,
  ) {
    return this.vendasService.resumoDashboard(
      requisicao.user.empresaId,
    );
  }
    /**
   * Retorna as dez atividades mais recentes da empresa autenticada.
   */
  @Get('dashboard/atividades-recentes')
  listarAtividadesDashboard(
    @Req() requisicao: RequisicaoAutenticada,
  ) {
    return this.vendasService.listarAtividadesDashboard(
      requisicao.user.empresaId,
    );
  }


    /**
     * Retorna as análises de pagamento e produtos vendidos
     * para o mês atual da empresa autenticada.
     */
    @Get('dashboard/analise')
    analiseDashboard(
      @Req() requisicao: RequisicaoAutenticada,
    ) {
      return this.vendasService.analiseDashboard(
        requisicao.user.empresaId,
      );
    }


  /**
   * Retorna os detalhes de uma venda específica.
   * O serviço restringe a consulta à empresa autenticada.
   */
  @Get(':id')
  buscarPorId(
    @Req() requisicao: RequisicaoAutenticada,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.vendasService.buscarPorId(
      requisicao.user.empresaId,
      id,
    );
  }
  /**
   * Registra uma venda e realiza a baixa do estoque.
   *
   * A venda, os itens e as movimentações são tratados
   * pelo serviço dentro da mesma transação.
   */
  @Post()
  criar(
    @Req() requisicao: RequisicaoAutenticada,
    @Body() dto: CriarVendaDto,
  ) {
    return this.vendasService.criar(
      requisicao.user.empresaId,
      requisicao.user.sub,
      dto,
    );
  }
}