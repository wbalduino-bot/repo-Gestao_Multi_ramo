import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { calcularSaldoHistoricoVenda } from './saldo-historico-venda.js';

const decimal = (valor: string) => new Prisma.Decimal(valor);

const venda = () => ({
  total: decimal('14.08'),
  itens: [{
    id: 'item-abobrinha',
    quantidade: decimal('2.350'),
    subtotal: decimal('14.08'),
    custoUnitario: decimal('2.00'),
  }],
  estornos: [{
    totalEstornado: decimal('5.99'),
    itens: [{
      itemVendaId: 'item-abobrinha',
      quantidade: decimal('1.000'),
      valorEstornado: decimal('5.99'),
    }],
  }],
});

describe('saldo historico de vendas com estornos', () => {
  it('conserva valor original e mostra 14,08 - 5,99 = 8,09', () => {
    const dados = venda();
    const resultado = calcularSaldoHistoricoVenda(dados);
    expect(dados.total.toFixed(2)).toBe('14.08');
    expect(resultado.valorEstornado.toFixed(2)).toBe('5.99');
    expect(resultado.totalLiquido.toFixed(2)).toBe('8.09');
    expect(resultado.itensLiquidos[0].quantidade.toFixed(3)).toBe('1.350');
  });

  it('venda sem estorno mantem total e quantidade original', () => {
    const dados = { ...venda(), estornos: [] };
    const resultado = calcularSaldoHistoricoVenda(dados);
    expect(resultado.totalLiquido.toFixed(2)).toBe('14.08');
    expect(resultado.itensLiquidos[0].quantidade.toFixed(3)).toBe('2.350');
  });

  it('soma varios estornos parciais sem arredondamento por ponto flutuante', () => {
    const dados = venda();
    dados.estornos = [
      { totalEstornado: decimal('2.40'), itens: [{ itemVendaId: 'item-abobrinha', quantidade: decimal('0.400'), valorEstornado: decimal('2.40') }] },
      { totalEstornado: decimal('3.59'), itens: [{ itemVendaId: 'item-abobrinha', quantidade: decimal('0.600'), valorEstornado: decimal('3.59') }] },
    ];
    const resultado = calcularSaldoHistoricoVenda(dados);
    expect(resultado.totalLiquido.toFixed(2)).toBe('8.09');
    expect(resultado.itensLiquidos[0].quantidade.toFixed(3)).toBe('1.350');
  });

  it('rejeita estornos com valor maior do que a venda original', () => {
    const dados = venda();
    dados.estornos[0].totalEstornado = decimal('15.00');
    expect(() => calcularSaldoHistoricoVenda(dados)).toThrow(ConflictException);
  });

  it('rejeita devolucao maior que quantidade vendida', () => {
    const dados = venda();
    dados.estornos[0].itens[0].quantidade = decimal('3.000');
    expect(() => calcularSaldoHistoricoVenda(dados)).toThrow(ConflictException);
  });

  it('rejeita estorno de item que nao pertence a venda', () => {
    const dados = venda();
    dados.estornos[0].itens[0].itemVendaId = 'item-outra-venda';
    expect(() => calcularSaldoHistoricoVenda(dados)).toThrow(ConflictException);
  });
});
