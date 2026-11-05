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
import { GerenciaGuard } from '../auth/guards/gerencia.guard.js';
import {
  perfilTemAcessoGerencial,
  removerDadosFinanceiros,
} from '../auth/utils/resposta-financeira.util.js';

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
  async listar(
    @Req() requisicao: RequisicaoAutenticada,
    @Query() filtros: ListarVendasDto,
  ) {
    const resultado = await this.vendasService.listar(
      requisicao.user.empresaId,
      filtros,
    );

    // Preserva o histórico operacional sem revelar dados de custo e lucro.
    return perfilTemAcessoGerencial(requisicao.user.perfil)
      ? resultado
      : removerDadosFinanceiros(resultado);
  }
    /**
   * Retorna os indicadores comerciais do dashboard.
   * A empresa é obtida exclusivamente da sessão autenticada.
   */
  @Get('dashboard/resumo')
  @UseGuards(GerenciaGuard)
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
  async listarAtividadesDashboard(
    @Req() requisicao: RequisicaoAutenticada,
  ) {
    const atividades = await this.vendasService.listarAtividadesDashboard(
      requisicao.user.empresaId,
    );

    if (perfilTemAcessoGerencial(requisicao.user.perfil)) {
      return atividades;
    }

    // Funcionários continuam vendo as atividades, sem o valor da venda.
    return atividades.map((atividade) => {
      const resposta: Record<string, unknown> = { ...atividade };

      if (resposta.tipo === 'VENDA') {
        delete resposta.valor;
      }

      return resposta;
    });
  }


    /**
     * Retorna as análises de pagamento e produtos vendidos
     * para o mês atual da empresa autenticada.
     */
    @Get('dashboard/analise')
    @UseGuards(GerenciaGuard)
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
  async buscarPorId(
    @Req() requisicao: RequisicaoAutenticada,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    const venda = await this.vendasService.buscarPorId(
      requisicao.user.empresaId,
      id,
    );

    return perfilTemAcessoGerencial(requisicao.user.perfil)
      ? venda
      : removerDadosFinanceiros(venda);
  }
  /**
   * Registra uma venda e realiza a baixa do estoque.
   *
   * A venda, os itens e as movimentações são tratados
   * pelo serviço dentro da mesma transação.
   */
  @Post()
  async criar(
    @Req() requisicao: RequisicaoAutenticada,
    @Body() dto: CriarVendaDto,
  ) {
    const venda = await this.vendasService.criar(
      requisicao.user.empresaId,
      requisicao.user.sub,
      dto,
    );

    // A venda é registrada normalmente; os campos gerenciais são
    // omitidos da resposta enviada aos perfis operacionais.
    return perfilTemAcessoGerencial(requisicao.user.perfil)
      ? venda
      : removerDadosFinanceiros(venda);
  }
}