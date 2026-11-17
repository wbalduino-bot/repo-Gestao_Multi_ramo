import { describe, expect, it } from 'vitest';
import { calcularDiasComerciais, consolidarDias } from './calculo-caixa.js';
import { diasDoPeriodo } from './periodo-caixa.js';

describe('consolidacao comercial do caixa', () => {
  it('separa desconto, venda e estorno pela data efetiva da operacao', () => {
    const dias = diasDoPeriodo('2026-11-17', 15);
    const calculado = calcularDiasComerciais(dias, [{
      criadoEm: new Date('2026-11-16T22:00:00Z'),
      subtotalOriginal: '14.08', valorDesconto: '0.00',
      total: '14.08', formaPagamento: 'PIX',
    }], [{ criadoEm: new Date('2026-11-17T10:00:00Z'), totalEstornado: '5.99' }]);
    const diaVenda = calculado.find((d) => d.data === '2026-11-16')!;
    const diaEstorno = calculado.find((d) => d.data === '2026-11-17')!;
    expect(diaVenda.faturamentoLiquido).toBe(14.08);
    expect(diaEstorno.faturamentoLiquido).toBe(-5.99);
    expect(consolidarDias(calculado).faturamentoLiquido).toBe(8.09);
  });
  it('classifica OUTRO sem presumir quitacao', () => {
    const dias = calcularDiasComerciais(['2026-11-16'], [{
      criadoEm: new Date('2026-11-16T13:00:00Z'),
      subtotalOriginal: '100.00', valorDesconto: '5.00',
      total: '95.00', formaPagamento: 'OUTRO',
    }], []);
    expect(dias[0].descontos).toBe(5);
    expect(dias[0].vendasEfetivas).toBe(95);
    expect(dias[0].outroSemClassificacaoFinanceira).toBe(95);
  });
  it('mantem dias sem vendas e soma valores decimais sem drift', () => {
    const resumo = calcularDiasComerciais(['2026-11-15', '2026-11-16'], [
      { criadoEm: new Date('2026-11-16T13:00:00Z'), subtotalOriginal: '0.10', valorDesconto: '0.00', total: '0.10', formaPagamento: 'PIX' },
      { criadoEm: new Date('2026-11-16T13:01:00Z'), subtotalOriginal: '0.20', valorDesconto: '0.00', total: '0.20', formaPagamento: 'PIX' },
    ], []);
    expect(resumo[0].quantidadeVendas).toBe(0);
    expect(resumo[1].faturamentoLiquido).toBe(0.3);
  });
});
