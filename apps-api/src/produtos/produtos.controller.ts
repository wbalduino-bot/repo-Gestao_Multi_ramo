import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';

import { JwtAuthGuard } from '../auth/strategies/jwt.strategy.js';
import type { RequisicaoAutenticada } from '../auth/strategies/jwt.strategy.js';
import { GerenciaGuard } from '../auth/guards/gerencia.guard.js';
import {
  perfilTemAcessoGerencial,
  removerDadosFinanceiros,
} from '../auth/utils/resposta-financeira.util.js';

import { ProdutosService } from './produtos.service.js';
import { CriarProdutoDto } from './dto/criar-produto.dto.js';
import { AtualizarProdutoDto } from './dto/atualizar-produto.dto.js';
import { ListarProdutosDto } from './dto/listar-produtos.dto.js';
import { AlterarAtivacaoProdutoDto } from './dto/alterar-ativacao-produto.dto.js';
import { CriarMovimentacaoEstoqueDto } from './dto/criar-movimentacao-estoque.dto.js';
import { ListarMovimentacoesEstoqueDto } from './dto/listar-movimentacoes-estoque.dto.js';

/**
 * Controller responsável pelas operações HTTP de produtos.
 *
 * Todas as rotas exigem autenticação.
 * A empresa é identificada pelo JwtAuthGuard, e não por um
 * empresaId informado livremente no corpo da requisição.
 */
@Controller('produtos')
@UseGuards(JwtAuthGuard)
export class ProdutosController {
  constructor(
    private readonly produtosService: ProdutosService,
  ) {}
  /**
   * Cadastra um produto para a empresa autenticada.
   *
   * O ID da empresa e o ID do usuário são obtidos do token
   * validado pelo guard, nunca do corpo enviado pelo frontend.
   */
  @Post()
  @UseGuards(GerenciaGuard)
  criar(
    @Req() requisicao: RequisicaoAutenticada,
    @Body() dto: CriarProdutoDto,
  ) {
    return this.produtosService.criar(
      requisicao.user.empresaId,
      requisicao.user.sub,
      dto,
    );
  }

  // Lista e pesquisa somente os produtos da empresa autenticada.
  @Get()
  async listar(
    @Req() requisicao: RequisicaoAutenticada,
    @Query() filtros: ListarProdutosDto,
  ) {
    const resultado = await this.produtosService.listar(
      requisicao.user.empresaId,
      requisicao.user.sub,
      filtros,
    );

    // O funcionário consulta produtos sem receber o custo cadastrado.
    return perfilTemAcessoGerencial(requisicao.user.perfil)
      ? resultado
      : removerDadosFinanceiros(resultado);
  }

    /**
   * Registra uma entrada, saída ou ajuste no estoque de um produto.
   *
   * A empresa e o usuário vêm do token validado pelo JwtAuthGuard.
   */
  @Post(':id/movimentacoes')
  movimentarEstoque(
    @Req() requisicao: RequisicaoAutenticada,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: CriarMovimentacaoEstoqueDto,
  ) {
    return this.produtosService.movimentarEstoque(
      requisicao.user.empresaId,
      requisicao.user.sub,
      id,
      dto,
    );
  }

  /**
   * Consulta o histórico de movimentações de um produto.
   * A listagem respeita a empresa do usuário autenticado.
   */
  @Get(':id/movimentacoes')
  listarMovimentacoes(
    @Req() requisicao: RequisicaoAutenticada,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query() filtros: ListarMovimentacoesEstoqueDto,
  ) {
    return this.produtosService.listarMovimentacoes(
      requisicao.user.empresaId,
      requisicao.user.sub,
      id,
      filtros,
    );
  }
    /**
   * Retorna os indicadores gerais de estoque da empresa autenticada.
   *
   * A rota é protegida pelo JwtAuthGuard definido no controller.
   * A empresa é obtida do token, sem aceitar empresaId pela URL.
   *
   * Importante: este endpoint precisa ficar antes de @Get(':id')
   * para que "resumo-estoque" não seja interpretado como um ID.
   */
  @Get('resumo-estoque')
  obterResumoEstoque(
    @Req() requisicao: RequisicaoAutenticada,
  ) {
    return this.produtosService.obterResumoEstoque(
      requisicao.user.empresaId,
      requisicao.user.sub,
    );
  }
  
  /**
   * Retorna as cinco movimentações de estoque mais recentes
   * da empresa autenticada.
   */
  @Get('atividades-recentes')
  listarAtividadesRecentes(
    @Req() requisicao: RequisicaoAutenticada,
  ) {
    return this.produtosService.listarAtividadesRecentes(
      requisicao.user.empresaId,
      requisicao.user.sub,
    );
  }

  // Busca um produto pelo ID dentro da empresa autenticada.
  @Get(':id')
  async buscarPorId(
    @Req() requisicao: RequisicaoAutenticada,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    const produto = await this.produtosService.buscarPorId(
      requisicao.user.empresaId,
      requisicao.user.sub,
      id,
    );

    return perfilTemAcessoGerencial(requisicao.user.perfil)
      ? produto
      : removerDadosFinanceiros(produto);
  }

  /**
   * Atualiza os dados cadastrais de um produto da empresa autenticada.
   *
   * Somente perfis gerenciais podem realizar alterações.
   * A empresa e o usuário são identificados pelo JWT validado.
   */
  @Patch(':id')
  @UseGuards(GerenciaGuard)
  atualizar(
    @Req() requisicao: RequisicaoAutenticada,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: AtualizarProdutoDto,
  ) {
    return this.produtosService.atualizar(
      requisicao.user.empresaId,
      requisicao.user.sub,
      id,
      dto,
    );
  }

  // Ativa ou desativa um produto pertencente à empresa autenticada.
  @Patch(':id/ativacao')
  @UseGuards(GerenciaGuard)
  alterarAtivacao(
    @Req() requisicao: RequisicaoAutenticada,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: AlterarAtivacaoProdutoDto,
  ) {
    return this.produtosService.alterarAtivacao(
      requisicao.user.empresaId,
      requisicao.user.sub,
      id,
      dto.ativo,
    );
  }
}