
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';

import { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PrismaService } from '../prisma/prisma.service.js';
import { CriarVendaDto } from './dto/criar-venda.dto.js';
import { VendasService } from './vendas.service.js';

/**
 * Testes unitários do VendasService.
 *
 * Verifica:
 * - Cálculo do total usando o preço cadastrado.
 * - Baixa do estoque e criação do histórico.
 * - Bloqueio de venda com saldo insuficiente.
 * - Bloqueio de produtos inexistentes ou de outra empresa.
 * - Validação do usuário responsável.
 * - Rejeição de produtos repetidos.
 *
 * O Prisma é simulado; estes testes não acessam o banco real.
 */
describe('VendasService', () => {
  let service: VendasService;

  const prisma = {
    $transaction: vi.fn(),
  };

  const transacao = {
    usuario: {
      findFirst: vi.fn(),
    },
    produto: {
      findMany: vi.fn(),
    },
    saldoEstoque: {
      findMany: vi.fn(),
      update: vi.fn(),
    },
    venda: {
      create: vi.fn(),
    },
    movimentacaoEstoque: {
      create: vi.fn(),
    },
  };

  const produtoExemplo = {
    id: 'produto-1',
    nome: 'Arroz tipo 1',
    sku: 'ALM-001',
    preco: new Prisma.Decimal('25.00'),
  };

  const saldoExemplo = {
    id: 'saldo-1',
    empresaId: 'empresa-1',
    produtoId: 'produto-1',
    quantidadeDisponivel: new Prisma.Decimal('10'),
    quantidadeReservada: new Prisma.Decimal('0'),
    estoqueMinimo: new Prisma.Decimal('2'),
    atualizadoEm: new Date(),
  };

  const vendaPersistida = {
    id: 'venda-1',
    empresaId: 'empresa-1',
    usuarioId: 'usuario-1',
    formaPagamento: 'PIX',
    total: new Prisma.Decimal('50.00'),
    criadoEm: new Date('2026-10-27T12:00:00.000Z'),
    usuario: {
      id: 'usuario-1',
      nome: 'Operador de caixa',
    },
    itens: [
      {
        id: 'item-venda-1',
        produtoId: 'produto-1',
        quantidade: new Prisma.Decimal('2'),
        precoUnitario: new Prisma.Decimal('25.00'),
        subtotal: new Prisma.Decimal('50.00'),
        produto: {
          id: 'produto-1',
          nome: 'Arroz tipo 1',
          sku: 'ALM-001',
        },
      },
    ],
  };

  beforeEach(() => {
    vi.resetAllMocks();

    // Simula uma transação interativa do Prisma.
    prisma.$transaction.mockImplementation(
      async (operacao: unknown) => {
        if (typeof operacao !== 'function') {
          throw new Error(
            'Este teste esperava uma transação interativa.',
          );
        }

        return (
          operacao as (tx: typeof transacao) => unknown
        )(transacao);
      },
    );

    service = new VendasService(
      prisma as unknown as PrismaService,
    );
  });

  /**
   * Configura os mocks para uma venda válida de duas unidades,
   * a R$ 25,00 cada, com saldo inicial de dez unidades.
   */
  function prepararCenarioValido(
    quantidadeDisponivel = '10',
  ) {
    transacao.usuario.findFirst.mockResolvedValue({
      id: 'usuario-1',
      nome: 'Operador de caixa',
    });

    transacao.produto.findMany.mockResolvedValue([
      produtoExemplo,
    ]);

    transacao.saldoEstoque.findMany.mockResolvedValue([
      {
        ...saldoExemplo,
        quantidadeDisponivel: new Prisma.Decimal(
          quantidadeDisponivel,
        ),
      },
    ]);

    transacao.venda.create.mockResolvedValue(
      vendaPersistida,
    );

    transacao.saldoEstoque.update.mockResolvedValue({
      ...saldoExemplo,
      quantidadeDisponivel: new Prisma.Decimal('8'),
    });

    transacao.movimentacaoEstoque.create.mockResolvedValue({
      id: 'movimentacao-1',
      tipo: 'SAIDA',
    });
  }

  it('deve calcular o total e baixar o estoque em uma venda válida', async () => {
    prepararCenarioValido();

    const dto: CriarVendaDto = {
      formaPagamento: 'PIX',
      itens: [
        {
          produtoId: 'produto-1',
          quantidade: 2,
        },
      ],
    };

    const resultado = await service.criar(
      'empresa-1',
      'usuario-1',
      dto,
    );

    expect(resultado.id).toBe('venda-1');
    expect(resultado.formaPagamento).toBe('PIX');
    expect(resultado.total).toBe(50);

    expect(resultado.itens).toHaveLength(1);
    expect(resultado.itens[0].quantidade).toBe(2);
    expect(resultado.itens[0].precoUnitario).toBe(25);
    expect(resultado.itens[0].subtotal).toBe(50);

    // Confirma que o total foi calculado no backend.
    const chamadaVenda = transacao.venda.create.mock
      .calls[0][0] as {
        data: {
          total: Prisma.Decimal;
        };
      };

    expect(chamadaVenda.data.total.toString()).toBe('50');

    // Duas unidades vendidas deixam oito unidades disponíveis.
    const chamadaSaldo = transacao.saldoEstoque.update.mock
      .calls[0][0] as {
        where: { id: string };
        data: {
          quantidadeDisponivel: Prisma.Decimal;
        };
      };

    expect(chamadaSaldo.where.id).toBe('saldo-1');
    expect(
      chamadaSaldo.data.quantidadeDisponivel.toString(),
    ).toBe('8');

    // Confirma o registro da saída para o histórico de estoque.
    expect(
      transacao.movimentacaoEstoque.create,
    ).toHaveBeenCalledTimes(1);

    const chamadaMovimentacao =
      transacao.movimentacaoEstoque.create.mock
        .calls[0][0] as {
          data: {
            empresaId: string;
            produtoId: string;
            usuarioId: string;
            tipo: string;
            quantidade: Prisma.Decimal;
            saldoApos: Prisma.Decimal;
            referenciaId: string;
          };
        };

    expect(chamadaMovimentacao.data).toMatchObject({
      empresaId: 'empresa-1',
      produtoId: 'produto-1',
      usuarioId: 'usuario-1',
      tipo: 'SAIDA',
      referenciaId: 'venda-1',
    });

    expect(
      chamadaMovimentacao.data.quantidade.toString(),
    ).toBe('2');

    expect(
      chamadaMovimentacao.data.saldoApos.toString(),
    ).toBe('8');
  });

  it('deve rejeitar uma venda quando o estoque for insuficiente', async () => {
    prepararCenarioValido('10');

    const dto: CriarVendaDto = {
      formaPagamento: 'DINHEIRO',
      itens: [
        {
          produtoId: 'produto-1',
          quantidade: 11,
        },
      ],
    };

    await expect(
      service.criar('empresa-1', 'usuario-1', dto),
    ).rejects.toBeInstanceOf(BadRequestException);

    // Não deve registrar venda, alterar saldo ou criar movimentação.
    expect(transacao.venda.create).not.toHaveBeenCalled();
    expect(transacao.saldoEstoque.update).not.toHaveBeenCalled();

    expect(
      transacao.movimentacaoEstoque.create,
    ).not.toHaveBeenCalled();
  });

  it('deve rejeitar produtos que não pertencem à empresa ou estão inativos', async () => {
    transacao.usuario.findFirst.mockResolvedValue({
      id: 'usuario-1',
      nome: 'Operador de caixa',
    });

    // A consulta real retorna apenas produtos ativos da empresa.
    transacao.produto.findMany.mockResolvedValue([]);

    const dto: CriarVendaDto = {
      formaPagamento: 'PIX',
      itens: [
        {
          produtoId: 'produto-de-outra-empresa',
          quantidade: 1,
        },
      ],
    };

    await expect(
      service.criar('empresa-1', 'usuario-1', dto),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(transacao.venda.create).not.toHaveBeenCalled();

    expect(transacao.saldoEstoque.update).not.toHaveBeenCalled();
  });

  it('deve rejeitar a venda quando o usuário estiver inativo ou não pertencer à empresa', async () => {
    transacao.usuario.findFirst.mockResolvedValue(null);

    const dto: CriarVendaDto = {
      formaPagamento: 'PIX',
      itens: [
        {
          produtoId: 'produto-1',
          quantidade: 1,
        },
      ],
    };

    await expect(
      service.criar('empresa-1', 'usuario-1', dto),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(transacao.produto.findMany).not.toHaveBeenCalled();
    expect(transacao.venda.create).not.toHaveBeenCalled();
  });

  it('deve rejeitar produtos repetidos na mesma venda', async () => {
    const dto: CriarVendaDto = {
      formaPagamento: 'PIX',
      itens: [
        {
          produtoId: 'produto-1',
          quantidade: 1,
        },
        {
          produtoId: 'produto-1',
          quantidade: 2,
        },
      ],
    };

    await expect(
      service.criar('empresa-1', 'usuario-1', dto),
    ).rejects.toBeInstanceOf(BadRequestException);

    // A validação ocorre antes de iniciar a transação.
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('deve rejeitar produtos sem saldo cadastrado', async () => {
    transacao.usuario.findFirst.mockResolvedValue({
      id: 'usuario-1',
      nome: 'Operador de caixa',
    });

    transacao.produto.findMany.mockResolvedValue([
      produtoExemplo,
    ]);

    transacao.saldoEstoque.findMany.mockResolvedValue([]);

    const dto: CriarVendaDto = {
      formaPagamento: 'PIX',
      itens: [
        {
          produtoId: 'produto-1',
          quantidade: 1,
        },
      ],
    };

    await expect(
      service.criar('empresa-1', 'usuario-1', dto),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(transacao.venda.create).not.toHaveBeenCalled();
    expect(transacao.saldoEstoque.update).not.toHaveBeenCalled();
  });
});
