
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';

import { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PrismaService } from '../prisma/prisma.service.js';
import { ProdutosService } from './produtos.service.js';
import { CriarProdutoDto } from './dto/criar-produto.dto.js';
import { AtualizarProdutoDto } from './dto/atualizar-produto.dto.js';
import { ListarProdutosDto } from './dto/listar-produtos.dto.js';
import { CriarMovimentacaoEstoqueDto } from './dto/criar-movimentacao-estoque.dto.js';
import { ListarMovimentacoesEstoqueDto } from './dto/listar-movimentacoes-estoque.dto.js';

/**
 * Testes unitários do ProdutosService.
 *
 * Verifica:
 * - Cadastro e normalização dos produtos.
 * - Criação do saldo e movimentação inicial.
 * - Validação de categoria e unidade.
 * - Entradas, saídas e ajustes de estoque.
 * - Bloqueio de saldo negativo.
 * - Isolamento das operações por empresa.
 * - Histórico de movimentações com paginação.
 * - Listagem, consulta, atualização e ativação de produtos.
 * - Tratamento de erros do Prisma.
 *
 * O Prisma é simulado para que os testes não acessem o PostgreSQL.
 */
describe('ProdutosService', () => {
  let service: ProdutosService;

  /**
   * Simula os modelos e métodos acessados diretamente pelo serviço.
   */
  const prisma = {
    produto: {
      create: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    saldoEstoque: {
      create: vi.fn(),
    },
    movimentacaoEstoque: {
      create: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
    },
    categoria: {
      findFirst: vi.fn(),
    },
    unidade: {
      findFirst: vi.fn(),
    },
    $transaction: vi.fn(),
  };

  /**
   * Simula o cliente transacional disponibilizado pelo Prisma.
   *
   * Permite testar as gravações sem depender do banco de dados.
   */
  const transacao = {
    produto: {
      create: vi.fn(),
      findFirst: vi.fn(),
    },
    saldoEstoque: {
      create: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    movimentacaoEstoque: {
      create: vi.fn(),
    },
  };

  const produtoExemplo = {
    id: 'produto-1',
    empresaId: 'empresa-1',
    nome: 'Arroz tipo 1',
    sku: 'ALM-001',
    descricao: null,
    categoriaId: null,
    unidadeId: null,
    codigoBarras: null,
    preco: 25,
    custo: 18,
    perecivel: false,
    peso: null,
    ativo: true,
    criadoEm: new Date(),
    atualizadoEm: new Date(),
  };

  const saldoEstoqueExemplo = {
    id: 'saldo-1',
    empresaId: 'empresa-1',
    produtoId: 'produto-1',
    quantidadeDisponivel: 0,
    quantidadeReservada: 0,
    estoqueMinimo: 0,
    atualizadoEm: new Date(),
  };

  beforeEach(() => {
    /**
     * Limpa chamadas e implementações dos mocks para evitar
     * que resultados de um teste interfiram nos testes seguintes.
     */
    vi.resetAllMocks();

    /**
     * Simula as duas formas de transação utilizadas pelo serviço:
     *
     * 1. Transação interativa: recebe uma função e o cliente transacional.
     * 2. Transação em lote: recebe uma lista de operações.
     */
    prisma.$transaction.mockImplementation(
      async (operacao: unknown) => {
        if (typeof operacao === 'function') {
          return (
            operacao as (tx: typeof transacao) => unknown
          )(transacao);
        }

        return Promise.all(
          operacao as Promise<unknown>[],
        );
      },
    );

    // Injeta o Prisma simulado no serviço sob teste.
    service = new ProdutosService(
      prisma as unknown as PrismaService,
    );
  });

  // ============================================================
  // CADASTRO DE PRODUTOS
  // ============================================================

  it('deve cadastrar produto vinculado à empresa autenticada', async () => {
    transacao.produto.create.mockResolvedValue(produtoExemplo);
    transacao.saldoEstoque.create.mockResolvedValue(
      saldoEstoqueExemplo,
    );

    const dto: CriarProdutoDto = {
      nome: '  Arroz tipo 1  ',
      sku: ' alm-001 ',
      preco: 25,
      custo: 18,
    };

    await expect(
      service.criar('empresa-1', 'usuario-1', dto),
    ).resolves.toEqual({
      ...produtoExemplo,
      saldoEstoque: saldoEstoqueExemplo,
    });

    // Confirma a normalização e o vínculo à empresa autenticada.
    expect(transacao.produto.create).toHaveBeenCalledWith({
      data: {
        empresaId: 'empresa-1',
        nome: 'Arroz tipo 1',
        sku: 'ALM-001',
        descricao: null,
        categoriaId: null,
        unidadeId: null,
        codigoBarras: null,
        preco: 25,
        custo: 18,
        perecivel: false,
        peso: null,
      },
    });

    // Confirma que o saldo inicial e o estoque mínimo são gravados.
    expect(transacao.saldoEstoque.create).toHaveBeenCalledWith({
      data: {
        empresaId: 'empresa-1',
        produtoId: 'produto-1',
        quantidadeDisponivel: 0,
        quantidadeReservada: 0,
        estoqueMinimo: 0,
      },
    });

    // Não cria movimentação quando a quantidade inicial é zero.
    expect(
      transacao.movimentacaoEstoque.create,
    ).not.toHaveBeenCalled();
  });

  it('deve rejeitar categoria que não pertence à empresa', async () => {
    prisma.categoria.findFirst.mockResolvedValue(null);

    const dto: CriarProdutoDto = {
      nome: 'Arroz tipo 1',
      sku: 'ALM-001',
      categoriaId: 'categoria-outra-empresa',
      preco: 25,
      custo: 18,
    };

    await expect(
      service.criar('empresa-1', 'usuario-1', dto),
    ).rejects.toBeInstanceOf(BadRequestException);

    // A validação deve impedir as gravações.
    expect(transacao.produto.create).not.toHaveBeenCalled();
    expect(transacao.saldoEstoque.create).not.toHaveBeenCalled();

    expect(prisma.categoria.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'categoria-outra-empresa',
        empresaId: 'empresa-1',
      },
      select: { id: true },
    });
  });

  it('deve rejeitar unidade que não pertence à empresa', async () => {
    prisma.unidade.findFirst.mockResolvedValue(null);

    const dto: CriarProdutoDto = {
      nome: 'Arroz tipo 1',
      sku: 'ALM-001',
      unidadeId: 'unidade-outra-empresa',
      preco: 25,
      custo: 18,
    };

    await expect(
      service.criar('empresa-1', 'usuario-1', dto),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(transacao.produto.create).not.toHaveBeenCalled();
    expect(transacao.saldoEstoque.create).not.toHaveBeenCalled();

    expect(prisma.unidade.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'unidade-outra-empresa',
        empresaId: 'empresa-1',
      },
      select: { id: true },
    });
  });

  it('deve converter SKU duplicado em erro de conflito', async () => {
    const erroDuplicidade =
      new Prisma.PrismaClientKnownRequestError(
        'Unique constraint failed',
        {
          code: 'P2002',
          clientVersion: 'test',
        },
      );

    transacao.produto.create.mockRejectedValue(
      erroDuplicidade,
    );

    await expect(
      service.criar('empresa-1', 'usuario-1', {
        nome: 'Outro arroz',
        sku: 'ALM-001',
        preco: 25,
        custo: 18,
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    // Sem produto criado, não deve haver criação de saldo.
    expect(transacao.saldoEstoque.create).not.toHaveBeenCalled();
  });

  // ============================================================
  // MOVIMENTAÇÕES DE ESTOQUE
  // ============================================================

  it('deve registrar uma entrada e aumentar o saldo disponível', async () => {
    transacao.produto.findFirst.mockResolvedValue({
      id: 'produto-1',
    });

    transacao.saldoEstoque.findFirst.mockResolvedValue({
      ...saldoEstoqueExemplo,
      quantidadeDisponivel: '10.000',
    });

    transacao.saldoEstoque.update.mockResolvedValue({
      ...saldoEstoqueExemplo,
      quantidadeDisponivel: new Prisma.Decimal('13'),
    });

    transacao.movimentacaoEstoque.create.mockResolvedValue({
      id: 'movimentacao-1',
      empresaId: 'empresa-1',
      produtoId: 'produto-1',
      tipo: 'ENTRADA',
      quantidade: new Prisma.Decimal('3'),
      saldoApos: new Prisma.Decimal('13'),
      motivo: 'Compra de mercadorias',
      referenciaId: null,
      usuarioId: 'usuario-1',
      criadoEm: new Date(),
    });

    const dto: CriarMovimentacaoEstoqueDto = {
      tipo: 'ENTRADA',
      quantidade: 3,
      motivo: 'Compra de mercadorias',
    };

    const resultado = await service.movimentarEstoque(
      'empresa-1',
      'usuario-1',
      'produto-1',
      dto,
    );

    expect(resultado.tipo).toBe('ENTRADA');
    expect(
      resultado.saldoEstoque.quantidadeDisponivel.toString(),
    ).toBe('13');

    // Confirma que o saldo foi atualizado de 10 para 13.
    expect(transacao.saldoEstoque.update).toHaveBeenCalledWith({
      where: { id: 'saldo-1' },
      data: {
        quantidadeDisponivel: new Prisma.Decimal('13'),
      },
    });

    // A movimentação precisa registrar o tipo, o motivo e o usuário.
    expect(
      transacao.movimentacaoEstoque.create,
    ).toHaveBeenCalledWith({
      data: expect.objectContaining({
        empresaId: 'empresa-1',
        produtoId: 'produto-1',
        tipo: 'ENTRADA',
        quantidade: new Prisma.Decimal('3'),
        saldoApos: new Prisma.Decimal('13'),
        motivo: 'Compra de mercadorias',
        usuarioId: 'usuario-1',
      }),
    });
  });

  it('deve registrar uma saída e reduzir o saldo disponível', async () => {
    transacao.produto.findFirst.mockResolvedValue({
      id: 'produto-1',
    });

    transacao.saldoEstoque.findFirst.mockResolvedValue({
      ...saldoEstoqueExemplo,
      quantidadeDisponivel: '10.000',
    });

    transacao.saldoEstoque.update.mockResolvedValue({
      ...saldoEstoqueExemplo,
      quantidadeDisponivel: new Prisma.Decimal('7'),
    });

    transacao.movimentacaoEstoque.create.mockResolvedValue({
      id: 'movimentacao-2',
      empresaId: 'empresa-1',
      produtoId: 'produto-1',
      tipo: 'SAIDA',
      quantidade: new Prisma.Decimal('3'),
      saldoApos: new Prisma.Decimal('7'),
      motivo: 'Consumo interno',
      referenciaId: null,
      usuarioId: 'usuario-1',
      criadoEm: new Date(),
    });

    const dto: CriarMovimentacaoEstoqueDto = {
      tipo: 'SAIDA',
      quantidade: 3,
      motivo: 'Consumo interno',
    };

    const resultado = await service.movimentarEstoque(
      'empresa-1',
      'usuario-1',
      'produto-1',
      dto,
    );

    expect(resultado.tipo).toBe('SAIDA');

    // Confirma que o saldo foi atualizado de 10 para 7.
    expect(transacao.saldoEstoque.update).toHaveBeenCalledWith({
      where: { id: 'saldo-1' },
      data: {
        quantidadeDisponivel: new Prisma.Decimal('7'),
      },
    });

    // O histórico registra a quantidade positiva solicitada para a saída.
    expect(
      transacao.movimentacaoEstoque.create,
    ).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tipo: 'SAIDA',
        quantidade: new Prisma.Decimal('3'),
        saldoApos: new Prisma.Decimal('7'),
      }),
    });
  });

  it('deve aplicar um ajuste positivo ao saldo disponível', async () => {
    transacao.produto.findFirst.mockResolvedValue({
      id: 'produto-1',
    });

    transacao.saldoEstoque.findFirst.mockResolvedValue({
      ...saldoEstoqueExemplo,
      quantidadeDisponivel: '10.000',
    });

    transacao.saldoEstoque.update.mockResolvedValue({
      ...saldoEstoqueExemplo,
      quantidadeDisponivel: new Prisma.Decimal('12'),
    });

    transacao.movimentacaoEstoque.create.mockResolvedValue({
      id: 'movimentacao-3',
      empresaId: 'empresa-1',
      produtoId: 'produto-1',
      tipo: 'AJUSTE',
      quantidade: new Prisma.Decimal('2'),
      saldoApos: new Prisma.Decimal('12'),
      motivo: 'Correção positiva do inventário',
      referenciaId: null,
      usuarioId: 'usuario-1',
      criadoEm: new Date(),
    });

    const dto: CriarMovimentacaoEstoqueDto = {
      tipo: 'AJUSTE',
      quantidade: 2,
      motivo: 'Correção positiva do inventário',
    };

    const resultado = await service.movimentarEstoque(
      'empresa-1',
      'usuario-1',
      'produto-1',
      dto,
    );

    expect(
      resultado.saldoEstoque.quantidadeDisponivel.toString(),
    ).toBe('12');

    // Confirma que o ajuste adicionou duas unidades.
    expect(transacao.saldoEstoque.update).toHaveBeenCalledWith({
      where: { id: 'saldo-1' },
      data: {
        quantidadeDisponivel: new Prisma.Decimal('12'),
      },
    });

    expect(
      transacao.movimentacaoEstoque.create,
    ).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tipo: 'AJUSTE',
        quantidade: new Prisma.Decimal('2'),
        motivo: 'Correção positiva do inventário',
      }),
    });
  });

  it('deve aplicar um ajuste negativo ao saldo disponível', async () => {
    transacao.produto.findFirst.mockResolvedValue({
      id: 'produto-1',
    });

    transacao.saldoEstoque.findFirst.mockResolvedValue({
      ...saldoEstoqueExemplo,
      quantidadeDisponivel: '10.000',
    });

    transacao.saldoEstoque.update.mockResolvedValue({
      ...saldoEstoqueExemplo,
      quantidadeDisponivel: new Prisma.Decimal('8'),
    });

    transacao.movimentacaoEstoque.create.mockResolvedValue({
      id: 'movimentacao-4',
      empresaId: 'empresa-1',
      produtoId: 'produto-1',
      tipo: 'AJUSTE',
      quantidade: new Prisma.Decimal('-2'),
      saldoApos: new Prisma.Decimal('8'),
      motivo: 'Correção negativa do inventário',
      referenciaId: null,
      usuarioId: 'usuario-1',
      criadoEm: new Date(),
    });

    const dto: CriarMovimentacaoEstoqueDto = {
      tipo: 'AJUSTE',
      quantidade: -2,
      motivo: 'Correção negativa do inventário',
    };

    const resultado = await service.movimentarEstoque(
      'empresa-1',
      'usuario-1',
      'produto-1',
      dto,
    );

    expect(
      resultado.saldoEstoque.quantidadeDisponivel.toString(),
    ).toBe('8');

    // Confirma que o sinal negativo é preservado no histórico.
    expect(
      transacao.movimentacaoEstoque.create,
    ).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tipo: 'AJUSTE',
        quantidade: new Prisma.Decimal('-2'),
        saldoApos: new Prisma.Decimal('8'),
        motivo: 'Correção negativa do inventário',
      }),
    });
  });

  it('deve impedir saída superior ao saldo disponível', async () => {
    transacao.produto.findFirst.mockResolvedValue({
      id: 'produto-1',
    });

    transacao.saldoEstoque.findFirst.mockResolvedValue({
      ...saldoEstoqueExemplo,
      quantidadeDisponivel: '2.000',
    });

    const dto: CriarMovimentacaoEstoqueDto = {
      tipo: 'SAIDA',
      quantidade: 3,
      motivo: 'Saída de teste',
    };

    await expect(
      service.movimentarEstoque(
        'empresa-1',
        'usuario-1',
        'produto-1',
        dto,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    // Uma saída inválida não pode gravar novo saldo nem histórico.
    expect(transacao.saldoEstoque.update).not.toHaveBeenCalled();

    expect(
      transacao.movimentacaoEstoque.create,
    ).not.toHaveBeenCalled();
  });

  it('deve impedir movimentação de produto de outra empresa', async () => {
    // Simula um produto que não pertence à empresa autenticada.
    transacao.produto.findFirst.mockResolvedValue(null);

    const dto: CriarMovimentacaoEstoqueDto = {
      tipo: 'ENTRADA',
      quantidade: 5,
      motivo: 'Tentativa não autorizada',
    };

    await expect(
      service.movimentarEstoque(
        'empresa-1',
        'usuario-1',
        'produto-empresa-2',
        dto,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);

    // A validação deve ocorrer antes de consultar ou alterar o saldo.
    expect(transacao.saldoEstoque.findFirst).not.toHaveBeenCalled();
    expect(transacao.saldoEstoque.update).not.toHaveBeenCalled();

    // Nenhuma movimentação deve ser registrada.
    expect(
      transacao.movimentacaoEstoque.create,
    ).not.toHaveBeenCalled();
  });

  // ============================================================
  // HISTÓRICO DE MOVIMENTAÇÕES
  // ============================================================

  it('deve listar o histórico de movimentações com paginação', async () => {
    const movimentacoes = [
      {
        id: 'movimentacao-1',
        empresaId: 'empresa-1',
        produtoId: 'produto-1',
        tipo: 'ENTRADA',
        quantidade: new Prisma.Decimal('5'),
        saldoApos: new Prisma.Decimal('5'),
        motivo: 'Recebimento',
        referenciaId: null,
        usuarioId: 'usuario-1',
        criadoEm: new Date(),
      },
    ];

    // O produto precisa pertencer à empresa que consulta o histórico.
    prisma.produto.findFirst.mockResolvedValue(produtoExemplo);

    // Simula a resposta combinada da consulta e da contagem.
    prisma.$transaction.mockResolvedValue([
      movimentacoes,
      1,
    ]);

    const filtros: ListarMovimentacoesEstoqueDto = {
      pagina: 1,
      limite: 20,
    };

    const resultado = await service.listarMovimentacoes(
      'empresa-1',
      'produto-1',
      filtros,
    );

    expect(resultado).toEqual({
      dados: movimentacoes,
      total: 1,
      pagina: 1,
      limite: 20,
      totalPaginas: 1,
    });

    // Confirma o filtro por empresa e produto e a ordem cronológica.
    expect(
      prisma.movimentacaoEstoque.findMany,
    ).toHaveBeenCalledWith({
      where: {
        empresaId: 'empresa-1',
        produtoId: 'produto-1',
      },
      orderBy: {
        criadoEm: 'desc',
      },
      skip: 0,
      take: 20,
    });

    expect(
      prisma.movimentacaoEstoque.count,
    ).toHaveBeenCalledWith({
      where: {
        empresaId: 'empresa-1',
        produtoId: 'produto-1',
      },
    });
  });

  // ============================================================
  // LISTAGEM, PESQUISA E PAGINAÇÃO DE PRODUTOS
  // ============================================================

  it('deve listar produtos com filtro, pesquisa e paginação por empresa', async () => {
    const produtos = [produtoExemplo];

    prisma.$transaction.mockResolvedValue([produtos, 21]);

    const filtros: ListarProdutosDto = {
      pagina: 2,
      limite: 10,
      ativo: true,
      busca: 'arroz',
    };

    const resultado = await service.listar(
      'empresa-1',
      filtros,
    );

    // A consulta aplica empresa, situação e pesquisa.
    const whereEsperado = {
      empresaId: 'empresa-1',
      ativo: true,
      OR: [
        {
          nome: {
            contains: 'arroz',
            mode: 'insensitive',
          },
        },
        {
          sku: {
            contains: 'arroz',
            mode: 'insensitive',
          },
        },
        {
          codigoBarras: {
            contains: 'arroz',
            mode: 'insensitive',
          },
        },
      ],
    };

    expect(prisma.produto.findMany).toHaveBeenCalledWith({
      where: whereEsperado,
      include: {
        saldoEstoque: true,
      },
      orderBy: { nome: 'asc' },
      skip: 10,
      take: 10,
    });

    expect(prisma.produto.count).toHaveBeenCalledWith({
      where: whereEsperado,
    });

    expect(resultado).toEqual({
      dados: produtos,
      total: 21,
      pagina: 2,
      limite: 10,
      totalPaginas: 3,
    });
  });

  it('deve listar produtos sem retornar dados de outras empresas', async () => {
    prisma.$transaction.mockResolvedValue([[], 0]);

    await service.listar('empresa-2', {
      pagina: 1,
      limite: 20,
    });

    // A empresa permanece obrigatória mesmo sem outros filtros.
    expect(prisma.produto.findMany).toHaveBeenCalledWith({
      where: { empresaId: 'empresa-2' },
      include: {
        saldoEstoque: true,
      },
      orderBy: { nome: 'asc' },
      skip: 0,
      take: 20,
    });

    expect(prisma.produto.count).toHaveBeenCalledWith({
      where: { empresaId: 'empresa-2' },
    });
  });

  // ============================================================
  // CONSULTA POR IDENTIFICADOR
  // ============================================================

  it('deve consultar produto dentro da empresa autenticada', async () => {
    prisma.produto.findFirst.mockResolvedValue(produtoExemplo);

    await expect(
      service.buscarPorId('empresa-1', 'produto-1'),
    ).resolves.toEqual(produtoExemplo);

    // O produto e o saldo são consultados juntos.
    expect(prisma.produto.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'produto-1',
        empresaId: 'empresa-1',
      },
      include: {
        saldoEstoque: true,
      },
    });
  });

  it('deve rejeitar consulta de produto que não pertence à empresa', async () => {
    prisma.produto.findFirst.mockResolvedValue(null);

    await expect(
      service.buscarPorId(
        'empresa-1',
        'produto-empresa-2',
      ),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(prisma.produto.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'produto-empresa-2',
        empresaId: 'empresa-1',
      },
      include: {
        saldoEstoque: true,
      },
    });
  });

  // ============================================================
  // ATUALIZAÇÃO DE PRODUTOS
  // ============================================================

  it('deve atualizar somente os campos enviados', async () => {
    prisma.produto.findFirst.mockResolvedValue(produtoExemplo);

    prisma.produto.update.mockResolvedValue({
      ...produtoExemplo,
      nome: 'Arroz premium',
    });

    const dto: AtualizarProdutoDto = {
      nome: '  Arroz premium  ',
    };

    await expect(
      service.atualizar('empresa-1', 'produto-1', dto),
    ).resolves.toMatchObject({
      nome: 'Arroz premium',
    });

    // Antes da atualização, confirma o vínculo empresarial.
    expect(prisma.produto.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'produto-1',
        empresaId: 'empresa-1',
      },
      include: {
        saldoEstoque: true,
      },
    });

    // A escrita usa a chave composta da empresa e do produto.
    expect(prisma.produto.update).toHaveBeenCalledWith({
      where: {
        empresaId_id: {
          empresaId: 'empresa-1',
          id: 'produto-1',
        },
      },
      data: {
        nome: 'Arroz premium',
      },
    });
  });

  it('deve impedir atualização de produto de outra empresa', async () => {
    prisma.produto.findFirst.mockResolvedValue(null);

    await expect(
      service.atualizar(
        'empresa-1',
        'produto-empresa-2',
        {
          nome: 'Tentativa de alteração',
        },
      ),
    ).rejects.toBeInstanceOf(NotFoundException);

    // O produto não encontrado não pode ser atualizado.
    expect(prisma.produto.update).not.toHaveBeenCalled();
  });

  it('deve rejeitar atualização sem campos informados', async () => {
    await expect(
      service.atualizar(
        'empresa-1',
        'produto-1',
        {} as AtualizarProdutoDto,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    // A validação ocorre antes de qualquer consulta ou escrita.
    expect(prisma.produto.findFirst).not.toHaveBeenCalled();
    expect(prisma.produto.update).not.toHaveBeenCalled();
  });

  // ============================================================
  // ATIVAÇÃO E DESATIVAÇÃO
  // ============================================================

  it('deve desativar produto utilizando a chave composta da empresa', async () => {
    prisma.produto.update.mockResolvedValue({
      ...produtoExemplo,
      ativo: false,
    });

    await expect(
      service.alterarAtivacao(
        'empresa-1',
        'produto-1',
        false,
      ),
    ).resolves.toMatchObject({
      ativo: false,
    });

    expect(prisma.produto.update).toHaveBeenCalledWith({
      where: {
        empresaId_id: {
          empresaId: 'empresa-1',
          id: 'produto-1',
        },
      },
      data: {
        ativo: false,
      },
    });
  });

  it('deve retornar produto não encontrado ao alterar produto inexistente', async () => {
    const erroInexistente =
      new Prisma.PrismaClientKnownRequestError(
        'Record to update not found',
        {
          code: 'P2025',
          clientVersion: 'test',
        },
      );

    prisma.produto.update.mockRejectedValue(
      erroInexistente,
    );

    await expect(
      service.alterarAtivacao(
        'empresa-1',
        'produto-inexistente',
        false,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
