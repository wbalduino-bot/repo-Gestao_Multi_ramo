import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';

import {
  Prisma,
  ResultadoAuditoria,
  TipoAtorAuditoria,
} from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service.js';

import {
  AuditoriaService,
  type RegistrarEventoAuditoriaInput,
} from '../auditoria/auditoria.service.js';

import { CriarProdutoDto } from './dto/criar-produto.dto.js';
import { AtualizarProdutoDto } from './dto/atualizar-produto.dto.js';
import { ListarProdutosDto } from './dto/listar-produtos.dto.js';
import { CriarMovimentacaoEstoqueDto } from './dto/criar-movimentacao-estoque.dto.js';
import { ListarMovimentacoesEstoqueDto } from './dto/listar-movimentacoes-estoque.dto.js';

/**
 * Serviço responsável pelas regras de negócio dos produtos e estoques.
 *
 * Responsabilidades:
 * - Cadastrar, consultar e atualizar produtos.
 * - Ativar e desativar produtos sem excluir seus registros.
 * - Criar o saldo inicial e o estoque mínimo no cadastro.
 * - Registrar a entrada inicial quando houver quantidade em estoque.
 * - Registrar entradas, saídas e ajustes de estoque.
 * - Consultar o histórico de movimentações com paginação.
 * - Manter as consultas e alterações isoladas por empresa.
 *
 * Os identificadores da empresa e do usuário responsável devem vir
 * do contexto autenticado, e não de valores livremente enviados pelo cliente.
 */
@Injectable()
export class ProdutosService {
  private readonly logger = new Logger(ProdutosService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditoria: AuditoriaService,
  ) {}
  /**
   * Cadastra um produto, inicializa seu saldo e registra a movimentação
   * de entrada quando a quantidade inicial for maior que zero.
   *
   * A criação do produto, do saldo e da movimentação ocorre na mesma
   * transação. Se uma das gravações falhar, nenhuma será confirmada.
   */
 async criar(
  empresaId: string,
  usuarioId: string,
  dto: CriarProdutoDto,
) {
  try {
    // Confere se as referências informadas pertencem à empresa.
    await this.validarCategoriaEUnidade(
      empresaId,
      dto.categoriaId,
      dto.unidadeId,
    );

    // Inicializa os campos opcionais com valores padrão.
    const quantidadeInicial = dto.quantidadeInicial ?? 0;
    const estoqueMinimo = dto.estoqueMinimo ?? 0;

    return await this.prisma.$transaction(async (transacao) => {
      // 1. Cria o produto vinculado à empresa autenticada.
      const produto = await transacao.produto.create({
        data: {
          empresaId,
          nome: dto.nome.trim(),
          sku: dto.sku.trim().toUpperCase(),
          descricao: dto.descricao?.trim() || null,
          categoriaId: dto.categoriaId ?? null,
          unidadeId: dto.unidadeId ?? null,
          codigoBarras: dto.codigoBarras?.trim() || null,
          preco: dto.preco,
          custo: dto.custo,
          perecivel: dto.perecivel ?? false,
          peso: dto.peso ?? null,
        },
      });

      // 2. Cria o saldo, mesmo quando a quantidade inicial for zero.
      const saldoEstoque = await transacao.saldoEstoque.create({
        data: {
          empresaId,
          produtoId: produto.id,
          quantidadeDisponivel: quantidadeInicial,
          quantidadeReservada: 0,
          estoqueMinimo,
        },
      });

      // 3. Registra a entrada inicial somente quando houver estoque.
      if (quantidadeInicial > 0) {
        await transacao.movimentacaoEstoque.create({
          data: {
            empresaId,
            produtoId: produto.id,
            tipo: 'ENTRADA',
            quantidade: quantidadeInicial,
            saldoApos: quantidadeInicial,
            motivo: 'Estoque inicial no cadastro do produto',
            usuarioId,
          },
        });
      }

      /*
       * 4. Registra a auditoria na mesma transação.
       *
       * Se a auditoria falhar, o produto, o saldo e a movimentação
       * inicial também serão revertidos.
       */
      await this.auditoria.registrar(
        {
          empresaId,
          atorId: usuarioId,
          tipoAtor: TipoAtorAuditoria.USUARIO_EMPRESA,
          modulo: 'PRODUTOS',
          acao: 'CRIAR',
          entidade: 'PRODUTO',
          entidadeId: produto.id,
          resultado: ResultadoAuditoria.SUCESSO,
          dadosPosteriores: {
            nome: produto.nome,
            sku: produto.sku,
            preco: produto.preco.toString(),
            custo: produto.custo.toString(),
            ativo: produto.ativo,
            quantidadeInicial: quantidadeInicial.toString(),
            estoqueMinimo: estoqueMinimo.toString(),
          },
        },
        transacao,
      );

      return {
        ...produto,
        saldoEstoque,
      };
    });
  } catch (erro) {
    // Registra a falha fora da transação revertida.
    await this.registrarFalhaAuditoria({
      empresaId,
      atorId: usuarioId,
      modulo: 'PRODUTOS',
      acao: 'CRIAR',
      entidade: 'PRODUTO',
      motivo: this.obterClassificacaoErro(erro),
    });

    // Preserva o tratamento original dos erros do Prisma.
    this.tratarErroPrisma(erro);
  }
}

  /**
   * Lista os produtos da empresa autenticada.
   *
   * Permite pesquisar por nome, SKU ou código de barras,
   * filtrar pela situação do produto e utilizar paginação.
   *
   * O saldo é incluído na resposta quando já existe.
   * Produtos antigos sem saldo não são inicializados nesta consulta.
   */
  async listar(
    empresaId: string,
    usuarioId: string,
    filtros: ListarProdutosDto,
  ) {
    /*
     * Os parâmetros de query string podem chegar como texto.
     * A conversão explícita impede que o Prisma receba, por exemplo,
     * take: "20" em vez de take: 20.
     */
    const pagina = Number(filtros.pagina ?? 1);
    const limite = Number(filtros.limite ?? 20);

    // Valida o número da página.
    if (!Number.isInteger(pagina) || pagina < 1) {
      throw new BadRequestException(
        'A página deve ser um número inteiro maior que zero.',
      );
    }

    // Limita a quantidade de registros por consulta.
    if (!Number.isInteger(limite) || limite < 1 || limite > 100) {
      throw new BadRequestException(
        'O limite deve ser um número inteiro entre 1 e 100.',
      );
    }

    /*
     * Confirma que a categoria informada pertence à empresa autenticada.
     * A validação existente também é utilizada no cadastro e na edição.
     * Uma categoria de outra empresa não pode ser utilizada na consulta.
     */
    if (filtros.categoriaId !== undefined) {
      await this.validarCategoriaEUnidade(
        empresaId,
        filtros.categoriaId,
      );
    }

    // Toda consulta deve começar restrita à empresa autenticada.
    const where: Prisma.ProdutoWhereInput = {
      empresaId,
    };

    /*
     * Filtra somente os produtos diretamente vinculados à categoria.
     * O filtro não inclui automaticamente produtos de subcategorias.
     */
    if (filtros.categoriaId !== undefined) {
      where.categoriaId = filtros.categoriaId;
    }

    // Aplica o filtro de situação quando ele for informado.
    if (filtros.ativo !== undefined) {
      where.ativo = filtros.ativo;
    }

    /*
     * Aplica o estado do estoque diretamente na consulta ao banco.
     *
     * As comparações entre quantidade disponível e estoque mínimo
     * utilizam referências tipadas aos campos do mesmo registro.
     *
     * O filtro é aplicado antes da paginação e da contagem,
     * preservando a consistência dos resultados.
     */
    const estoqueMinimo =
      this.prisma.saldoEstoque.fields.estoqueMinimo;

    switch (filtros.estadoEstoque) {
      case 'NORMAL':
        where.saldoEstoque = {
          is: {
            quantidadeDisponivel: { gt: 0 },
            OR: [
              { estoqueMinimo: { lte: 0 } },
              {
                quantidadeDisponivel: {
                  gt: estoqueMinimo,
                },
              },
            ],
          },
        };
        break;

      case 'CRITICO':
        where.saldoEstoque = {
          is: {
            quantidadeDisponivel: {
              gt: 0,
              lte: estoqueMinimo,
            },
            estoqueMinimo: { gt: 0 },
          },
        };
        break;

      case 'SEM_ESTOQUE':
        where.saldoEstoque = {
          is: {
            quantidadeDisponivel: { lte: 0 },
          },
        };
        break;

      case 'SEM_SALDO':
        where.saldoEstoque = {
          is: null,
        };
        break;

      case 'TODOS':
      case undefined:
        break;
    }

    const busca = filtros.busca?.trim();

    // Pesquisa por nome, SKU ou código de barras sem diferenciar caixa.
    if (busca) {
      where.OR = [
        {
          nome: {
            contains: busca,
            mode: 'insensitive',
          },
        },
        {
          sku: {
            contains: busca,
            mode: 'insensitive',
          },
        },
        {
          codigoBarras: {
            contains: busca,
            mode: 'insensitive',
          },
        },
      ];
    }

    // Calcula o deslocamento utilizando números inteiros.
    const skip = (pagina - 1) * limite;

    // Consulta os produtos e a contagem total na mesma transação.
    const [dados, total] = await this.prisma.$transaction([
      this.prisma.produto.findMany({
        where,
        orderBy: {
          nome: 'asc',
        },
        skip,
        take: limite,
        include: {
          // Inclui o saldo disponível, reservado e o estoque mínimo.
          saldoEstoque: true,
        },
      }),

      this.prisma.produto.count({
        where,
      }),
    ]);

    // Mantém o formato de resposta utilizado pelo frontend.
    const resultado = {
      dados,
      total,
      pagina,
      limite,
      totalPaginas: Math.ceil(total / limite),
    };

    // Registra somente os filtros úteis; o texto pesquisado não é armazenado.
    await this.registrarConsulta({
      empresaId,
      atorId: usuarioId,
      modulo: 'PRODUTOS',
      acao: 'CONSULTAR_LISTA',
      entidade: 'PRODUTO',
      metadados: {
        pagina,
        limite,
        filtroAtivo: filtros.ativo ?? null,
        categoriaInformada: filtros.categoriaId !== undefined,
        estadoEstoque: filtros.estadoEstoque ?? 'TODOS',
        buscaInformada: Boolean(busca),
        quantidadeRetornada: dados.length,
        totalRegistros: total,
      },
    });

    return resultado;
  }
    /**
   * Calcula os indicadores gerais de estoque da empresa autenticada.
   *
   * Diferentemente da listagem paginada, esta consulta considera
   * todo o catálogo da empresa.
   *
   * Regras:
   * - SEM_ESTOQUE: saldo disponível menor ou igual a zero.
   * - CRITICO: saldo positivo, estoque mínimo positivo e saldo
   *   menor ou igual ao estoque mínimo.
   * - NORMAL: saldo disponível acima do mínimo, ou mínimo igual a zero.
   * - SEM_SALDO: produto ainda sem registro de saldo.
   *
   * Os produtos sem saldo são contabilizados separadamente para
   * não gerar alertas falsos de falta de estoque.
   */
  async obterResumoEstoque(
    empresaId: string,
    usuarioId: string,
  ) {
    // Busca somente os campos necessários para os indicadores.
    // A consulta continua restrita à empresa autenticada.
    const produtos = await this.prisma.produto.findMany({
      where: {
        empresaId,
      },
      select: {
        id: true,
        nome: true,
        sku: true,
        ativo: true,
        saldoEstoque: {
          select: {
            quantidadeDisponivel: true,
            estoqueMinimo: true,
          },
        },
      },
      orderBy: {
        nome: 'asc',
      },
    });

    let produtosAtivos = 0;
    let produtosInativos = 0;
    let estoqueAdequado = 0;
    let estoqueCritico = 0;
    let semEstoque = 0;
    let semSaldo = 0;

    // Tipagem explícita para manter a resposta consistente com o frontend.
    const alertas: Array<{
      id: string;
      nome: string;
      sku: string;
      ativo: boolean;
      estado: 'SEM_ESTOQUE' | 'CRITICO';
      quantidadeDisponivel: number;
      estoqueMinimo: number;
    }> = [];

    for (const produto of produtos) {
      // A situação cadastral é independente da situação do estoque.
      if (produto.ativo) {
        produtosAtivos += 1;
      } else {
        produtosInativos += 1;
      }

      const saldo = produto.saldoEstoque;

      // Produtos antigos sem saldo não devem ser tratados como zerados.
      if (!saldo) {
        semSaldo += 1;
        continue;
      }

      // Utiliza Decimal para comparar os valores sem depender
      // de conversões prematuras para ponto flutuante.
      const quantidadeDisponivel = new Prisma.Decimal(
        saldo.quantidadeDisponivel.toString(),
      );

      const estoqueMinimo = new Prisma.Decimal(
        saldo.estoqueMinimo.toString(),
      );

      let estado: 'SEM_ESTOQUE' | 'CRITICO' | 'NORMAL';

      if (quantidadeDisponivel.lte(0)) {
        estado = 'SEM_ESTOQUE';
        semEstoque += 1;
      } else if (
        estoqueMinimo.gt(0) &&
        quantidadeDisponivel.lte(estoqueMinimo)
      ) {
        estado = 'CRITICO';
        estoqueCritico += 1;
      } else {
        estado = 'NORMAL';
        estoqueAdequado += 1;
      }

      // Registra os dados necessários para os alertas do Dashboard.
      if (estado === 'SEM_ESTOQUE' || estado === 'CRITICO') {
        alertas.push({
          id: produto.id,
          nome: produto.nome,
          sku: produto.sku,
          ativo: produto.ativo,
          estado,
          quantidadeDisponivel: quantidadeDisponivel.toNumber(),
          estoqueMinimo: estoqueMinimo.toNumber(),
        });
      }
    }

    // Prioriza produtos sem estoque; depois, os estoques críticos.
    // Em cada grupo, mantém uma ordenação previsível por nome.
    alertas.sort((a, b) => {
      const prioridadeA = a.estado === 'SEM_ESTOQUE' ? 0 : 1;
      const prioridadeB = b.estado === 'SEM_ESTOQUE' ? 0 : 1;

      return (
        prioridadeA - prioridadeB ||
        a.nome.localeCompare(b.nome, 'pt-BR')
      );
    });

    const resumo = {
      totalProdutos: produtos.length,
      produtosAtivos,
      produtosInativos,
      estoqueAdequado,
      estoqueCritico,
      semEstoque,
      semSaldo,
      totalAlertas: alertas.length,

      // O Dashboard mostrará até cinco itens, mas totalAlertas
      // continua refletindo todos os produtos que precisam de atenção.
      alertas: alertas.slice(0, 5),
    };

    await this.registrarConsulta({
      empresaId,
      atorId: usuarioId,
      modulo: 'ESTOQUE',
      acao: 'CONSULTAR_RESUMO',
      entidade: 'ESTOQUE',
      metadados: {
        totalProdutos: resumo.totalProdutos,
        produtosAtivos: resumo.produtosAtivos,
        produtosInativos: resumo.produtosInativos,
        estoqueAdequado: resumo.estoqueAdequado,
        estoqueCritico: resumo.estoqueCritico,
        semEstoque: resumo.semEstoque,
        semSaldo: resumo.semSaldo,
        totalAlertas: resumo.totalAlertas,
      },
    });

    return resumo;
  }

  /**
   * Busca um produto pertencente à empresa autenticada.
   *
   * Este método privado valida o vínculo sem gerar uma segunda
   * auditoria quando é utilizado por outra consulta do serviço.
   */
  private async buscarProdutoPorEmpresa(
    empresaId: string,
    id: string,
  ) {
    const produto = await this.prisma.produto.findFirst({
      where: {
        id,
        empresaId,
      },
      include: {
        saldoEstoque: true,
      },
    });

    if (!produto) {
      throw new NotFoundException(
        'Produto não encontrado.',
      );
    }

    return produto;
  }

  /**
   * Consulta um produto da empresa autenticada e registra o acesso.
   */
  async buscarPorId(
    empresaId: string,
    usuarioId: string,
    id: string,
  ) {
    const produto = await this.buscarProdutoPorEmpresa(empresaId, id);

    await this.registrarConsulta({
      empresaId,
      atorId: usuarioId,
      modulo: 'PRODUTOS',
      acao: 'CONSULTAR',
      entidade: 'PRODUTO',
      entidadeId: id,
    });

    return produto;
  }

  /**
   * Atualiza somente os campos enviados pelo cliente.
   *
   * Alterações cadastrais não modificam diretamente o estoque.
   * As mudanças de quantidade devem passar pelas movimentações,
   * para manter o histórico de entradas, saídas e ajustes.
   */
async atualizar(
  empresaId: string,
  usuarioId: string,
  id: string,
  dto: AtualizarProdutoDto,
) {
  try {
    // Evita aceitar uma atualização sem campos informados.
    const recebeuCampo = [
      dto.nome,
      dto.sku,
      dto.descricao,
      dto.categoriaId,
      dto.unidadeId,
      dto.codigoBarras,
      dto.preco,
      dto.custo,
      dto.perecivel,
      dto.peso,
    ].some((valor) => valor !== undefined);

    if (!recebeuCampo) {
      throw new BadRequestException(
        'Informe ao menos um campo para atualizar.',
      );
    }

    // Valida as referências que forem informadas.
    await this.validarCategoriaEUnidade(
      empresaId,
      dto.categoriaId,
      dto.unidadeId,
    );

    // Atualiza apenas os campos presentes no DTO.
    const data: Prisma.ProdutoUncheckedUpdateInput = {};

    if (dto.nome !== undefined) {
      data.nome = dto.nome.trim();
    }

    if (dto.sku !== undefined) {
      data.sku = dto.sku.trim().toUpperCase();
    }

    if (dto.descricao !== undefined) {
      data.descricao = dto.descricao?.trim() || null;
    }

    if (dto.categoriaId !== undefined) {
      data.categoriaId = dto.categoriaId ?? null;
    }

    if (dto.unidadeId !== undefined) {
      data.unidadeId = dto.unidadeId ?? null;
    }

    if (dto.codigoBarras !== undefined) {
      data.codigoBarras = dto.codigoBarras?.trim() || null;
    }

    if (dto.preco !== undefined) {
      data.preco = dto.preco;
    }

    if (dto.custo !== undefined) {
      data.custo = dto.custo;
    }

    if (dto.perecivel !== undefined) {
      data.perecivel = dto.perecivel;
    }

    if (dto.peso !== undefined) {
      data.peso = dto.peso ?? null;
    }

    return await this.prisma.$transaction(async (transacao) => {
      // Busca o estado anterior dentro da própria transação.
      const produtoAnterior = await transacao.produto.findFirst({
        where: {
          id,
          empresaId,
        },
      });

      if (!produtoAnterior) {
        throw new NotFoundException('Produto não encontrado.');
      }

      // Mantém a atualização limitada à empresa autenticada.
      const produtoAtualizado = await transacao.produto.update({
        where: {
          empresaId_id: {
            empresaId,
            id,
          },
        },
        data,
      });

      // Registra os estados anterior e posterior da entidade.
      await this.auditoria.registrar(
        {
          empresaId,
          atorId: usuarioId,
          tipoAtor: TipoAtorAuditoria.USUARIO_EMPRESA,
          modulo: 'PRODUTOS',
          acao: 'ATUALIZAR',
          entidade: 'PRODUTO',
          entidadeId: id,
          resultado: ResultadoAuditoria.SUCESSO,
          dadosAnteriores: {
            nome: produtoAnterior.nome,
            sku: produtoAnterior.sku,
            preco: produtoAnterior.preco.toString(),
            custo: produtoAnterior.custo.toString(),
            ativo: produtoAnterior.ativo,
          },
          dadosPosteriores: {
            nome: produtoAtualizado.nome,
            sku: produtoAtualizado.sku,
            preco: produtoAtualizado.preco.toString(),
            custo: produtoAtualizado.custo.toString(),
            ativo: produtoAtualizado.ativo,
          },
        },
        transacao,
      );

      return produtoAtualizado;
    });
  } catch (erro) {
    await this.registrarFalhaAuditoria({
      empresaId,
      atorId: usuarioId,
      modulo: 'PRODUTOS',
      acao: 'ATUALIZAR',
      entidade: 'PRODUTO',
      entidadeId: id,
      motivo: this.obterClassificacaoErro(erro),
    });

    this.tratarErroPrisma(erro);
  }
}

  /**
   * Ativa ou desativa um produto sem excluí-lo do banco.
   *
   * A alteração fica restrita à empresa autenticada.
   */
async alterarAtivacao(
  empresaId: string,
  usuarioId: string,
  id: string,
  ativo: boolean,
) {
  try {
    return await this.prisma.$transaction(async (transacao) => {
      // Consulta o estado anterior dentro da transação.
      const produtoAnterior = await transacao.produto.findFirst({
        where: {
          id,
          empresaId,
        },
        select: {
          id: true,
          nome: true,
          ativo: true,
        },
      });

      if (!produtoAnterior) {
        throw new NotFoundException('Produto não encontrado.');
      }

      const produtoAtualizado = await transacao.produto.update({
        where: {
          empresaId_id: {
            empresaId,
            id,
          },
        },
        data: {
          ativo,
        },
      });

      await this.auditoria.registrar(
        {
          empresaId,
          atorId: usuarioId,
          tipoAtor: TipoAtorAuditoria.USUARIO_EMPRESA,
          modulo: 'PRODUTOS',
          acao: 'ALTERAR_ATIVACAO',
          entidade: 'PRODUTO',
          entidadeId: id,
          resultado: ResultadoAuditoria.SUCESSO,
          dadosAnteriores: {
            nome: produtoAnterior.nome,
            ativo: produtoAnterior.ativo,
          },
          dadosPosteriores: {
            nome: produtoAtualizado.nome,
            ativo: produtoAtualizado.ativo,
          },
        },
        transacao,
      );

      return produtoAtualizado;
    });
  } catch (erro) {
    await this.registrarFalhaAuditoria({
      empresaId,
      atorId: usuarioId,
      modulo: 'PRODUTOS',
      acao: 'ALTERAR_ATIVACAO',
      entidade: 'PRODUTO',
      entidadeId: id,
      motivo: this.obterClassificacaoErro(erro),
    });

    this.tratarErroPrisma(erro);
  }
}

  /**
   * Registra uma entrada, saída ou ajuste no estoque.
   *
   * A alteração do saldo e o registro do histórico são executados
   * na mesma transação serializável.
   *
   * Entradas e saídas exigem quantidades positivas.
   * Ajustes aceitam diferenças positivas ou negativas, mas não zero.
   */
  async movimentarEstoque(
    empresaId: string,
    usuarioId: string,
    produtoId: string,
    dto: CriarMovimentacaoEstoqueDto,
  ) {
    const motivo = dto.motivo?.trim();

    if (!motivo) {
      throw new BadRequestException(
        'Informe o motivo da movimentação.',
      );
    }

    // Confere se a quantidade recebida é numérica e finita.
    if (!Number.isFinite(dto.quantidade)) {
      throw new BadRequestException(
        'Informe uma quantidade numérica válida.',
      );
    }

    // Utiliza Decimal para evitar erros de precisão em cálculos decimais.
    const quantidade = new Prisma.Decimal(
      dto.quantidade.toString(),
    );

    // Entrada e saída devem ser informadas como quantidades positivas.
    if (
      (dto.tipo === 'ENTRADA' || dto.tipo === 'SAIDA') &&
      !quantidade.isPositive()
    ) {
      throw new BadRequestException(
        'A quantidade de entrada ou saída deve ser maior que zero.',
      );
    }

    // Um ajuste expressa uma diferença assinada e não pode ser zero.
    if (dto.tipo === 'AJUSTE' && quantidade.isZero()) {
      throw new BadRequestException(
        'A quantidade do ajuste não pode ser zero.',
      );
    }

    try {
      return await this.prisma.$transaction(
        async (transacao) => {
          // Verifica se o produto pertence à empresa autenticada.
          const produto = await transacao.produto.findFirst({
            where: {
              id: produtoId,
              empresaId,
            },
            select: {
              id: true,
            },
          });

          if (!produto) {
            throw new NotFoundException(
              'Produto não encontrado nesta empresa.',
            );
          }

          // Busca o saldo usando o produto e a empresa como critérios.
          let saldo = await transacao.saldoEstoque.findFirst({
            where: {
              produtoId,
              empresaId,
            },
          });

          /*
           * Produtos cadastrados antes do controle de saldo podem não
           * possuir um registro de estoque. Nesse caso, cria um saldo
           * zerado dentro da transação antes de aplicar a movimentação.
           */
          if (!saldo) {
            saldo = await transacao.saldoEstoque.create({
              data: {
                empresaId,
                produtoId,
                quantidadeDisponivel: 0,
                quantidadeReservada: 0,
                estoqueMinimo: 0,
              },
            });
          }

          // Converte o saldo para Decimal para realizar o cálculo.
          const saldoAtual = new Prisma.Decimal(
            saldo.quantidadeDisponivel.toString(),
          );

          // Calcula a variação de acordo com o tipo de movimentação.
          let variacao: Prisma.Decimal;

          if (dto.tipo === 'ENTRADA') {
            variacao = quantidade;
          } else if (dto.tipo === 'SAIDA') {
            variacao = quantidade.negated();
          } else {
            // O ajuste já contém o sinal da diferença informada.
            variacao = quantidade;
          }

          const saldoApos = saldoAtual.plus(variacao);

          // Bloqueia operações que deixariam o saldo disponível negativo.
          if (saldoApos.isNegative()) {
            throw new BadRequestException(
              'Saldo insuficiente para esta operação. ' +
                `Disponível: ${saldoAtual.toString()}.`,
            );
          }

          // Atualiza o saldo dentro da mesma transação.
          const saldoAtualizado =
            await transacao.saldoEstoque.update({
              where: {
                id: saldo.id,
              },
              data: {
                quantidadeDisponivel: saldoApos,
              },
            });

          // Registra a movimentação para manter o histórico auditável.
          // Em ajustes, a quantidade mantém o sinal da diferença.
          const movimentacao =
            await transacao.movimentacaoEstoque.create({
              data: {
                empresaId,
                produtoId,
                tipo: dto.tipo,
                quantidade,
                saldoApos,
                motivo,
                referenciaId:
                  dto.referenciaId?.trim() || null,
                usuarioId,
              },
            });

          // Devolve a movimentação junto com o saldo atualizado.
         // Registra a operação na auditoria central, ainda na transação.
          await this.auditoria.registrar(
            {
              empresaId,
              atorId: usuarioId,
              tipoAtor: TipoAtorAuditoria.USUARIO_EMPRESA,
              modulo: 'ESTOQUE',
              acao: dto.tipo,
              entidade: 'PRODUTO',
              entidadeId: produtoId,
              resultado: ResultadoAuditoria.SUCESSO,
              dadosPosteriores: {
                movimentacaoId: movimentacao.id,
                produtoId,
                tipo: dto.tipo,
                quantidade: quantidade.toString(),
                saldoAnterior: saldoAtual.toString(),
                saldoApos: saldoApos.toString(),
                motivo,
                referenciaId: dto.referenciaId?.trim() || null,
              },
            },
            transacao,
          );

          // Devolve a movimentação junto com o saldo atualizado.
          return {
            ...movimentacao,
            saldoEstoque: saldoAtualizado,
          };
        },
        {
          // Solicita ao PostgreSQL o isolamento serializável.
          // Conflitos de concorrência são tratados abaixo.
          isolationLevel:
            Prisma.TransactionIsolationLevel.Serializable,
        },
      );
    } catch (erro) {
      /*
       * P2034 indica conflito de gravação ou falha de serialização.
       * P2002 pode ocorrer quando operações concorrentes tentam criar
       * simultaneamente o saldo de um produto que ainda não o possui.
       */
      if (
        erro instanceof Prisma.PrismaClientKnownRequestError &&
        (erro.code === 'P2034' || erro.code === 'P2002')
      ) {
        throw new ConflictException(
          'O estoque foi alterado simultaneamente. ' +
            'Consulte o saldo atualizado e tente novamente.',
        );
      }
      await this.registrarFalhaAuditoria({
        empresaId,
        atorId: usuarioId,
        modulo: 'ESTOQUE',
        acao:
          dto.tipo === 'ENTRADA' ||
          dto.tipo === 'SAIDA' ||
          dto.tipo === 'AJUSTE'
            ? dto.tipo
            : 'MOVIMENTAR',
        entidade: 'PRODUTO',
        entidadeId: produtoId,
        motivo: this.obterClassificacaoErro(erro),
      });

      // Preserva as exceções HTTP e trata os erros conhecidos do Prisma.
      this.tratarErroPrisma(erro);
    }
  }

  
  /**
   * Lista as cinco movimentações mais recentes de estoque
   * da empresa autenticada, incluindo os dados do produto.
   *
   * O filtro empresaId vem do contexto autenticado no controller.
   * Nenhum identificador de empresa é recebido do frontend.
   */
  async listarAtividadesRecentes(
    empresaId: string,
    usuarioId: string,
  ) {
    const movimentacoes =
      await this.prisma.movimentacaoEstoque.findMany({
        where: {
          empresaId,
        },
        orderBy: {
          criadoEm: 'desc',
        },
        take: 5,
        select: {
          id: true,
          tipo: true,
          quantidade: true,
          saldoApos: true,
          motivo: true,
          criadoEm: true,
          produto: {
            select: {
              id: true,
              nome: true,
              sku: true,
            },
          },
        },
      });

    // Converte os valores decimais para números no retorno da API.
    const resultado = movimentacoes.map((movimentacao) => ({
      id: movimentacao.id,
      tipo: movimentacao.tipo,
      quantidade: Number(movimentacao.quantidade),
      saldoApos: Number(movimentacao.saldoApos),
      motivo: movimentacao.motivo,
      criadoEm: movimentacao.criadoEm,
      produto: movimentacao.produto,
    }));

    await this.registrarConsulta({
      empresaId,
      atorId: usuarioId,
      modulo: 'ESTOQUE',
      acao: 'CONSULTAR_LISTA',
      entidade: 'MOVIMENTACAO_ESTOQUE',
      metadados: {
        quantidadeRetornada: resultado.length,
      },
    });

    return resultado;
  }

  /**
   * Lista o histórico de movimentações de um produto.
   *
   * Valida o vínculo do produto com a empresa, converte e valida
   * os parâmetros de paginação e retorna os registros mais recentes.
   */
  async listarMovimentacoes(
    empresaId: string,
    usuarioId: string,
    produtoId: string,
    filtros: ListarMovimentacoesEstoqueDto,
  ) {
    // Impede a consulta do histórico de produtos de outra empresa.
    await this.buscarProdutoPorEmpresa(empresaId, produtoId);

    /*
     * Parâmetros de query string podem chegar como texto.
     * Number() garante que o Prisma receba valores numéricos,
     * especialmente no argumento take da consulta paginada.
     */
    const pagina = Number(filtros.pagina ?? 1);
    const limite = Number(filtros.limite ?? 20);

    // Valida se o número da página é um inteiro positivo.
    if (!Number.isInteger(pagina) || pagina < 1) {
      throw new BadRequestException(
        'A página deve ser um número inteiro maior que zero.',
      );
    }

    // Aceita de 1 a 100 registros por página.
    if (!Number.isInteger(limite) || limite < 1 || limite > 100) {
      throw new BadRequestException(
        'O limite deve ser um número inteiro entre 1 e 100.',
      );
    }

    // Calcula quantos registros devem ser ignorados.
    const skip = (pagina - 1) * limite;

    // Todas as consultas do histórico ficam limitadas à empresa e produto.
    const where: Prisma.MovimentacaoEstoqueWhereInput = {
      empresaId,
      produtoId,
    };

    // Busca os registros e a contagem total em uma única transação.
    const [dados, total] = await this.prisma.$transaction([
      this.prisma.movimentacaoEstoque.findMany({
        where,
        orderBy: {
          criadoEm: 'desc',
        },
        skip,
        take: limite,
      }),

      this.prisma.movimentacaoEstoque.count({
        where,
      }),
    ]);

    // Retorna os dados e os metadados da paginação.
    const resultado = {
      dados,
      total,
      pagina,
      limite,
      totalPaginas: Math.ceil(total / limite),
    };

    await this.registrarConsulta({
      empresaId,
      atorId: usuarioId,
      modulo: 'ESTOQUE',
      acao: 'CONSULTAR_LISTA',
      entidade: 'MOVIMENTACAO_ESTOQUE',
      entidadeId: produtoId,
      metadados: {
        pagina,
        limite,
        quantidadeRetornada: dados.length,
        totalRegistros: total,
      },
    });

    return resultado;
  }

  /**
   * Confere se a categoria e a unidade informadas pertencem
   * à empresa autenticada.
   *
   * Como o schema atual não declara relações Prisma entre Produto,
   * Categoria e Unidade, essa validação é realizada explicitamente.
   */
  private async validarCategoriaEUnidade(
    empresaId: string,
    categoriaId?: string | null,
    unidadeId?: string | null,
  ): Promise<void> {
    if (categoriaId != null) {
      const categoria = await this.prisma.categoria.findFirst({
        where: {
          id: categoriaId,
          empresaId,
        },
        select: {
          id: true,
        },
      });

      if (!categoria) {
        throw new BadRequestException(
          'Categoria inválida ou não pertence à empresa autenticada.',
        );
      }
    }

    if (unidadeId != null) {
      const unidade = await this.prisma.unidade.findFirst({
        where: {
          id: unidadeId,
          empresaId,
        },
        select: {
          id: true,
        },
      });

      if (!unidade) {
        throw new BadRequestException(
          'Unidade inválida ou não pertence à empresa autenticada.',
        );
      }
    }
  }

    /**
   * Registra uma tentativa recusada fora da transação comercial.
   *
   * Uma falha na auditoria não deve substituir a exceção original
   * que impediu a operação de negócio.
   */
  /**
   * Registra consultas concluídas antes de devolver os dados ao controller.
   *
   * A chamada é aguardada de propósito: se a auditoria falhar, a resposta
   * protegida não é entregue sem o respectivo registro.
   */
  private async registrarConsulta(
    entrada: Omit<
      RegistrarEventoAuditoriaInput,
      'tipoAtor' | 'resultado'
    >,
  ): Promise<void> {
    await this.auditoria.registrar({
      ...entrada,
      tipoAtor: TipoAtorAuditoria.USUARIO_EMPRESA,
      resultado: ResultadoAuditoria.SUCESSO,
    });
  }

  private async registrarFalhaAuditoria(
    entrada: Omit<
      RegistrarEventoAuditoriaInput,
      'tipoAtor' | 'resultado'
    >,
  ): Promise<void> {
    try {
      await this.auditoria.registrar({
        ...entrada,
        tipoAtor: TipoAtorAuditoria.USUARIO_EMPRESA,
        resultado: ResultadoAuditoria.FALHA,
      });
    } catch (erroAuditoria) {
      this.logger.error(
        'Não foi possível registrar a falha na auditoria de produtos/estoque.',
        erroAuditoria instanceof Error
          ? erroAuditoria.stack
          : undefined,
      );
    }
  }

  /**
   * Classifica a falha sem armazenar mensagens completas,
   * dados enviados pelo cliente ou informações sensíveis.
   */
  private obterClassificacaoErro(erro: unknown): string {
    return erro instanceof Error
      ? erro.constructor.name
      : 'ERRO_DESCONHECIDO';
  }
  /**
   * Converte erros conhecidos do Prisma em exceções HTTP.
   *
   * P2002: conflito em uma restrição única, como SKU duplicado.
   * P2025: registro necessário não encontrado.
   *
   * Outros erros são propagados para o tratamento padrão do NestJS.
   */
  private tratarErroPrisma(erro: unknown): never {
    if (
      erro instanceof Prisma.PrismaClientKnownRequestError &&
      erro.code === 'P2002'
    ) {
      throw new ConflictException(
        'Já existe um registro com uma chave única conflitante para esta empresa, como um SKU duplicado.',
      );
    }

    if (
      erro instanceof Prisma.PrismaClientKnownRequestError &&
      erro.code === 'P2025'
    ) {
      throw new NotFoundException(
        'Produto não encontrado.',
      );
    }

    throw erro;
  }
}