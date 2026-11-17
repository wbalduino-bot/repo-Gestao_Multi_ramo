import { describe, expect, it, vi } from 'vitest';
import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service.js';
import { prepararOperacaoVenda, consultarVendaDaOperacao } from './operacao-venda.js';

const chave = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const produtoA = '11111111-1111-4111-8111-111111111111';
const produtoB = '22222222-2222-4222-8222-222222222222';
const dados = () => ({ chaveOperacao: chave, formaPagamento: 'PIX',
  itens: [{ produtoId: produtoA, quantidade: 1.25 }, { produtoId: produtoB, quantidade: 2 }] });

describe('Identificacao idempotente de vendas', () => {
  it('preserva compatibilidade com requisicoes antigas sem chave', () => {
    expect(prepararOperacaoVenda({ formaPagamento: 'PIX', itens: [] })).toBeUndefined();
  });
  it('gera o mesmo hash para os mesmos itens em outra ordem', () => {
    const d = dados();
    expect(prepararOperacaoVenda(d)).toEqual(prepararOperacaoVenda({ ...d, itens: [...d.itens].reverse() }));
  });
  it('normaliza UUIDs sem alterar o significado da operacao', () => {
    expect(prepararOperacaoVenda(dados())).toEqual(prepararOperacaoVenda({ ...dados(), chaveOperacao: chave.toUpperCase() }));
  });
  it('distingue alteracoes de quantidade, pagamento e valor recebido', () => {
    const original = prepararOperacaoVenda(dados())!.hash;
    expect(prepararOperacaoVenda({ ...dados(), itens: [{ produtoId: produtoA, quantidade: 1.251 }] })!.hash).not.toBe(original);
    expect(prepararOperacaoVenda({ ...dados(), formaPagamento: 'CARTAO_DEBITO' })!.hash).not.toBe(original);
    const dinheiro = { ...dados(), formaPagamento: 'DINHEIRO', valorRecebido: 100 };
    expect(prepararOperacaoVenda(dinheiro)!.hash).not.toBe(prepararOperacaoVenda({ ...dinheiro, valorRecebido: 101 })!.hash);
  });
  it('permite desconto autorizado pela propria sessao gerencial, sem email', () => {
    const gerente = prepararOperacaoVenda({ ...dados(), percentualDesconto: 5 })!;
    const gerenteOutraSenha = prepararOperacaoVenda({ ...dados(), percentualDesconto: 5,
      senhaAutorizador: 'nao-usa' } as Parameters<typeof prepararOperacaoVenda>[0])!;
    const autorizadoPorAdmin = prepararOperacaoVenda({ ...dados(), percentualDesconto: 5,
      autorizadorEmail: 'admin@empresa.com' })!;
    expect(gerente.hash).toBe(gerenteOutraSenha.hash);
    expect(gerente.hash).not.toBe(autorizadoPorAdmin.hash);
    expect(gerente.hash).not.toBe(prepararOperacaoVenda(dados())!.hash);
  });
  it('inclui desconto e autorizador no hash, nunca a senha', () => {
    const sem = prepararOperacaoVenda(dados())!.hash;
    const com = prepararOperacaoVenda({ ...dados(), percentualDesconto: 5,
      autorizadorEmail: 'Admin@Empresa.com' })!.hash;
    const comOutraSenha = prepararOperacaoVenda({ ...dados(), percentualDesconto: 5,
      autorizadorEmail: 'admin@empresa.com', senhaAutorizador: 'outra-senha' } as Parameters<typeof prepararOperacaoVenda>[0])!.hash;
    expect(com).not.toBe(sem);
    expect(comOutraSenha).toBe(com);
    expect(prepararOperacaoVenda({ ...dados(), percentualDesconto: 3,
      autorizadorEmail: 'admin@empresa.com' })!.hash).not.toBe(com);
  });
  it.each([5.01, -1, 0.001])('recusa desconto fora das regras %s', percentualDesconto => {
    expect(() => prepararOperacaoVenda({ ...dados(), percentualDesconto,
      autorizadorEmail: 'admin@empresa.com' })).toThrow(BadRequestException);
  });
  it('recusa chave invalida e produtos repetidos', () => {
    expect(() => prepararOperacaoVenda({ ...dados(), chaveOperacao: 'invalida' })).toThrow(BadRequestException);
    expect(() => prepararOperacaoVenda({ ...dados(), itens: [dados().itens[0], dados().itens[0]] })).toThrow(BadRequestException);
  });
  it.each([0, -1, Infinity, NaN, 0.0001, 1.2345])('recusa quantidade invalida %s', quantidade => {
    expect(() => prepararOperacaoVenda({ ...dados(), itens: [{ produtoId: produtoA, quantidade }] })).toThrow(BadRequestException);
  });
  it('recusa valor recebido no PIX ou com mais de duas casas', () => {
    expect(() => prepararOperacaoVenda({ ...dados(), valorRecebido: 100 })).toThrow(BadRequestException);
    expect(() => prepararOperacaoVenda({ ...dados(), formaPagamento: 'DINHEIRO', valorRecebido: 100.001 })).toThrow(BadRequestException);
  });
  it('consulta por empresa e devolve o id da venda ja registrada', async () => {
    const op = prepararOperacaoVenda(dados())!;
    const findFirst = vi.fn().mockResolvedValue({ id: 'venda-existente', usuarioId: 'usuario-A', hashRequisicao: op.hash });
    const prisma = { venda: { findFirst }, usuario: { findFirst: vi.fn() } } as unknown as Pick<PrismaService, 'venda' | 'usuario'>;
    await expect(consultarVendaDaOperacao(prisma, 'empresa-A', 'usuario-A', op)).resolves.toBe('venda-existente');
    expect(findFirst).toHaveBeenCalledWith({ where: { empresaId: 'empresa-A', chaveOperacao: chave }, select: { id: true, usuarioId: true, hashRequisicao: true } });
  });
  it('nao aceita reaproveitamento por outro usuario ou para outro corpo', async () => {
    const op = prepararOperacaoVenda(dados())!;
    const findFirst = vi.fn().mockResolvedValue({ id: 'venda', usuarioId: 'outro', hashRequisicao: op.hash });
    const prisma = { venda: { findFirst }, usuario: { findFirst: vi.fn() } } as unknown as Pick<PrismaService, 'venda' | 'usuario'>;
    await expect(consultarVendaDaOperacao(prisma, 'empresa', 'usuario', op)).rejects.toBeInstanceOf(ConflictException);
    findFirst.mockResolvedValue({ id: 'venda', usuarioId: 'usuario', hashRequisicao: 'outro-corpo' });
    await expect(consultarVendaDaOperacao(prisma, 'empresa', 'usuario', op)).rejects.toBeInstanceOf(ConflictException);
  });
  it('revalida o usuario ao recuperar uma disputa concorrente', async () => {
    const venda = vi.fn();
    const usuario = vi.fn().mockResolvedValue(null);
    const prisma = { venda: { findFirst: venda }, usuario: { findFirst: usuario } } as unknown as Pick<PrismaService, 'venda' | 'usuario'>;
    await expect(consultarVendaDaOperacao(prisma, 'empresa', 'usuario', prepararOperacaoVenda(dados())!, true)).rejects.toBeInstanceOf(ForbiddenException);
    expect(venda).not.toHaveBeenCalled();
  });
  it('retorna ausencia para uma operacao ainda nao concluida', async () => {
    const prisma = { venda: { findFirst: vi.fn().mockResolvedValue(null) }, usuario: { findFirst: vi.fn() } } as unknown as Pick<PrismaService, 'venda' | 'usuario'>;
    await expect(consultarVendaDaOperacao(prisma, 'empresa', 'usuario', prepararOperacaoVenda(dados())!)).resolves.toBeNull();
  });
});
