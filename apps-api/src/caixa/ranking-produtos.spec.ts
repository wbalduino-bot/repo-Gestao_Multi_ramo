import { describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { CaixaService } from './caixa.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { AuditoriaService } from '../auditoria/auditoria.service.js';

describe('CaixaService.rankingProdutos', () => {
  const montar = () => {
    const prisma = {
      itemVenda: { groupBy: vi.fn().mockResolvedValue([
        { produtoId: 'p1', _sum: { quantidade: new Prisma.Decimal('2.350'), subtotal: new Prisma.Decimal('14.08') } },
        { produtoId: 'p2', _sum: { quantidade: new Prisma.Decimal('5.000'), subtotal: new Prisma.Decimal('10.00') } },
      ]) },
      produto: { findMany: vi.fn().mockResolvedValue([
        { id: 'p1', nome: 'ABOBRINHA', unidadeId: 'kg-id' },
        { id: 'p2', nome: 'CEBOLA', unidadeId: 'un-id' },
      ]) },
      unidade: { findMany: vi.fn().mockResolvedValue([
        { id: 'kg-id', codigo: 'KG' }, { id: 'un-id', codigo: 'UN' },
      ]) },
    };
    const service = new CaixaService(
      prisma as unknown as PrismaService,
      { registrar: vi.fn() } as unknown as AuditoriaService,
    );
    return { prisma, service };
  };

  it('isola por empresa e ordena top valor bruto sem misturar unidades', async () => {
    const { service, prisma } = montar();
    const retorno = await service.rankingProdutos('empresa-a', 30, '2026-11-16');
    expect(prisma.itemVenda.groupBy).toHaveBeenCalledWith(expect.objectContaining({
      where: { venda: { is: expect.objectContaining({ empresaId: 'empresa-a' }) } },
    }));
    expect(retorno.topFaturamento[0]).toMatchObject({ nome: 'ABOBRINHA', quantidadeVendida: 2.35, valorBrutoItens: 14.08 });
    expect(retorno.quantidadePorUnidade.map((grupo) => grupo.unidade)).toEqual(['KG', 'UN']);
    expect(retorno.natureza).toBe('PRODUTOS_BRUTOS_SEM_DESCONTO_OU_ESTORNO');
  });

  it('responde ranking vazio sem buscar produto, preservando periodo', async () => {
    const { service, prisma } = montar();
    prisma.itemVenda.groupBy.mockResolvedValueOnce([]);
    const retorno = await service.rankingProdutos('empresa-a', 15, '2026-11-16');
    expect(retorno.topFaturamento).toEqual([]);
    expect(retorno.inicio).toBe('2026-11-02');
    expect(prisma.produto.findMany).not.toHaveBeenCalled();
  });
});
