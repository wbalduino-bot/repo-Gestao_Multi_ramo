import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { EstornosVendaService, identificarEstorno } from './estornos-venda.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { AuditoriaService } from '../auditoria/auditoria.service.js';

const empresaId = '00000000-0000-4000-8000-000000000001';
const usuarioId = '00000000-0000-4000-8000-000000000002';
const vendaId = '00000000-0000-4000-8000-000000000003';
const itemId = '00000000-0000-4000-8000-000000000004';
const produtoId = '00000000-0000-4000-8000-000000000005';
const chaveOperacao = '00000000-0000-4000-8000-000000000006';
const D = (n: string) => new Prisma.Decimal(n);
const pedido = (quantidade = 1) => ({
  chaveOperacao,
  justificativa: 'Cliente devolveu produto em boas condicoes.',
  itens: [{ itemVendaId: itemId, quantidade }],
});

function contexto(perfil = 'GERENTE', quantidadeVendida = '2') {
  const tx = {
    usuario: { findFirst: vi.fn().mockResolvedValue({ id: usuarioId, perfil }) },
    estornoVenda: {
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockImplementation(({ data }) => ({
        ...data, id: 'estorno-1', criadoEm: new Date('2026-11-16T12:00:00Z'),
      })),
    },
    venda: { findFirst: vi.fn().mockResolvedValue({
      id: vendaId, empresaId,
      subtotalOriginal: D('11.98'), total: D('11.38'),
      itens: [{ id: itemId, produtoId, quantidade: D(quantidadeVendida), subtotal: D('11.98') }],
    }) },
    itemEstornoVenda: {
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({ id: 'item-estorno-1' }),
    },
    movimentacaoEstoque: {
      findMany: vi.fn().mockResolvedValue([{
        id: 'saida-1', lotes: [{ loteId: 'lote-original-1', quantidade: D(quantidadeVendida) }],
      }]),
      create: vi.fn().mockResolvedValue({ id: 'entrada-1' }),
    },
    saldoEstoque: {
      findFirst: vi.fn().mockResolvedValue({ id: 'saldo-1' }),
      update: vi.fn().mockResolvedValue({ quantidadeDisponivel: D('9.000') }),
    },
    loteEstoque: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    movimentacaoLoteEstoque: { create: vi.fn().mockResolvedValue({}) },
  };
  const prisma = {
    $transaction: vi.fn().mockImplementation((callback) => callback(tx)),
    ...tx,
  };
  const auditoria = { registrar: vi.fn().mockResolvedValue({ id: 'auditoria-1' }) };
  const service = new EstornosVendaService(prisma as unknown as PrismaService,
    auditoria as unknown as AuditoriaService);
  return { service, prisma, tx, auditoria };
}

describe('estorno de vendas', () => {
  it('gera a mesma identidade independentemente da ordem dos itens', () => {
    const item2 = '00000000-0000-4000-8000-000000000007';
    const a = { ...pedido(), itens: [{ itemVendaId: itemId, quantidade: 1 }, { itemVendaId: item2, quantidade: 2 }] };
    const b = { ...pedido(), itens: [...a.itens].reverse() };
    expect(identificarEstorno(vendaId, a).hashRequisicao)
      .toBe(identificarEstorno(vendaId, b).hashRequisicao);
  });

  it('exige justificativa suficiente e bloqueia item duplicado', () => {
    expect(() => identificarEstorno(vendaId, { ...pedido(), justificativa: 'nao' }))
      .toThrow(BadRequestException);
    expect(() => identificarEstorno(vendaId, { ...pedido(), itens: [pedido().itens[0], pedido().itens[0]] }))
      .toThrow(BadRequestException);
  });

  it('permite gerente, restaura o lote original e registra auditoria transacional', async () => {
    const { service, tx, auditoria } = contexto('GERENTE');
    const resposta = await service.criar(empresaId, usuarioId, vendaId, pedido());
    expect(resposta.valorEstornado).toBe(5.69);
    expect(resposta.reembolsoFinanceiro).toBe('NAO_REGISTRADO');
    expect(tx.saldoEstoque.update).toHaveBeenCalledWith({
      where: { id: 'saldo-1' }, data: { quantidadeDisponivel: { increment: D('1') } },
    });
    expect(tx.loteEstoque.updateMany).toHaveBeenCalledWith({
      where: { empresaId, produtoId, id: 'lote-original-1' },
      data: { quantidadeRestante: { increment: D('1') } },
    });
    expect(tx.movimentacaoLoteEstoque.create).toHaveBeenCalledOnce();
    expect(auditoria.registrar).toHaveBeenCalledOnce();
    expect(auditoria.registrar.mock.calls[0][1]).toBe(tx);
  });

  it('permite administrador e rejeita perfil operacional', async () => {
    const admin = contexto('ADMINISTRADOR');
    await expect(admin.service.criar(empresaId, usuarioId, vendaId, pedido())).resolves.toBeDefined();
    const caixa = contexto('CAIXA');
    await expect(caixa.service.criar(empresaId, usuarioId, vendaId, pedido()))
      .rejects.toThrow(ForbiddenException);
    expect(caixa.tx.estornoVenda.create).not.toHaveBeenCalled();
  });

  it('bloqueia estorno superior ao vendido sem movimentar estoque', async () => {
    const c = contexto();
    await expect(c.service.criar(empresaId, usuarioId, vendaId, pedido(3)))
      .rejects.toThrow(ConflictException);
    expect(c.tx.saldoEstoque.update).not.toHaveBeenCalled();
  });

  it('reenvio identico consulta operacao anterior e nao altera o saldo', async () => {
    const c = contexto();
    const op = identificarEstorno(vendaId, pedido());
    c.tx.estornoVenda.findUnique.mockResolvedValue({
      id: 'estorno-antigo', vendaId, empresaId, usuarioId,
      chaveOperacao: op.chaveOperacao, hashRequisicao: op.hashRequisicao,
      justificativa: op.justificativa, totalEstornado: D('5.69'),
      criadoEm: new Date(),
      itens: [{ itemVendaId: itemId, quantidade: D('1'), valorEstornado: D('5.69') }],
    });
    const result = await c.service.criar(empresaId, usuarioId, vendaId, pedido());
    expect(result.id).toBe('estorno-antigo');
    expect(c.tx.estornoVenda.create).not.toHaveBeenCalled();
    expect(c.tx.saldoEstoque.update).not.toHaveBeenCalled();
  });

  it('rejeita mesma chave com justificativa diferente', async () => {
    const c = contexto();
    const op = identificarEstorno(vendaId, pedido());
    c.tx.estornoVenda.findUnique.mockResolvedValue({
      id: 'estorno-antigo', vendaId, empresaId, usuarioId,
      chaveOperacao: op.chaveOperacao, hashRequisicao: op.hashRequisicao,
      justificativa: op.justificativa, totalEstornado: D('5.69'),
      criadoEm: new Date(), itens: [],
    });
    await expect(c.service.criar(empresaId, usuarioId, vendaId,
      { ...pedido(), justificativa: 'Outra justificativa de devolucao agora.' }))
      .rejects.toThrow(ConflictException);
  });

  it('impede estornar novamente unidades ja devolvidas', async () => {
    const c = contexto();
    c.tx.itemEstornoVenda.findMany.mockResolvedValue([{
      quantidade: D('1'), valorEstornado: D('5.69'),
      movimentacaoEstoque: { lotes: [{ loteId: 'lote-original-1', quantidade: D('1') }] },
    }]);
    await expect(c.service.criar(empresaId, usuarioId, vendaId, pedido(2)))
      .rejects.toThrow(ConflictException);
    expect(c.tx.estornoVenda.create).not.toHaveBeenCalled();
  });
});
