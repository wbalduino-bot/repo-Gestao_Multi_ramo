import test from 'node:test';
import assert from 'node:assert/strict';
import { indicadoresComerciais, mediaMovelSeteDias, participacaoPagamento } from '../app/caixa/metricas-caixa.ts';

const exemplo = {
  data: '2026-11-16', quantidadeVendas: 4, quantidadeEstornos: 2,
  brutoAntesDescontos: 100, descontos: 5, vendasEfetivas: 95,
  estornosDoDia: 10, faturamentoLiquido: 85,
  porFormaPagamento: { DINHEIRO: 50, PIX: 10, CARTAO_DEBITO: 15, CARTAO_CREDITO: 20, OUTRO: 0 },
  outroSemClassificacaoFinanceira: 0,
};

test('ticket medio separa desconto de estorno, nao trata recebimento como confirmado', () => {
  const i = indicadoresComerciais(exemplo, 1, 15);
  assert.equal(i.ticketMedioVendas, 23.75);
  assert.ok(Math.abs(i.taxaEstornosSobreVendas - 10/95*100) < 0.000001);
  assert.ok(Math.abs(i.participacaoCartoes - 35/95*100) < 0.000001);
  assert.equal(i.percentualAposDescontos, 95);
  assert.ok(Math.abs(i.percentualDiasFechados - 100/15) < 0.000001);
});

test('nao inventa porcentagens quando o denominador e zero', () => {
  const i = indicadoresComerciais({ ...exemplo, quantidadeVendas: 0, vendasEfetivas: 0, brutoAntesDescontos: 0,
    porFormaPagamento: { DINHEIRO: 0, PIX: 0, CARTAO_DEBITO: 0, CARTAO_CREDITO: 0, OUTRO: 0 } }, 0, 0);
  assert.equal(i.ticketMedioVendas, null);
  assert.equal(i.taxaEstornosSobreVendas, null);
  assert.equal(i.participacaoCartoes, null);
  assert.equal(i.percentualAposDescontos, null);
  assert.equal(i.percentualDiasFechados, null);
  assert.equal(participacaoPagamento(50, 0), 0);
});

test('media movel de sete dias respeita dados reais e inicio parcial', () => {
  const dias = Array.from({length: 9}, (_, i) => ({ faturamentoLiquido: i + 1 }));
  const valores = mediaMovelSeteDias(dias);
  assert.deepEqual(valores.slice(0, 3), [1, 1.5, 2]);
  assert.equal(valores[6], 4);
  assert.equal(valores[8], 6);
});

test('estorno de periodo anterior pode exceder vendas do dia sem distorcer dados', () => {
  const i = indicadoresComerciais({ ...exemplo, vendasEfetivas: 1, estornosDoDia: 8 }, 0, 1);
  assert.equal(i.taxaEstornosSobreVendas, 800);
});
