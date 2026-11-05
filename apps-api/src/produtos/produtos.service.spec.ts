import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';

import { Prisma, PrismaClient } from '@prisma/client';

import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import { PrismaService } from '../prisma/prisma.service.js';
import { AuditoriaService } from '../auditoria/auditoria.service.js';
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

      /*
       * Disponibiliza as referências reais dos campos do Prisma.
       * Permite testar comparações entre saldo e estoque mínimo
       * sem executar consultas ao banco de dados.
       */
      fields: new PrismaClient().saldoEstoque.fields,
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
  // Simula o serviço central de auditoria.
  const auditoria = {
    registrar: vi.fn(),
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
     update: vi.fn(),
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

    // Simula um registro de auditoria realizado com sucesso.
    auditoria.registrar.mockResolvedValue({
      id: 'evento-auditoria-1',
    });

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
      auditoria as unknown as AuditoriaService,
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
      'usuario-1',
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
      'usuario-1',
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

    await service.listar('empresa-2', 'usuario-1', {
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
  // FILTRO POR CATEGORIA E ISOLAMENTO ENTRE EMPRESAS
  // ============================================================

  it('deve listar somente produtos da categoria validada', async () => {
    /*
     * A categoria precisa existir na empresa autenticada.
     * A consulta de produtos deve manter os dois identificadores
     * no filtro, impedindo acesso aos dados de outra empresa.
     */
    prisma.categoria.findFirst.mockResolvedValue({
      id: 'categoria-1',
    });

    prisma.$transaction.mockResolvedValue([
      [produtoExemplo],
      1,
    ]);

    const resultado = await service.listar(
      'empresa-1',
      'usuario-1',
      {
        pagina: 1,
        limite: 20,
        categoriaId: 'categoria-1',
      },
    );

    expect(prisma.categoria.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'categoria-1',
        empresaId: 'empresa-1',
      },
      select: {
        id: true,
      },
    });

    const whereEsperado = {
      empresaId: 'empresa-1',
      categoriaId: 'categoria-1',
    };

    expect(prisma.produto.findMany).toHaveBeenCalledWith({
      where: whereEsperado,
      orderBy: {
        nome: 'asc',
      },
      skip: 0,
      take: 20,
      include: {
        saldoEstoque: true,
      },
    });

    expect(prisma.produto.count).toHaveBeenCalledWith({
      where: whereEsperado,
    });

    expect(resultado).toEqual({
      dados: [produtoExemplo],
      total: 1,
      pagina: 1,
      limite: 20,
      totalPaginas: 1,
    });

    // A auditoria registra a presença do filtro.
    expect(auditoria.registrar).toHaveBeenCalledWith(
      expect.objectContaining({
        empresaId: 'empresa-1',
        acao: 'CONSULTAR_LISTA',
        metadados: expect.objectContaining({
          categoriaInformada: true,
        }),
      }),
    );
  });

  it('deve rejeitar categoria que não pertence à empresa na listagem', async () => {
    /*
     * O mesmo resultado é esperado para categoria inexistente
     * ou pertencente a outra empresa: a validação não encontra
     * uma categoria vinculada à empresa autenticada.
     */
    prisma.categoria.findFirst.mockResolvedValue(null);

    await expect(
      service.listar(
        'empresa-1',
        'usuario-1',
        {
          pagina: 1,
          limite: 20,
          categoriaId: 'categoria-empresa-2',
        },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(prisma.categoria.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'categoria-empresa-2',
        empresaId: 'empresa-1',
      },
      select: {
        id: true,
      },
    });

    // Nenhuma listagem deve ser executada após a validação falhar.
    expect(prisma.produto.findMany).not.toHaveBeenCalled();
    expect(prisma.produto.count).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('deve combinar categoria, situação, pesquisa e paginação', async () => {
    /*
     * Todos os filtros devem ser aplicados na mesma consulta.
     * A contagem também precisa utilizar os mesmos critérios,
     * garantindo a paginação correta dos resultados.
     */
    prisma.categoria.findFirst.mockResolvedValue({
      id: 'categoria-1',
    });

    prisma.$transaction.mockResolvedValue([
      [produtoExemplo],
      11,
    ]);

    const resultado = await service.listar(
      'empresa-1',
      'usuario-1',
      {
        pagina: 2,
        limite: 5,
        categoriaId: 'categoria-1',
        ativo: false,
        busca: '  arroz  ',
      },
    );

    const whereEsperado = {
      empresaId: 'empresa-1',
      categoriaId: 'categoria-1',
      ativo: false,
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
      orderBy: {
        nome: 'asc',
      },
      skip: 5,
      take: 5,
      include: {
        saldoEstoque: true,
      },
    });

    expect(prisma.produto.count).toHaveBeenCalledWith({
      where: whereEsperado,
    });

    expect(resultado).toEqual({
      dados: [produtoExemplo],
      total: 11,
      pagina: 2,
      limite: 5,
      totalPaginas: 3,
    });

    expect(auditoria.registrar).toHaveBeenCalledWith(
      expect.objectContaining({
        metadados: expect.objectContaining({
          categoriaInformada: true,
          filtroAtivo: false,
          buscaInformada: true,
        }),
      }),
    );
  });

  // ============================================================
  // CONSULTA POR IDENTIFICADOR
  // ============================================================


  // ============================================================
  // FILTROS POR ESTADO DO ESTOQUE
  // ============================================================

  it.each([
    {
      estado: 'NORMAL',
      saldoEsperado: {
        is: {
          quantidadeDisponivel: { gt: 0 },
          OR: [
            { estoqueMinimo: { lte: 0 } },
            {
              quantidadeDisponivel: {
                gt: prisma.saldoEstoque.fields.estoqueMinimo,
              },
            },
          ],
        },
      },
    },
    {
      estado: 'CRITICO',
      saldoEsperado: {
        is: {
          quantidadeDisponivel: {
            gt: 0,
            lte: prisma.saldoEstoque.fields.estoqueMinimo,
          },
          estoqueMinimo: { gt: 0 },
        },
      },
    },
    {
      estado: 'SEM_ESTOQUE',
      saldoEsperado: {
        is: {
          quantidadeDisponivel: { lte: 0 },
        },
      },
    },
    {
      estado: 'SEM_SALDO',
      saldoEsperado: {
        is: null,
      },
    },
  ] as const)(
    'deve aplicar o filtro de estoque $estado',
    async ({ estado, saldoEsperado }) => {
      /*
       * Confirma que a condição de estoque é aplicada
       * igualmente à listagem e à contagem.
       *
       * A empresa autenticada permanece obrigatória.
       */
      prisma.$transaction.mockResolvedValue([[], 0]);

      await service.listar(
        'empresa-1',
        'usuario-1',
        {
          pagina: 1,
          limite: 20,
          estadoEstoque: estado,
        },
      );

      const whereEsperado = {
        empresaId: 'empresa-1',
        saldoEstoque: saldoEsperado,
      };

      expect(prisma.produto.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: whereEsperado,
          skip: 0,
          take: 20,
        }),
      );

      expect(prisma.produto.count).toHaveBeenCalledWith({
        where: whereEsperado,
      });

      // A auditoria identifica o filtro efetivamente solicitado.
      expect(auditoria.registrar).toHaveBeenCalledWith(
        expect.objectContaining({
          empresaId: 'empresa-1',
          acao: 'CONSULTAR_LISTA',
          metadados: expect.objectContaining({
            estadoEstoque: estado,
          }),
        }),
      );
    },
  );

  it('deve manter a listagem completa com filtro TODOS', async () => {
    /*
     * TODOS não adiciona condição de estoque.
     * O isolamento pela empresa continua obrigatório.
     */
    prisma.$transaction.mockResolvedValue([[], 0]);

    await service.listar(
      'empresa-2',
      'usuario-1',
      {
        pagina: 1,
        limite: 20,
        estadoEstoque: 'TODOS',
      },
    );

    expect(prisma.produto.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          empresaId: 'empresa-2',
        },
      }),
    );

    expect(prisma.produto.count).toHaveBeenCalledWith({
      where: {
        empresaId: 'empresa-2',
      },
    });
  });

  it('deve combinar estoque critico com os demais filtros', async () => {
    /*
     * Verifica a combinação de todos os critérios.
     * A mesma condição deve ser usada na listagem e na contagem,
     * preservando a paginação e o isolamento entre empresas.
     */
    prisma.categoria.findFirst.mockResolvedValue({
      id: 'categoria-1',
    });

    prisma.$transaction.mockResolvedValue([
      [produtoExemplo],
      11,
    ]);

    const resultado = await service.listar(
      'empresa-1',
      'usuario-1',
      {
        pagina: 2,
        limite: 5,
        categoriaId: 'categoria-1',
        ativo: true,
        busca: '  arroz  ',
        estadoEstoque: 'CRITICO',
      },
    );

    const whereEsperado = {
      empresaId: 'empresa-1',
      categoriaId: 'categoria-1',
      ativo: true,
      saldoEstoque: {
        is: {
          quantidadeDisponivel: {
            gt: 0,
            lte: prisma.saldoEstoque.fields.estoqueMinimo,
          },
          estoqueMinimo: { gt: 0 },
        },
      },
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

    expect(prisma.categoria.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'categoria-1',
        empresaId: 'empresa-1',
      },
      select: {
        id: true,
      },
    });

    expect(prisma.produto.findMany).toHaveBeenCalledWith({
      where: whereEsperado,
      orderBy: { nome: 'asc' },
      skip: 5,
      take: 5,
      include: { saldoEstoque: true },
    });

    expect(prisma.produto.count).toHaveBeenCalledWith({
      where: whereEsperado,
    });

    expect(resultado).toEqual({
      dados: [produtoExemplo],
      total: 11,
      pagina: 2,
      limite: 5,
      totalPaginas: 3,
    });

    expect(auditoria.registrar).toHaveBeenCalledWith(
      expect.objectContaining({
        empresaId: 'empresa-1',
        metadados: expect.objectContaining({
          estadoEstoque: 'CRITICO',
          categoriaInformada: true,
          buscaInformada: true,
        }),
      }),
    );
  });

  it('deve consultar produto dentro da empresa autenticada', async () => {
    prisma.produto.findFirst.mockResolvedValue(produtoExemplo);

    await expect(
      service.buscarPorId('empresa-1', 'usuario-1', 'produto-1'),
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
        'usuario-1',
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

  it('deve registrar auditoria nas cinco consultas de produtos e estoque', async () => {
    // Prepara respostas vazias para as listagens e um produto válido para as consultas por ID.
    prisma.$transaction.mockResolvedValue([[], 0]);
    prisma.produto.findMany.mockResolvedValue([]);
    prisma.produto.findFirst.mockResolvedValue(produtoExemplo);
    prisma.movimentacaoEstoque.findMany.mockResolvedValue([]);

    await service.listar('empresa-1', 'usuario-1', {
      pagina: 1,
      limite: 20,
    });
    await service.obterResumoEstoque('empresa-1', 'usuario-1');
    await service.buscarPorId('empresa-1', 'usuario-1', 'produto-1');
    await service.listarAtividadesRecentes('empresa-1', 'usuario-1');
    await service.listarMovimentacoes(
      'empresa-1',
      'usuario-1',
      'produto-1',
      { pagina: 1, limite: 20 },
    );

    // O histórico valida o produto por helper privado, sem gerar auditoria duplicada.
    expect(auditoria.registrar).toHaveBeenCalledTimes(5);

    expect(auditoria.registrar).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        empresaId: 'empresa-1',
        atorId: 'usuario-1',
        tipoAtor: 'USUARIO_EMPRESA',
        modulo: 'PRODUTOS',
        acao: 'CONSULTAR_LISTA',
        entidade: 'PRODUTO',
        resultado: 'SUCESSO',
        metadados: {
          pagina: 1,
          limite: 20,
          filtroAtivo: null,
          categoriaInformada: false,
          estadoEstoque: 'TODOS',
          buscaInformada: false,
          quantidadeRetornada: 0,
          totalRegistros: 0,
        },
      }),
    );

    expect(auditoria.registrar).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        empresaId: 'empresa-1',
        atorId: 'usuario-1',
        modulo: 'ESTOQUE',
        acao: 'CONSULTAR_RESUMO',
        entidade: 'ESTOQUE',
        resultado: 'SUCESSO',
        metadados: {
          totalProdutos: 0,
          produtosAtivos: 0,
          produtosInativos: 0,
          estoqueAdequado: 0,
          estoqueCritico: 0,
          semEstoque: 0,
          semSaldo: 0,
          totalAlertas: 0,
        },
      }),
    );

    expect(auditoria.registrar).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        empresaId: 'empresa-1',
        atorId: 'usuario-1',
        modulo: 'PRODUTOS',
        acao: 'CONSULTAR',
        entidade: 'PRODUTO',
        entidadeId: 'produto-1',
        resultado: 'SUCESSO',
      }),
    );

    expect(auditoria.registrar).toHaveBeenNthCalledWith(
      4,
      expect.objectContaining({
        empresaId: 'empresa-1',
        atorId: 'usuario-1',
        modulo: 'ESTOQUE',
        acao: 'CONSULTAR_LISTA',
        entidade: 'MOVIMENTACAO_ESTOQUE',
        resultado: 'SUCESSO',
        metadados: {
          quantidadeRetornada: 0,
        },
      }),
    );

    expect(auditoria.registrar).toHaveBeenNthCalledWith(
      5,
      expect.objectContaining({
        empresaId: 'empresa-1',
        atorId: 'usuario-1',
        modulo: 'ESTOQUE',
        acao: 'CONSULTAR_LISTA',
        entidade: 'MOVIMENTACAO_ESTOQUE',
        entidadeId: 'produto-1',
        resultado: 'SUCESSO',
        metadados: {
          pagina: 1,
          limite: 20,
          quantidadeRetornada: 0,
          totalRegistros: 0,
        },
      }),
    );
  });

  it('não deve entregar a listagem quando a gravação da auditoria falhar', async () => {
    prisma.$transaction.mockResolvedValue([[], 0]);
    auditoria.registrar.mockRejectedValue(
      new Error('Auditoria indisponível'),
    );

    await expect(
      service.listar('empresa-1', 'usuario-1', {
        pagina: 1,
        limite: 20,
      }),
    ).rejects.toThrow('Auditoria indisponível');
  });

  // ============================================================
  // ATUALIZAÇÃO DE PRODUTOS
  // ============================================================

  it('deve atualizar somente os campos enviados', async () => {
  transacao.produto.findFirst.mockResolvedValue(produtoExemplo);

  transacao.produto.update.mockResolvedValue({
    ...produtoExemplo,
    nome: 'Arroz premium',
  });

  const dto: AtualizarProdutoDto = {
    nome: '  Arroz premium  ',
  };

  await expect(
    service.atualizar(
      'empresa-1',
      'usuario-1',
      'produto-1',
      dto,
    ),
  ).resolves.toMatchObject({
    nome: 'Arroz premium',
  });

  // Confirma que o estado anterior foi consultado na transação.
  expect(transacao.produto.findFirst).toHaveBeenCalledWith({
    where: {
      id: 'produto-1',
      empresaId: 'empresa-1',
    },
  });

  // Confirma que somente o campo informado foi atualizado.
  expect(transacao.produto.update).toHaveBeenCalledWith({
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

  // Confirma que a auditoria participa da mesma transação.
  expect(auditoria.registrar).toHaveBeenCalledWith(
    expect.objectContaining({
      empresaId: 'empresa-1',
      atorId: 'usuario-1',
      modulo: 'PRODUTOS',
      acao: 'ATUALIZAR',
      entidade: 'PRODUTO',
      entidadeId: 'produto-1',
      resultado: 'SUCESSO',
    }),
    transacao,
  );
});

it('deve impedir atualização de produto de outra empresa', async () => {
  // Simula um produto que não pertence à empresa autenticada.
  transacao.produto.findFirst.mockResolvedValue(null);

  await expect(
    service.atualizar(
      'empresa-1',
      'usuario-1',
      'produto-empresa-2',
      {
        nome: 'Tentativa de alteração',
      },
    ),
  ).rejects.toBeInstanceOf(NotFoundException);

  // O produto não encontrado não pode ser atualizado.
  expect(transacao.produto.update).not.toHaveBeenCalled();

  // A tentativa recusada deve gerar um evento de falha.
  expect(auditoria.registrar).toHaveBeenCalledWith(
    expect.objectContaining({
      empresaId: 'empresa-1',
      atorId: 'usuario-1',
      modulo: 'PRODUTOS',
      acao: 'ATUALIZAR',
      entidade: 'PRODUTO',
      entidadeId: 'produto-empresa-2',
      resultado: 'FALHA',
    }),
  );
});

it('deve rejeitar atualização sem campos informados', async () => {
  await expect(
    service.atualizar(
      'empresa-1',
      'usuario-1',
      'produto-1',
      {} as AtualizarProdutoDto,
    ),
  ).rejects.toBeInstanceOf(BadRequestException);

  // A validação ocorre antes de qualquer consulta ou transação.
  expect(prisma.$transaction).not.toHaveBeenCalled();
  expect(transacao.produto.findFirst).not.toHaveBeenCalled();
  expect(transacao.produto.update).not.toHaveBeenCalled();

  // A tentativa recusada deve ser registrada na auditoria.
  expect(auditoria.registrar).toHaveBeenCalledWith(
    expect.objectContaining({
      empresaId: 'empresa-1',
      atorId: 'usuario-1',
      modulo: 'PRODUTOS',
      acao: 'ATUALIZAR',
      entidade: 'PRODUTO',
      entidadeId: 'produto-1',
      resultado: 'FALHA',
    }),
  );
});

  // ============================================================
  // ATIVAÇÃO E DESATIVAÇÃO
  // ============================================================

it('deve desativar produto utilizando a chave composta da empresa', async () => {
  // Simula a consulta do produto dentro da transação.
  transacao.produto.findFirst.mockResolvedValue(produtoExemplo);

  // Simula a atualização do produto.
  transacao.produto.update.mockResolvedValue({
    ...produtoExemplo,
    ativo: false,
  });

  await expect(
    service.alterarAtivacao(
      'empresa-1',
      'usuario-1',
      'produto-1',
      false,
    ),
  ).resolves.toMatchObject({
    ativo: false,
  });

  // Confirma que o produto foi localizado na empresa correta.
  expect(transacao.produto.findFirst).toHaveBeenCalledWith({
    where: {
      id: 'produto-1',
      empresaId: 'empresa-1',
    },
    select: {
      id: true,
      nome: true,
      ativo: true,
    },
  });

  // Confirma a atualização utilizando a chave composta.
  expect(transacao.produto.update).toHaveBeenCalledWith({
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

  // Confirma que a auditoria participa da mesma transação.
  expect(auditoria.registrar).toHaveBeenCalledWith(
    expect.objectContaining({
      empresaId: 'empresa-1',
      atorId: 'usuario-1',
      modulo: 'PRODUTOS',
      acao: 'ALTERAR_ATIVACAO',
      entidade: 'PRODUTO',
      entidadeId: 'produto-1',
      resultado: 'SUCESSO',
    }),
    transacao,
  );
});

 it('deve retornar produto não encontrado ao alterar produto inexistente', async () => {
  // Simula que o produto não existe na empresa autenticada.
  transacao.produto.findFirst.mockResolvedValue(null);

  await expect(
    service.alterarAtivacao(
      'empresa-1',
      'usuario-1',
      'produto-inexistente',
      false,
    ),
  ).rejects.toBeInstanceOf(NotFoundException);

  // Um produto inexistente nunca pode ser atualizado.
  expect(transacao.produto.update).not.toHaveBeenCalled();

  // A tentativa recusada deve gerar um evento de auditoria.
  expect(auditoria.registrar).toHaveBeenCalledWith(
    expect.objectContaining({
      empresaId: 'empresa-1',
      atorId: 'usuario-1',
      modulo: 'PRODUTOS',
      acao: 'ALTERAR_ATIVACAO',
      entidade: 'PRODUTO',
      entidadeId: 'produto-inexistente',
      resultado: 'FALHA',
    }),
  );
});
});
