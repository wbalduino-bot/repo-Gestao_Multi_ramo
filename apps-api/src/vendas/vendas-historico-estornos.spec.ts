import { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { AuditoriaService } from '../auditoria/auditoria.service.js';
import { VendasService } from './vendas.service.js';

const d = (valor: string) => new Prisma.Decimal(valor);

const venda = () => ({
  id: 'venda-abobrinha',
  formaPagamento: 'PIX',
  total: d('14.08'),
  subtotalOriginal: d('14.08'),
  percentualDesconto: d('0'),
  valorDesconto: d('0'),
  autorizadorDescontoId: null,
  valorRecebido: null,
  troco: null,
  criadoEm: new Date('2026-11-16T18:22:00.000Z'),
  usuario: { id: 'atendente-1', nome: 'Atendente' },
  _count: { itens: 1 },
  itens: [{
    id: 'item-abobrinha',
    quantidade: d('2.350'),
    precoUnitario: d('5.99'),
    subtotal: d('14.08'),
    custoUnitario: d('2.00'),
    produto: { id: 'produto-1', nome: 'ABOBRINHA', sku: 'ABO-1' },
  }],
  estornos: [{
    id: 'estorno-1',
    criadoEm: new Date('2026-11-16T19:10:00.000Z'),
    justificativa: 'Devolucao parcial do produto',
    totalEstornado: d('5.99'),
    usuario: { id: 'gerente-1', nome: 'Gerente' },
    itens: [{
      itemVendaId: 'item-abobrinha',
      quantidade: d('1.000'),
      valorEstornado: d('5.99'),
      itemVenda: { produto: { nome: 'ABOBRINHA' } },
    }],
  }],
});

describe('historico de vendas com estornos', () => {
  const db = {
    venda: {
      findMany: vi.fn(),
      count: vi.fn(),
      findFirst: vi.fn(),
    },
    $transaction: vi.fn(),
  };
  let service: VendasService;
  beforeEach(() => {
    vi.resetAllMocks();
    db.venda.findMany.mockResolvedValue([venda()]);
    db.venda.count.mockResolvedValue(1);
    db.venda.findFirst.mockResolvedValue(venda());
    db.$transaction.mockImplementation(async (promessas: Promise<unknown>[]) => Promise.all(promessas));
    service = new VendasService(db as unknown as PrismaService, {} as AuditoriaService);
  });

  it('retorna linha de estorno, venda original, total liquido e lucro liquido na listagem', async () => {
    const resultado = await service.listar('empresa-1', { pagina: 1, limite: 10 });
    const registro = resultado.dados[0];
    expect(registro.total).toBe(14.08);
    expect(registro.valorEstornado).toBe(5.99);
    expect(registro.totalLiquido).toBe(8.09);
    expect(registro.estornos).toHaveLength(1);
    expect(registro.estornos[0].itens[0].nomeProduto).toBe('ABOBRINHA');
    expect(registro.estornos[0].usuario.nome).toBe('Gerente');
    expect(registro.estornos[0].reembolsoFinanceiro).toBe('NAO_REGISTRADO');
    expect(registro.custoTotal).toBe(2.70);
    expect(registro.lucroBrutoTotal).toBe(5.39);
    expect(db.venda.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ empresaId: 'empresa-1' }),
      select: expect.objectContaining({ estornos: expect.anything() }),
    }));
  });

  it('mantem detalhe original e reflete saldo apos estorno na consulta individual', async () => {
    const resultado = await service.buscarPorId('empresa-1', 'venda-abobrinha');
    expect(resultado.total).toBe(14.08);
    expect(resultado.totalLiquido).toBe(8.09);
    expect(resultado.itens[0].quantidade).toBe(2.35);
    expect(resultado.itens[0].quantidadeEstornada).toBe(1);
    expect(resultado.itens[0].quantidadeLiquida).toBe(1.35);
    expect(resultado.estornos[0].valorEstornado).toBe(5.99);
    expect(resultado.lucroBrutoTotal).toBe(5.39);
  });
});
