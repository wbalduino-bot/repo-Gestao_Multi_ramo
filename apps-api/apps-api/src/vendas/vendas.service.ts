
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
 * Responsabilidades:
 * - Validar usuário, produtos e disponibilidade em estoque.
 * - Calcular preços, subtotais e total no backend.
 * - Registrar a venda e seus itens.
 * - Baixar o estoque e registrar as movimentações na mesma transação.
 * - Impedir acesso a dados de outras empresas.
 */
@Injectable()
export class VendasService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Registra uma venda concluída.
   *
   * A venda, seus itens, as baixas de estoque e as movimentações
   * são gravadas em uma única transação serializável.
   *
   * Se uma operação falhar, todas as alterações serão revertidas.
   */
  async criar(
    empresaId: string,
    usuarioId: string,
    dto: CriarVendaDto,
  ) {
    // Validação adicional para proteger o serviço de chamadas diretas.
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

          // Busca os saldos de todos os produtos da venda.
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
           * Prepara os itens usando preços do banco.
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

            // Calcula o subtotal com arredondamento para centavos.
            const subtotal = precoUnitario
              .mul(quantidade)
              .toDecimalPlaces(2);

            const saldoApos = saldoAtual.minus(quantidade);

            return {
              produto,
              saldo,
              quantidade,
              saldoAtual,
              saldoApos,
              precoUnitario,
              subtotal,
            };
          });

          // O total é a soma dos subtotais calculados pelo backend.
          const total = itensCalculados.reduce(
            (acumulado, item) => acumulado.plus(item.subtotal),
            new Prisma.Decimal(0),
          ).toDecimalPlaces(2);

          // Registra a venda e todos os seus itens.
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

          // Atualiza cada saldo e registra a respectiva saída.
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

          // Retorna valores numéricos adequados para a API.
          return {
            id: venda.id,
            empresaId: venda.empresaId,
            formaPagamento: venda.formaPagamento,
            total: Number(venda.total),
            criadoEm: venda.criadoEm,
            usuario: venda.usuario,
            itens: venda.itens.map((item) => ({
              id: item.id,
              produto: item.produto,
              quantidade: Number(item.quantidade),
              precoUnitario: Number(item.precoUnitario),
              subtotal: Number(item.subtotal),
            })),
          };
        },
        {
          isolationLevel:
            Prisma.TransactionIsolationLevel.Serializable,
        },
      );
    } catch (erro) {
      // Conflitos de concorrência precisam ser tratados como nova tentativa.
      if (
        erro instanceof Prisma.PrismaClientKnownRequestError &&
        erro.code === 'P2034'
      ) {
        throw new ConflictException(
          'O estoque foi alterado simultaneamente. ' +
            'Consulte o saldo atualizado e tente novamente.',
        );
      }

      throw erro;
    }
  }

    /**
   * Lista vendas da empresa autenticada.
   *
   * Retorna os dados resumidos, o operador responsável e a
   * quantidade de itens. Os valores decimais são convertidos
   * para números na resposta da API.
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
      })),
      total,
      pagina,
      limite,
      totalPaginas: Math.ceil(total / limite),
    };
  }

  /**
   * Consulta os detalhes de uma venda.
   *
   * O ID e a empresa autenticada são usados em conjunto.
   * Uma venda de outra empresa não será retornada.
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

    return {
      id: venda.id,
      formaPagamento: venda.formaPagamento,
      total: Number(venda.total),
      criadoEm: venda.criadoEm,
      usuario: venda.usuario,
      itens: venda.itens.map((item) => ({
        id: item.id,
        produto: item.produto,
        quantidade: Number(item.quantidade),
        precoUnitario: Number(item.precoUnitario),
        subtotal: Number(item.subtotal),
      })),
    };
  }
}
