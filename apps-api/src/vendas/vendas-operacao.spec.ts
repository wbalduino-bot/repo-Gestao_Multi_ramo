import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { AuditoriaService } from '../auditoria/auditoria.service.js';
import { VendasService } from './vendas.service.js';
import type { LoginRateLimitService } from '../auth/login-rate-limit.service.js';
import { prepararOperacaoVenda } from './operacao-venda.js';

vi.mock('../produtos/movimentar-lotes.js', () => ({ movimentarLotes: vi.fn().mockResolvedValue(undefined) }));

describe('VendasService - reenvio da mesma operacao', () => {
  const empresaId = 'empresa-A';
  const usuarioId = 'usuario-A';
  const produtoId = '11111111-1111-4111-8111-111111111111';
  const dto = () => ({ chaveOperacao: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', formaPagamento: 'PIX' as const,
    itens: [{ produtoId, quantidade: 1.25 }] });
  const tx = { usuario: { findFirst: vi.fn() }, venda: { findFirst: vi.fn(), create: vi.fn() },
    produto: { findMany: vi.fn() }, saldoEstoque: { findMany: vi.fn(), update: vi.fn() },
    movimentacaoEstoque: { create: vi.fn() } };
  const db = { $transaction: vi.fn(), venda: { findFirst: vi.fn() }, usuario: { findFirst: vi.fn() } };
  const auditoria = { registrar: vi.fn() };
  let service: VendasService;
  const buscar = vi.fn();
  const resposta = { id: 'venda-existente', empresaId, total: 10, formaPagamento: 'PIX' as const, itens: [] };
  beforeEach(() => {
    vi.resetAllMocks();
    const op = prepararOperacaoVenda(dto())!;
    tx.usuario.findFirst.mockResolvedValue({ id: usuarioId, nome: 'Operador' });
    db.usuario.findFirst.mockResolvedValue({ id: usuarioId });
    const existente = { id: resposta.id, usuarioId, hashRequisicao: op.hash };
    tx.venda.findFirst.mockResolvedValue(existente);
    db.venda.findFirst.mockResolvedValue(existente);
    db.$transaction.mockImplementation(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx));
    auditoria.registrar.mockResolvedValue({ id: 'auditoria' });
    service = new VendasService(db as unknown as PrismaService, auditoria as unknown as AuditoriaService, {} as LoginRateLimitService);
    buscar.mockResolvedValue(resposta as unknown as Awaited<ReturnType<VendasService['buscarPorId']>>);
    vi.spyOn(service, 'buscarPorId').mockImplementation(buscar);
  });
  it('devolve a venda original sem consultar precos nem baixar estoque de novo', async () => {
    await expect(service.criar(empresaId, usuarioId, dto())).resolves.toEqual(resposta);
    expect(buscar).toHaveBeenCalledWith(empresaId, resposta.id);
    expect(tx.produto.findMany).not.toHaveBeenCalled();
    expect(tx.venda.create).not.toHaveBeenCalled();
    expect(tx.saldoEstoque.update).not.toHaveBeenCalled();
    expect(auditoria.registrar).not.toHaveBeenCalled();
  });
  it('recusa a mesma chave para quantidades diferentes', async () => {
    await expect(service.criar(empresaId, usuarioId, { ...dto(), itens: [{ produtoId, quantidade: 2 }] })).rejects.toBeInstanceOf(ConflictException);
    expect(tx.venda.create).not.toHaveBeenCalled();
  });
  it('recusa chave de outro usuario', async () => {
    tx.venda.findFirst.mockResolvedValue({ id: resposta.id, usuarioId: 'outro', hashRequisicao: prepararOperacaoVenda(dto())!.hash });
    await expect(service.criar(empresaId, usuarioId, dto())).rejects.toBeInstanceOf(ConflictException);
    expect(buscar).not.toHaveBeenCalled();
  });
  it.each(['P2002', 'P2034'])('recupera o vencedor de uma disputa %s sem repetir a venda', async code => {
    db.$transaction.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('Disputa simulada', { code, clientVersion: 'teste' }));
    await expect(service.criar(empresaId, usuarioId, dto())).resolves.toEqual(resposta);
    expect(tx.venda.create).not.toHaveBeenCalled();
    expect(tx.saldoEstoque.update).not.toHaveBeenCalled();
  });
  it('mantem conflito de estoque se nao houver operacao concluida para recuperar', async () => {
    db.$transaction.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('Disputa', { code: 'P2034', clientVersion: 'teste' }));
    db.venda.findFirst.mockResolvedValue(null);
    await expect(service.criar(empresaId, usuarioId, dto())).rejects.toBeInstanceOf(ConflictException);
    expect(buscar).not.toHaveBeenCalled();
  });
  it('nao recupera resultado para usuario desativado durante a disputa', async () => {
    db.$transaction.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('Disputa', { code: 'P2002', clientVersion: 'teste' }));
    db.usuario.findFirst.mockResolvedValue(null);
    await expect(service.criar(empresaId, usuarioId, dto())).rejects.toBeInstanceOf(ForbiddenException);
    expect(buscar).not.toHaveBeenCalled();
  });
  it('nao trata qualquer erro interno como sucesso', async () => {
    db.$transaction.mockRejectedValue(new BadRequestException('Saldo insuficiente'));
    await expect(service.criar(empresaId, usuarioId, dto())).rejects.toThrow('Saldo insuficiente');
    expect(buscar).not.toHaveBeenCalled();
  });
  it('grava chave e hash na mesma venda e na mesma transacao da baixa', async () => {
    tx.venda.findFirst.mockResolvedValue(null);
    tx.produto.findMany.mockResolvedValue([{ id: produtoId, nome: 'Tomate', sku: 'T', unidadeId: null,
      preco: new Prisma.Decimal(8), custo: new Prisma.Decimal(4) }]);
    tx.saldoEstoque.findMany.mockResolvedValue([{ id: 'saldo', produtoId, quantidadeDisponivel: new Prisma.Decimal(10) }]);
    tx.saldoEstoque.update.mockResolvedValue({});
    tx.movimentacaoEstoque.create.mockResolvedValue({ id: 'movimento', empresaId, produtoId });
    type Dados = { empresaId: string; formaPagamento: 'PIX'; total: Prisma.Decimal;
      itens: { create: Array<{ quantidade: Prisma.Decimal; precoUnitario: Prisma.Decimal; custoUnitario: Prisma.Decimal; subtotal: Prisma.Decimal }> } };
    tx.venda.create.mockImplementation(async ({ data }: { data: Dados }) => ({
      id: 'venda-nova', empresaId, formaPagamento: data.formaPagamento, total: data.total,
      criadoEm: new Date(), usuario: { id: usuarioId, nome: 'Operador' },
      itens: data.itens.create.map((i, n) => ({ ...i, id: 'item-' + n, produto: { id: produtoId, nome: 'Tomate', sku: 'T' } })),
    }));
    const venda = await service.criar(empresaId, usuarioId, dto());
    expect(venda.id).toBe('venda-nova');
    expect(venda.total).toBe(10);
    expect(tx.venda.create).toHaveBeenCalledTimes(1);
    expect(tx.venda.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      chaveOperacao: dto().chaveOperacao, hashRequisicao: prepararOperacaoVenda(dto())!.hash,
    }) }));
    expect(tx.saldoEstoque.update).toHaveBeenCalledWith(expect.objectContaining({ data: { quantidadeDisponivel: new Prisma.Decimal('8.75') } }));
    expect(auditoria.registrar).toHaveBeenCalledWith(expect.objectContaining({ acao: 'CRIAR' }), tx);
  });
});
