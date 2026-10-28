import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service.js';
import { CriarVendaDto } from './dto/criar-venda.dto.js';
import { ListarVendasDto } from './dto/listar-vendas.dto.js';

/**
 * Serviço responsável pelas regras de negócio das vendas.
 *
 * A venda, os itens, a baixa do estoque e o histórico de
 * movimentações são gravados na mesma transação.
 */
@Injectable()
export class VendasService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Registra uma venda concluída para a empresa autenticada.
   *
   * Os preços e o total são calculados pelo backend.
   * A disponibilidade do estoque é validada antes da gravação.
   */
  async criar(
    empresaId: string,
    usuarioId: string,
    dto: CriarVendaDto,
  ) {
    if (!dto.itens?.length) {
      throw new BadRequestException(
        'A venda deve conter pelo menos um produto.',
      );
    }

    const produtoIds = dto.itens.map((item) => item.produtoId);
    const produtoIdsUnicos = [...new Set(produtoIds)];

    if (produtoIds.length !== produtoIdsUnicos.length) {
      throw new BadRequestException(
        'Cada produto deve aparecer apenas uma vez na venda.',
      );
    }

    // Valida as quantidades antes de iniciar a transação.
    for (const item of dto.itens) {
      if (
        !Number.isFinite(item.quantidade) ||
        item.quantidade <= 0
      ) {
        throw new BadRequestException(
          'Todas as quantidades devem ser maiores que zero.',
        );
      }
    }

    try {
      return await this.prisma.$transaction(
        async (transacao) => {
          // Confirma que o usuário está ativo e pertence à empresa.
          const usuario = await transacao.usuario.findFirst({
            where: {
              id: usuarioId,
              empresaId,
              ativo: true,
            },
            select: {
              id: true,
              nome: true,
            },
          });

          if (!usuario) {
            throw new ForbiddenException(
              'O usuário não está ativo ou não pertence à empresa autenticada.',
            );
          }

          // Busca somente produtos ativos da empresa autenticada.
          const produtos = await transacao.produto.findMany({
            where: {
              empresaId,
              ativo: true,
              id: {
                in: produtoIdsUnicos,
              },
            },
            select: {
              id: true,
              nome: true,
              sku: true,
              preco: true,
              custo: true,
            },
          });

          if (produtos.length !== produtoIdsUnicos.length) {
            throw new NotFoundException(
              'Um ou mais produtos não foram encontrados, estão inativos ou não pertencem à empresa autenticada.',
            );
          }

          const produtosPorId = new Map(
            produtos.map((produto) => [produto.id, produto]),
          );

          // Busca o saldo de estoque dos produtos solicitados.
          const saldos = await transacao.saldoEstoque.findMany({
            where: {
              empresaId,
              produtoId: {
                in: produtoIdsUnicos,
              },
            },
          });

          const saldosPorProduto = new Map(
            saldos.map((saldo) => [saldo.produtoId, saldo]),
          );

          /*
           * Prepara os itens usando os preços do cadastro.
           * Nenhum preço ou subtotal é aceito do frontend.
           */
          const itensCalculados = dto.itens.map((itemDto) => {
            const produto = produtosPorId.get(itemDto.produtoId);
            const saldo = saldosPorProduto.get(itemDto.produtoId);

            if (!produto) {
              throw new NotFoundException(
                'Produto não encontrado nesta empresa.',
              );
            }

            if (!saldo) {
              throw new BadRequestException(
                `O produto ${produto.nome} não possui saldo cadastrado.`,
              );
            }

            const quantidade = new Prisma.Decimal(
              itemDto.quantidade.toString(),
            );

            const saldoAtual = new Prisma.Decimal(
              saldo.quantidadeDisponivel.toString(),
            );

            if (quantidade.greaterThan(saldoAtual)) {
              throw new BadRequestException(
                `Estoque insuficiente para ${produto.nome}. ` +
                  `Disponível: ${saldoAtual.toString()}.`,
              );
            }

            const precoUnitario = new Prisma.Decimal(
              produto.preco.toString(),
            );

            // O subtotal é arredondado para duas casas decimais.
            const subtotal = precoUnitario
              .mul(quantidade)
              .toDecimalPlaces(2);

            // Captura o custo atual para preservar o histórico desta venda.
            const custoUnitario = new Prisma.Decimal(
                produto.custo.toString(),
            );  
            const saldoApos = saldoAtual.minus(quantidade);

            return {
              produto,
              saldo,
              quantidade,
              saldoApos,
              precoUnitario,
              custoUnitario,
              subtotal,
            };
          });

          // Calcula o total com aritmética decimal.
          const total = itensCalculados
            .reduce(
              (acumulado, item) =>
                acumulado.plus(item.subtotal),
              new Prisma.Decimal(0),
            )
            .toDecimalPlaces(2);

          // Registra a venda e seus itens.
          const venda = await transacao.venda.create({
            data: {
              empresaId,
              usuarioId,
              formaPagamento: dto.formaPagamento,
              total,
              itens: {
                create: itensCalculados.map((item) => ({
                  produtoId: item.produto.id,
                  quantidade: item.quantidade,
                  precoUnitario: item.precoUnitario,
                  custoUnitario: item.custoUnitario,
                  subtotal: item.subtotal,
                })),
              },
            },
            include: {
              itens: {
                include: {
                  produto: {
                    select: {
                      id: true,
                      nome: true,
                      sku: true,
                    },
                  },
                },
              },
              usuario: {
                select: {
                  id: true,
                  nome: true,
                },
              },
            },
          });

          // Baixa os saldos e registra as saídas no histórico.
          for (const item of itensCalculados) {
            await transacao.saldoEstoque.update({
              where: {
                id: item.saldo.id,
              },
              data: {
                quantidadeDisponivel: item.saldoApos,
              },
            });

            await transacao.movimentacaoEstoque.create({
              data: {
                empresaId,
                produtoId: item.produto.id,
                tipo: 'SAIDA',
                quantidade: item.quantidade,
                saldoApos: item.saldoApos,
                motivo: `Venda ${venda.id}`,
                referenciaId: venda.id,
                usuarioId,
              },
            });
          }

          // Retorna os valores em formato apropriado para a API.
          // Calcula os indicadores de cada item e da venda recém-criada.
          const itensComFinanceiro = venda.itens.map((item) => ({
            id: item.id,
            produto: item.produto,
            quantidade: Number(item.quantidade),
            precoUnitario: Number(item.precoUnitario),
            subtotal: Number(item.subtotal),
            ...this.calcularFinanceiroItemVenda(item),
          }));
        
          const resumoFinanceiro = this.calcularResumoFinanceiroVenda(
            venda.total,
            venda.itens,
          );
        
          // Retorna o resultado financeiro junto com os dados da venda.
          return {
            id: venda.id,
            empresaId: venda.empresaId,
            formaPagamento: venda.formaPagamento,
            total: Number(venda.total),
            criadoEm: venda.criadoEm,
            usuario: venda.usuario,
            ...resumoFinanceiro,
            itens: itensComFinanceiro,
          };
        },
        {
          // Reduz o risco de inconsistências em vendas concorrentes.
          isolationLevel:
            Prisma.TransactionIsolationLevel.Serializable,
        },
      );
    } catch (erro) {
      // O PostgreSQL pode rejeitar uma transação concorrente.
      if (
        erro instanceof Prisma.PrismaClientKnownRequestError &&
        erro.code === 'P2034'
      ) {
        throw new ConflictException(
          'O estoque foi alterado simultaneamente. ' +
            'Consulte o saldo atualizado e tente novamente.',
        );
      }

      // Preserva as demais exceções para o tratamento do NestJS.
      throw erro;
    }
  }
    /**
   * Calcula os indicadores do dashboard para a empresa autenticada.
   *
   * Inclui:
   * - Faturamento, quantidade de vendas e ticket médio do mês atual.
   * - Os mesmos indicadores para o mês anterior.
   * - Faturamento e quantidade de vendas por dia nos últimos sete dias.
   *
   * O filtro por empresa é aplicado em todas as consultas.
   */
  async resumoDashboard(empresaId: string) {
    const agora = new Date();

    // Define o início de cada mês usando o calendário local do servidor.
    const inicioMesAtual = new Date(
      agora.getFullYear(),
      agora.getMonth(),
      1,
    );

    const inicioProximoMes = new Date(
      agora.getFullYear(),
      agora.getMonth() + 1,
      1,
    );

    const inicioMesAnterior = new Date(
      agora.getFullYear(),
      agora.getMonth() - 1,
      1,
    );

    // Inclui hoje e os seis dias anteriores no gráfico semanal.
    const inicioHoje = new Date(
      agora.getFullYear(),
      agora.getMonth(),
      agora.getDate(),
    );

    const inicioSeteDias = new Date(inicioHoje);
    inicioSeteDias.setDate(inicioSeteDias.getDate() - 6);

    const inicioAmanha = new Date(inicioHoje);
    inicioAmanha.setDate(inicioAmanha.getDate() + 1);

    /*
     * As consultas são independentes e podem ser executadas em paralelo.
     * O total é calculado pelo PostgreSQL usando os valores persistidos.
     */
    const [mesAtual, mesAnterior, vendasDosSeteDias] =
      await Promise.all([
        this.prisma.venda.aggregate({
          where: {
            empresaId,
            criadoEm: {
              gte: inicioMesAtual,
              lt: inicioProximoMes,
            },
          },
          _sum: {
            total: true,
          },
          _count: {
            _all: true,
          },
        }),

        this.prisma.venda.aggregate({
          where: {
            empresaId,
            criadoEm: {
              gte: inicioMesAnterior,
              lt: inicioMesAtual,
            },
          },
          _sum: {
            total: true,
          },
          _count: {
            _all: true,
          },
        }),

        this.prisma.venda.findMany({
          where: {
            empresaId,
            criadoEm: {
              gte: inicioSeteDias,
              lt: inicioAmanha,
            },
          },
          select: {
            total: true,
            criadoEm: true,
          },
          orderBy: {
            criadoEm: 'asc',
          },
        }),
      ]);

    const faturamentoAtual = Number(mesAtual._sum.total ?? 0);
    const quantidadeAtual = mesAtual._count._all;

    const faturamentoAnterior = Number(
      mesAnterior._sum.total ?? 0,
    );

    const quantidadeAnterior = mesAnterior._count._all;

    // O ticket médio é zero quando não há vendas no período.
    const ticketMedioAtual =
      quantidadeAtual > 0
        ? faturamentoAtual / quantidadeAtual
        : 0;

    const ticketMedioAnterior =
      quantidadeAnterior > 0
        ? faturamentoAnterior / quantidadeAnterior
        : 0;

    /*
     * Inicializa os sete dias, inclusive os dias sem vendas.
     * Isso garante que o gráfico sempre tenha sete posições.
     */
    function obterChaveData(data: Date): string {
      const ano = data.getFullYear();
      const mes = String(data.getMonth() + 1).padStart(2, '0');
      const dia = String(data.getDate()).padStart(2, '0');

      return `${ano}-${mes}-${dia}`;
    }

    const resumoPorDia = new Map<
      string,
      {
        data: string;
        dia: string;
        faturamento: number;
        quantidadeVendas: number;
      }
    >();

    for (let indice = 0; indice < 7; indice += 1) {
      const data = new Date(inicioSeteDias);
      data.setDate(inicioSeteDias.getDate() + indice);

      const chave = obterChaveData(data);

      resumoPorDia.set(chave, {
        data: chave,
        dia: new Intl.DateTimeFormat('pt-BR', {
          weekday: 'short',
        })
          .format(data)
          .replace('.', ''),
        faturamento: 0,
        quantidadeVendas: 0,
      });
    }

    // Soma os valores de cada venda no respectivo dia.
    for (const venda of vendasDosSeteDias) {
      const chave = obterChaveData(venda.criadoEm);
      const resumoDia = resumoPorDia.get(chave);

      if (!resumoDia) {
        continue;
      }

      resumoDia.faturamento += Number(venda.total);
      resumoDia.quantidadeVendas += 1;
    }

    return {
      mesAtual: {
        faturamento: faturamentoAtual,
        quantidadeVendas: quantidadeAtual,
        ticketMedio: ticketMedioAtual,
      },
      mesAnterior: {
        faturamento: faturamentoAnterior,
        quantidadeVendas: quantidadeAnterior,
        ticketMedio: ticketMedioAnterior,
      },
      ultimosSeteDias: Array.from(resumoPorDia.values()),
    };
  }

  
  /**
   * Consolida formas de pagamento e produtos vendidos no mês atual.
   *
   * Todos os registros são filtrados pela empresa autenticada.
   * A análise utiliza o total das vendas e os subtotais históricos
   * dos itens, sem depender do preço atual do cadastro do produto.
   *
   * Não realiza gravações nem alterações no banco de dados.
   */
  async analiseDashboard(empresaId: string) {
    const agora = new Date();

    // Utiliza os limites do mês atual, como no resumo do dashboard.
    const inicioMes = new Date(
      agora.getFullYear(),
      agora.getMonth(),
      1,
    );

    const inicioProximoMes = new Date(
      agora.getFullYear(),
      agora.getMonth() + 1,
      1,
    );

    /*
     * Consulta as formas de pagamento e os produtos vendidos
     * em paralelo. Os valores permanecem restritos à empresa.
     */
    const [pagamentosAgrupados, produtosAgrupados] =
      await Promise.all([
        this.prisma.venda.groupBy({
          by: ['formaPagamento'],
          where: {
            empresaId,
            criadoEm: {
              gte: inicioMes,
              lt: inicioProximoMes,
            },
          },
          _sum: {
            total: true,
          },
          _count: {
            _all: true,
          },
        }),

        this.prisma.itemVenda.groupBy({
          by: ['produtoId'],
          where: {
            venda: {
              is: {
                empresaId,
                criadoEm: {
                  gte: inicioMes,
                  lt: inicioProximoMes,
                },
              },
            },
          },
          _sum: {
            quantidade: true,
            subtotal: true,
          },
        }),
      ]);

    // Mantém todas as modalidades no gráfico, inclusive as sem vendas.
    const modalidades = [
      'DINHEIRO',
      'PIX',
      'CARTAO_DEBITO',
      'CARTAO_CREDITO',
      'OUTRO',
    ] as const;

    const nomesModalidades: Record<string, string> = {
      DINHEIRO: 'Dinheiro',
      PIX: 'PIX',
      CARTAO_DEBITO: 'Cartão de débito',
      CARTAO_CREDITO: 'Cartão de crédito',
      OUTRO: 'Outros',
    };

    const pagamentosPorModalidade = new Map(
      pagamentosAgrupados.map((item) => [
        item.formaPagamento,
        item,
      ] as const),
    );

    const faturamentoTotal = pagamentosAgrupados.reduce(
      (total, item) => total + Number(item._sum.total ?? 0),
      0,
    );

    const quantidadeTotalVendas = pagamentosAgrupados.reduce(
      (total, item) => total + item._count._all,
      0,
    );

    const formasPagamento = modalidades.map((modalidade) => {
      const item = pagamentosPorModalidade.get(modalidade);
      const faturamento = Number(item?._sum.total ?? 0);
      const quantidadeVendas = item?._count._all ?? 0;

      return {
        formaPagamento: modalidade,
        nome: nomesModalidades[modalidade],
        faturamento,
        quantidadeVendas,
        percentualFaturamento:
          faturamentoTotal > 0
            ? Number(
                ((faturamento / faturamentoTotal) * 100).toFixed(2),
              )
            : 0,
        percentualVendas:
          quantidadeTotalVendas > 0
            ? Number(
                (
                  (quantidadeVendas / quantidadeTotalVendas) *
                  100
                ).toFixed(2),
              )
            : 0,
      };
    });

    /*
     * Busca os nomes e SKUs dos produtos pertencentes à empresa.
     * A venda histórica é calculada pelos subtotais dos itens,
     * e não pelo preço atual do cadastro.
     */
    const idsProdutos = produtosAgrupados.map(
      (item) => item.produtoId,
    );

    const produtosCadastrados =
      idsProdutos.length > 0
        ? await this.prisma.produto.findMany({
            where: {
              empresaId,
              id: {
                in: idsProdutos,
              },
            },
            select: {
              id: true,
              nome: true,
              sku: true,
            },
          })
        : [];

    const produtosPorId = new Map(
      produtosCadastrados.map((produto) => [
        produto.id,
        produto,
      ] as const),
    );

    const produtosConsolidados = produtosAgrupados.flatMap(
      (item) => {
        const produto = produtosPorId.get(item.produtoId);

        // Ignora apenas itens sem cadastro correspondente.
        if (!produto) {
          return [];
        }

        return [
          {
            produtoId: produto.id,
            nome: produto.nome,
            sku: produto.sku,
            quantidadeVendida: Number(
              item._sum.quantidade ?? 0,
            ),
            faturamento: Number(item._sum.subtotal ?? 0),
          },
        ];
      },
    );

    // O frontend poderá alternar entre dois rankings corretos.
    const produtosPorQuantidade = [
      ...produtosConsolidados,
    ]
      .sort(
        (a, b) =>
          b.quantidadeVendida - a.quantidadeVendida ||
          b.faturamento - a.faturamento,
      )
      .slice(0, 8);

    const produtosPorFaturamento = [
      ...produtosConsolidados,
    ]
      .sort(
        (a, b) =>
          b.faturamento - a.faturamento ||
          b.quantidadeVendida - a.quantidadeVendida,
      )
      .slice(0, 8);

    return {
      periodo: {
        inicio: inicioMes.toISOString(),
        fim: inicioProximoMes.toISOString(),
      },
      faturamentoTotal,
      quantidadeTotalVendas,
      formasPagamento,
      produtosPorQuantidade,
      produtosPorFaturamento,
    };
  }


  /**
   * Consolida as atividades recentes de vendas, produtos e estoque.
   *
   * As saídas de estoque vinculadas a vendas são identificadas
   * pelo referenciaId e não são exibidas novamente como atividades
   * independentes, evitando duplicidade na linha do tempo.
   *
   * Todas as consultas são limitadas à empresa autenticada.
   */
  async listarAtividadesDashboard(empresaId: string) {
    const [vendas, produtos, movimentacoes] = await Promise.all([
      this.prisma.venda.findMany({
        where: { empresaId },
        orderBy: { criadoEm: 'desc' },
        take: 10,
        select: {
          id: true,
          total: true,
          formaPagamento: true,
          criadoEm: true,
          usuario: {
            select: {
              id: true,
              nome: true,
            },
          },
          itens: {
          select: {
            quantidade: true,
            produto: {
              select: {
                nome: true,
              },
            },
          },
        },
      },
      }),

      this.prisma.produto.findMany({
        where: { empresaId },
        orderBy: { criadoEm: 'desc' },
        take: 10,
        select: {
          id: true,
          nome: true,
          sku: true,
          criadoEm: true,
        },
      }),

      this.prisma.movimentacaoEstoque.findMany({
        where: { empresaId },
        orderBy: { criadoEm: 'desc' },
        take: 30,
        select: {
          id: true,
          tipo: true,
          quantidade: true,
          saldoApos: true,
          motivo: true,
          referenciaId: true,
          criadoEm: true,
          produto: {
            select: {
              id: true,
              nome: true,
              sku: true,
            },
          },
        },
      }),
    ]);

    // Busca quais referências de saída correspondem a vendas reais
    // da mesma empresa, evitando ocultar saídas manuais por engano.
    // Só considera referências no formato UUID para consultar vendas.
    // O campo referenciaId aceita texto livre e pode conter valores
    // que não são identificadores válidos de Venda.
    const referenciasVenda = [
      ...new Set(
        movimentacoes
          .filter(
            (movimentacao) =>
              movimentacao.tipo === 'SAIDA' &&
              typeof movimentacao.referenciaId === 'string' &&
              /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
                movimentacao.referenciaId,
              ),
          )
          .map((movimentacao) => movimentacao.referenciaId as string),
      ),
    ];

    const vendasReferenciadas =
      referenciasVenda.length > 0
        ? await this.prisma.venda.findMany({
            where: {
              empresaId,
              id: { in: referenciasVenda },
            },
            select: { id: true },
          })
        : [];

    const idsVendas = new Set(
      vendasReferenciadas.map((venda) => venda.id),
    );

    const atividadesVenda = vendas.map((venda) => {
      // Apresenta a forma de pagamento em linguagem amigável.
      const formasPagamento: Record<string, string> = {
        DINHEIRO: "Dinheiro",
        PIX: "PIX",
        CARTAO_DEBITO: "Cartão de débito",
        CARTAO_CREDITO: "Cartão de crédito",
        OUTRO: "Outro",
      };
    
      // Exibe cada produto vendido e sua respectiva quantidade.
      const produtosVendidos = venda.itens
        .map((item) => {
          const quantidade = Number(item.quantidade).toLocaleString(
            "pt-BR",
            { maximumFractionDigits: 3 },
          );
        
          return `${item.produto.nome} (${quantidade} un.)`;
        })
        .join(", ");
      
      return {
        id: `venda:${venda.id}`,
        tipo: "VENDA" as const,
        titulo: "Venda realizada",
        detalhe:
          `${produtosVendidos} · ` +
          `${formasPagamento[venda.formaPagamento] ?? venda.formaPagamento}`,
        referencia: `Venda #${venda.id.slice(0, 8)}`,
        valor: Number(venda.total),
        responsavel: venda.usuario.nome,
        criadoEm: venda.criadoEm,
      };
    });

    const atividadesProduto = produtos.map((produto) => ({
      id: `produto:${produto.id}`,
      tipo: 'PRODUTO_CADASTRADO' as const,
      titulo: 'Produto cadastrado',
      detalhe: produto.nome,
      referencia: produto.sku,
      criadoEm: produto.criadoEm,
    }));

    const atividadesEstoque = movimentacoes
      .filter(
        (movimentacao) =>
          !(
            movimentacao.tipo === 'SAIDA' &&
            movimentacao.referenciaId &&
            idsVendas.has(movimentacao.referenciaId)
          ),
      )
      .map((movimentacao) => ({
        id: `estoque:${movimentacao.id}`,
        tipo: movimentacao.tipo,
        titulo:
          movimentacao.tipo === 'ENTRADA'
            ? 'Entrada de estoque'
            : movimentacao.tipo === 'SAIDA'
              ? 'Saída de estoque'
              : movimentacao.tipo === 'AJUSTE'
                ? 'Ajuste de estoque'
                : movimentacao.tipo === 'RESERVA'
                  ? 'Reserva de estoque'
                  : 'Liberação de estoque',
        detalhe: movimentacao.produto.nome,
        referencia: movimentacao.motivo,
        quantidade: Number(movimentacao.quantidade),
        saldoApos: Number(movimentacao.saldoApos),
        criadoEm: movimentacao.criadoEm,
      }));

    return [
      ...atividadesVenda,
      ...atividadesProduto,
      ...atividadesEstoque,
    ]
      .sort(
        (a, b) =>
          new Date(b.criadoEm).getTime() -
          new Date(a.criadoEm).getTime(),
      )
      .slice(0, 10);
  }

    /**
   * Lista as vendas da empresa autenticada, com paginação
   * e filtro opcional por forma de pagamento.
   */
  async listar(
    empresaId: string,
    filtros: ListarVendasDto,
  ) {
    const pagina = Number(filtros.pagina ?? 1);
    const limite = Number(filtros.limite ?? 20);

    if (!Number.isInteger(pagina) || pagina < 1) {
      throw new BadRequestException(
        'A página deve ser um número inteiro maior que zero.',
      );
    }

    if (
      !Number.isInteger(limite) ||
      limite < 1 ||
      limite > 100
    ) {
      throw new BadRequestException(
        'O limite deve ser um número inteiro entre 1 e 100.',
      );
    }

    const skip = (pagina - 1) * limite;

    const where: Prisma.VendaWhereInput = {
      empresaId,
      ...(filtros.formaPagamento
        ? { formaPagamento: filtros.formaPagamento }
        : {}),
    };

    const [dados, total] = await this.prisma.$transaction([
      this.prisma.venda.findMany({
        where,
        orderBy: {
          criadoEm: 'desc',
        },
        skip,
        take: limite,
        select: {
          id: true,
          formaPagamento: true,
          total: true,
          criadoEm: true,
          usuario: {
            select: {
              id: true,
              nome: true,
            },
          },
          _count: {
            select: {
              itens: true,
            },
          },
          itens: {
            select: {
              quantidade: true,
              subtotal: true,
              custoUnitario: true,
            },
          },
        },
      }),

      this.prisma.venda.count({
        where,
      }),
    ]);

    return {
      dados: dados.map((venda) => ({
        id: venda.id,
        formaPagamento: venda.formaPagamento,
        total: Number(venda.total),
        criadoEm: venda.criadoEm,
        usuario: venda.usuario,
        quantidadeItens: venda._count.itens,
        ...this.calcularResumoFinanceiroVenda(venda.total,venda.itens),

      })),
      total,
      pagina,
      limite,
      totalPaginas: Math.ceil(total / limite),
    };
  }

  /**
   * Busca os detalhes de uma venda pertencente à empresa autenticada.
   */
  async buscarPorId(
    empresaId: string,
    vendaId: string,
  ) {
    const venda = await this.prisma.venda.findFirst({
      where: {
        id: vendaId,
        empresaId,
      },
      select: {
        id: true,
        formaPagamento: true,
        total: true,
        criadoEm: true,
        usuario: {
          select: {
            id: true,
            nome: true,
          },
        },
        itens: {
          select: {
            id: true,
            quantidade: true,
            precoUnitario: true,
            subtotal: true,
            custoUnitario: true,
            produto: {
              select: {
                id: true,
                nome: true,
                sku: true,
              },
            },
          },
        },
      },
    });

    if (!venda) {
      throw new NotFoundException(
        'Venda não encontrada nesta empresa.',
      );
    }


  // Calcula os indicadores financeiros de cada item histórico.
  const itensComFinanceiro = venda.itens.map((item) => ({
    id: item.id,
    produto: item.produto,
    quantidade: Number(item.quantidade),
    precoUnitario: Number(item.precoUnitario),
    subtotal: Number(item.subtotal),
    ...this.calcularFinanceiroItemVenda(item),
  }));

    // Calcula o resumo financeiro da venda usando os mesmos custos históricos.
    const resumoFinanceiro = this.calcularResumoFinanceiroVenda(
      venda.total,
      venda.itens,
    );
      return {
      id: venda.id,
      formaPagamento: venda.formaPagamento,
      total: Number(venda.total),
      criadoEm: venda.criadoEm,
      usuario: venda.usuario,
      ...resumoFinanceiro,
      itens: itensComFinanceiro,
    };
  }
  
  /**
   * Calcula o custo total e o lucro bruto de um item da venda.
   * Utiliza exclusivamente o custo histórico registrado na transação.
   */
  private calcularFinanceiroItemVenda(item: {
    quantidade: Prisma.Decimal;
    subtotal: Prisma.Decimal;
    custoUnitario: Prisma.Decimal | null;
  }) {
    if (item.custoUnitario === null) {
      return {
        custoUnitario: null,
        custoTotal: null,
        lucroBruto: null,
        margemBrutaPercentual: null,
        custoHistoricoDisponivel: false,
      };
    }

    const quantidade = new Prisma.Decimal(
      item.quantidade.toString(),
    );

    const subtotal = new Prisma.Decimal(
      item.subtotal.toString(),
    );

    const custoUnitario = new Prisma.Decimal(
      item.custoUnitario.toString(),
    );

    // Arredonda o custo total do item para centavos.
    const custoTotal = custoUnitario
      .mul(quantidade)
      .toDecimalPlaces(2);

    const lucroBruto = subtotal
      .minus(custoTotal)
      .toDecimalPlaces(2);

    // A margem não é calculável quando o subtotal é zero.
    const margemBrutaPercentual = subtotal.greaterThan(0)
      ? Number(
          lucroBruto
            .div(subtotal)
            .mul(100)
            .toDecimalPlaces(2),
        )
      : null;

    return {
      custoUnitario: Number(custoUnitario),
      custoTotal: Number(custoTotal),
      lucroBruto: Number(lucroBruto),
      margemBrutaPercentual,
      custoHistoricoDisponivel: true,
    };
  }

  /**
   * Calcula os indicadores financeiros consolidados da venda.
   *
   * Se algum item não tiver custo histórico, não apresenta
   * lucro total nem margem como se fossem valores comprovados.
   */
  private calcularResumoFinanceiroVenda(
    total: Prisma.Decimal,
    itens: Array<{
      quantidade: Prisma.Decimal;
      subtotal: Prisma.Decimal;
      custoUnitario: Prisma.Decimal | null;
    }>,
  ) {
    const custosDisponiveis =
      itens.length > 0 &&
      itens.every((item) => item.custoUnitario !== null);

    if (!custosDisponiveis) {
      return {
        custoHistoricoDisponivel: false,
        custoTotal: null,
        lucroBrutoTotal: null,
        margemBrutaPercentual: null,
      };
    }

    const custoTotal = itens
      .reduce((acumulado, item) => {
        if (item.custoUnitario === null) {
          return acumulado;
        }

        const custoUnitario = new Prisma.Decimal(
          item.custoUnitario.toString(),
        );

        const quantidade = new Prisma.Decimal(
          item.quantidade.toString(),
        );

        const custoItem = custoUnitario
          .mul(quantidade)
          .toDecimalPlaces(2);

        return acumulado.plus(custoItem);
      }, new Prisma.Decimal(0))
      .toDecimalPlaces(2);

    const totalVenda = new Prisma.Decimal(total.toString());

    const lucroBrutoTotal = totalVenda
      .minus(custoTotal)
      .toDecimalPlaces(2);

    const margemBrutaPercentual = totalVenda.greaterThan(0)
      ? Number(
          lucroBrutoTotal
            .div(totalVenda)
            .mul(100)
            .toDecimalPlaces(2),
        )
      : null;

    return {
      custoHistoricoDisponivel: true,
      custoTotal: Number(custoTotal),
      lucroBrutoTotal: Number(lucroBrutoTotal),
      margemBrutaPercentual,
    };
  }
}