
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';

import {
  Prisma,
  ResultadoAuditoria,
  TipoAtorAuditoria,
} from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PrismaService } from '../prisma/prisma.service.js';
import { AuditoriaService } from '../auditoria/auditoria.service.js';
import { CriarVendaDto } from './dto/criar-venda.dto.js';
import { VendasService } from './vendas.service.js';
import type { LoginRateLimitService } from '../auth/login-rate-limit.service.js';
import * as argon2 from 'argon2';

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

  const auditoria = {
    registrar: vi.fn(),
  };
  const liberarReserva = vi.fn();
  const loginRateLimit = { reservarTentativa: vi.fn() };

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
      create: vi.fn((
        { data }: { data: Prisma.MovimentacaoEstoqueUncheckedCreateInput },
      ): unknown => ({
        ...data,
        id: 'movimentacao-1',
        criadoEm: new Date('2026-11-07T12:00:00Z'),
      })),
    },
    loteEstoque: {
      create: vi.fn(() => ({ id: 'lote-1' })),
      findMany: vi.fn(() => [
        { id: 'lote-1', quantidadeRestante: new Prisma.Decimal('10') },
      ]),
      update: vi.fn(),
    },
    movimentacaoLoteEstoque: {
      create: vi.fn(),
    },
  };

  const produtoExemplo = {
    id: 'produto-1',
    nome: 'Arroz tipo 1',
    sku: 'ALM-001',
    preco: new Prisma.Decimal('25.00'),
    custo: new Prisma.Decimal('15.00'),
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
        custoUnitario: new Prisma.Decimal('15.00'),
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
    auditoria.registrar.mockResolvedValue({
      id: 'evento-auditoria-1',
    });
    liberarReserva.mockResolvedValue(undefined);
    loginRateLimit.reservarTentativa.mockResolvedValue({ liberar: liberarReserva });

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
      auditoria as unknown as AuditoriaService,
      loginRateLimit as unknown as LoginRateLimitService,
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

    transacao.movimentacaoEstoque.create.mockImplementation(({ data }) => ({
      ...data,
      id: 'movimentacao-1',
      criadoEm: new Date('2026-11-07T12:00:00Z'),
    }));
  }

  it.each(['ADMINISTRADOR', 'GERENTE'] as const)(
    '%s aplica desconto direto sem senha, registra sua identidade e baixa estoque',
    async perfil => {
      prepararCenarioValido();
      transacao.usuario.findFirst.mockResolvedValue({
        id: 'usuario-1', nome: 'Gestor', perfil,
      });
      transacao.venda.create.mockImplementation(async ({ data }: { data: { total: Prisma.Decimal } }) => ({
        ...vendaPersistida, total: data.total,
      }));
      const resultado = await service.criar('empresa-1', 'usuario-1', {
        formaPagamento: 'DINHEIRO', valorRecebido: 50,
        percentualDesconto: 5,
        itens: [{ produtoId: 'produto-1', quantidade: 2 }],
      }, '127.0.0.1');
      expect(resultado.total).toBe(47.5);
      expect(resultado.troco).toBe(2.5);
      const data = (transacao.venda.create.mock.calls[0][0] as {
        data: { autorizadorDescontoId: string; percentualDesconto: Prisma.Decimal }
      }).data;
      expect(data.autorizadorDescontoId).toBe('usuario-1');
      expect(data.percentualDesconto.toString()).toBe('5');
      expect(loginRateLimit.reservarTentativa).not.toHaveBeenCalled();
      expect(transacao.usuario.findFirst).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({ empresaId: 'empresa-1', ativo: true }),
        select: expect.objectContaining({ perfil: true }),
      }));
      expect(auditoria.registrar).toHaveBeenCalledWith(expect.objectContaining({
        dadosPosteriores: expect.objectContaining({ autorizadorDescontoId: 'usuario-1' }),
      }), transacao);
      expect(transacao.saldoEstoque.update).toHaveBeenCalledTimes(1);
    },
  );

  it.each(['CAIXA', 'ATENDENTE', 'GARCOM'] as const)(
    '%s nao pode aplicar desconto sem senha administrativa', async perfil => {
      prepararCenarioValido();
      transacao.usuario.findFirst.mockResolvedValue({ id: 'usuario-1', nome: 'Operador', perfil });
      await expect(service.criar('empresa-1', 'usuario-1', {
        formaPagamento: 'PIX', percentualDesconto: 5,
        itens: [{ produtoId: 'produto-1', quantidade: 2 }],
      })).rejects.toBeInstanceOf(ForbiddenException);
      expect(transacao.venda.create).not.toHaveBeenCalled();
      expect(transacao.saldoEstoque.update).not.toHaveBeenCalled();
    },
  );

  it('aplica desconto de 5% com senha administrativa valida, auditando e preservando estoque', async () => {
    prepararCenarioValido();
    const hashSenha = await argon2.hash('SenhaAdministrativaDeTeste#2026');
    transacao.usuario.findFirst.mockImplementation(async ({ where }: { where: { perfil?: string } }) =>
      where.perfil === 'ADMINISTRADOR'
        ? { id: 'administrador-1', hashSenha }
        : { id: 'usuario-1', nome: 'Operador de caixa' },
    );
    transacao.venda.create.mockImplementation(async ({ data }: { data: { total: Prisma.Decimal } }) => ({
      ...vendaPersistida,
      total: data.total,
    }));
    const resultado = await service.criar('empresa-1', 'usuario-1', {
      formaPagamento: 'DINHEIRO', valorRecebido: 50,
      percentualDesconto: 5,
      autorizadorEmail: 'admin@empresa.com',
      senhaAutorizador: 'SenhaAdministrativaDeTeste#2026',
      itens: [{ produtoId: 'produto-1', quantidade: 2 }],
    }, '127.0.0.1');
    expect(resultado.total).toBe(47.5);
    expect(resultado.subtotalOriginal).toBe(50);
    expect(resultado.valorDesconto).toBe(2.5);
    expect(resultado.troco).toBe(2.5);
    expect(loginRateLimit.reservarTentativa).toHaveBeenCalledWith('empresa-1', 'admin@empresa.com', '127.0.0.1');
    expect(liberarReserva).toHaveBeenCalledTimes(1);
    const data = (transacao.venda.create.mock.calls[0][0] as { data: { total: Prisma.Decimal; autorizadorDescontoId: string } }).data;
    expect(data.autorizadorDescontoId).toBe('administrador-1');
    expect(data.total.toString()).toBe('47.5');
    expect(JSON.stringify(auditoria.registrar.mock.calls)).not.toContain('SenhaAdministrativaDeTeste#2026');
    expect(transacao.saldoEstoque.update).toHaveBeenCalledTimes(1);
  });

  it('rejeita senha errada sem criar venda nem baixar estoque', async () => {
    prepararCenarioValido();
    const hashSenha = await argon2.hash('SenhaCorreta#2026');
    transacao.usuario.findFirst.mockImplementation(async ({ where }: { where: { perfil?: string } }) =>
      where.perfil === 'ADMINISTRADOR' ? { id: 'admin', hashSenha }
        : { id: 'usuario-1', nome: 'Operador' },
    );
    await expect(service.criar('empresa-1', 'usuario-1', {
      formaPagamento: 'PIX', percentualDesconto: 3,
      autorizadorEmail: 'admin@empresa.com', senhaAutorizador: 'SenhaErrada',
      itens: [{ produtoId: 'produto-1', quantidade: 2 }],
    }, '127.0.0.1')).rejects.toBeInstanceOf(ForbiddenException);
    expect(liberarReserva).not.toHaveBeenCalled();
    expect(transacao.venda.create).not.toHaveBeenCalled();
    expect(transacao.saldoEstoque.update).not.toHaveBeenCalled();
  });

  it.each([-1, 5.01, 8, Number.NaN])('rejeita desconto invalido %s', async percentualDesconto => {
    prepararCenarioValido();
    await expect(service.criar('empresa-1', 'usuario-1', {
      formaPagamento: 'PIX', percentualDesconto,
      itens: [{ produtoId: 'produto-1', quantidade: 2 }],
    })).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  /**
   * Confirma que o total definitivo é calculado pelo backend
   * e que valor recebido e troco são persistidos na venda.
   */
  it('deve calcular o troco de um pagamento em dinheiro', async () => {
    prepararCenarioValido();

    // Duas unidades a R$ 43,75 totalizam R$ 87,50.
    transacao.produto.findMany.mockResolvedValue([
      {
        ...produtoExemplo,
        preco: new Prisma.Decimal('43.75'),
      },
    ]);

    transacao.venda.create.mockResolvedValue({
      ...vendaPersistida,
      formaPagamento: 'DINHEIRO',
      total: new Prisma.Decimal('87.50'),
    });

    const dto: CriarVendaDto = {
      formaPagamento: 'DINHEIRO',
      valorRecebido: 100,
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

    expect(resultado.total).toBe(87.5);
    expect(resultado.valorRecebido).toBe(100);
    expect(resultado.troco).toBe(12.5);

    // Confirma os valores enviados ao Prisma para persistência.
    const chamada = transacao.venda.create.mock.calls[0][0] as {
      data: {
        total: Prisma.Decimal;
        valorRecebido: Prisma.Decimal;
        troco: Prisma.Decimal;
      };
    };

    expect(chamada.data.total.toString()).toBe('87.5');
    expect(chamada.data.valorRecebido.toString()).toBe('100');
    expect(chamada.data.troco.toString()).toBe('12.5');

    expect(transacao.saldoEstoque.update).toHaveBeenCalledTimes(1);
    expect(transacao.movimentacaoEstoque.create).toHaveBeenCalledTimes(1);
  });

  /**
   * Um pagamento exato deve registrar troco zero,
   * sem confundir esse resultado com ausência de pagamento.
   */
  it('deve registrar troco zero para pagamento exato', async () => {
    prepararCenarioValido();

    transacao.venda.create.mockResolvedValue({
      ...vendaPersistida,
      formaPagamento: 'DINHEIRO',
    });

    const resultado = await service.criar(
      'empresa-1',
      'usuario-1',
      {
        formaPagamento: 'DINHEIRO',
        valorRecebido: 50,
        itens: [
          {
            produtoId: 'produto-1',
            quantidade: 2,
          },
        ],
      },
    );

    expect(resultado.valorRecebido).toBe(50);
    expect(resultado.troco).toBe(0);

    const chamada = transacao.venda.create.mock.calls[0][0] as {
      data: { troco: Prisma.Decimal };
    };

    expect(chamada.data.troco.toString()).toBe('0');
  });

  /**
   * Uma quantia insuficiente deve impedir a criação
   * da venda e qualquer baixa de estoque.
   */
  it('deve rejeitar dinheiro insuficiente sem baixar estoque', async () => {
    prepararCenarioValido();

    await expect(
      service.criar(
        'empresa-1',
        'usuario-1',
        {
          formaPagamento: 'DINHEIRO',
          valorRecebido: 40,
          itens: [
            {
              produtoId: 'produto-1',
              quantidade: 2,
            },
          ],
        },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(transacao.venda.create).not.toHaveBeenCalled();
    expect(transacao.saldoEstoque.update).not.toHaveBeenCalled();
    expect(transacao.movimentacaoEstoque.create).not.toHaveBeenCalled();
  });

  /**
   * O recebimento em dinheiro não pode ser informado
   * para pagamentos realizados por outros meios.
   */
  it('deve rejeitar valor recebido para pagamento PIX', async () => {
    prepararCenarioValido();

    await expect(
      service.criar(
        'empresa-1',
        'usuario-1',
        {
          formaPagamento: 'PIX',
          valorRecebido: 100,
          itens: [
            {
              produtoId: 'produto-1',
              quantidade: 2,
            },
          ],
        },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(transacao.venda.create).not.toHaveBeenCalled();
  });

  /**
   * Preserva temporariamente o contrato antigo do PDV:
   * vendas em dinheiro sem valor recebido continuam aceitas.
   */
  it('deve aceitar temporariamente dinheiro sem valor recebido', async () => {
    prepararCenarioValido();

    transacao.venda.create.mockResolvedValue({
      ...vendaPersistida,
      formaPagamento: 'DINHEIRO',
    });

    const resultado = await service.criar(
      'empresa-1',
      'usuario-1',
      {
        formaPagamento: 'DINHEIRO',
        itens: [
          {
            produtoId: 'produto-1',
            quantidade: 2,
          },
        ],
      },
    );

    expect(resultado.valorRecebido).toBeNull();
    expect(resultado.troco).toBeNull();

    const chamada = transacao.venda.create.mock.calls[0][0] as {
      data: {
        valorRecebido: Prisma.Decimal | null;
        troco: Prisma.Decimal | null;
      };
    };

    expect(chamada.data.valorRecebido).toBeNull();
    expect(chamada.data.troco).toBeNull();
  });

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

    // A auditoria de sucesso deve participar da transação comercial.
    expect(auditoria.registrar).toHaveBeenCalledTimes(1);

    const [eventoSucesso, clienteTransacional] =
      auditoria.registrar.mock.calls[0] as unknown as [
        Record<string, unknown>,
        unknown,
      ];

    expect(eventoSucesso).toMatchObject({
      empresaId: 'empresa-1',
      atorId: 'usuario-1',
      tipoAtor: TipoAtorAuditoria.USUARIO_EMPRESA,
      modulo: 'VENDAS',
      acao: 'CRIAR',
      entidade: 'VENDA',
      entidadeId: 'venda-1',
      resultado: ResultadoAuditoria.SUCESSO,
    });

    expect(clienteTransacional).toBe(transacao);
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

    expect(auditoria.registrar).toHaveBeenCalledTimes(1);

    const chamadaFalha = auditoria.registrar.mock.calls[0];
    expect(chamadaFalha).toHaveLength(1);
    expect(chamadaFalha[0]).toMatchObject({
      empresaId: 'empresa-1',
      atorId: 'usuario-1',
      tipoAtor: TipoAtorAuditoria.USUARIO_EMPRESA,
      modulo: 'VENDAS',
      acao: 'CRIAR',
      entidade: 'VENDA',
      resultado: ResultadoAuditoria.FALHA,
    });
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
  it('deve propagar a falha da auditoria transacional e registrar a falha fora da transação', async () => {
    prepararCenarioValido();

    auditoria.registrar.mockRejectedValueOnce(
      new Error('Falha ao registrar auditoria de sucesso'),
    );

    const dto: CriarVendaDto = {
      formaPagamento: 'PIX',
      itens: [
        {
          produtoId: 'produto-1',
          quantidade: 2,
        },
      ],
    };

    await expect(
      service.criar('empresa-1', 'usuario-1', dto),
    ).rejects.toThrow('Falha ao registrar auditoria de sucesso');

    expect(auditoria.registrar).toHaveBeenCalledTimes(2);

    const primeiraChamada =
      auditoria.registrar.mock.calls[0] as unknown as [
        Record<string, unknown>,
        unknown,
      ];

    expect(primeiraChamada[0]).toMatchObject({
      modulo: 'VENDAS',
      acao: 'CRIAR',
      resultado: ResultadoAuditoria.SUCESSO,
    });
    expect(primeiraChamada[1]).toBe(transacao);

    const segundaChamada =
      auditoria.registrar.mock.calls[1];

    expect(segundaChamada).toHaveLength(1);
    expect(segundaChamada[0]).toMatchObject({
      modulo: 'VENDAS',
      acao: 'CRIAR',
      entidadeId: 'venda-1',
      resultado: ResultadoAuditoria.FALHA,
      motivo: 'Error',
    });
  });

  it('deve preservar o erro original quando o registro da falha na auditoria também falhar', async () => {
    prepararCenarioValido('10');

    auditoria.registrar.mockRejectedValueOnce(
      new Error('Auditoria temporariamente indisponível'),
    );

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

    expect(auditoria.registrar).toHaveBeenCalledTimes(1);
  });

});
