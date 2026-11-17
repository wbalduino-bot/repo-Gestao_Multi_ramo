import { Prisma } from '@prisma/client';
import {
  dataComercial, FORMAS_CAIXA, resumoVazio,
  type FormaCaixa, type ResumoComercialDia,
} from './periodo-caixa.js';

type Valor = Prisma.Decimal | string | number;
export type VendaParaCaixa = {
  criadoEm: Date;
  subtotalOriginal: Valor;
  valorDesconto: Valor;
  total: Valor;
  formaPagamento: FormaCaixa;
};
export type EstornoParaCaixa = { criadoEm: Date; totalEstornado: Valor };

/** Usa Decimal para evitar soma monetária por ponto flutuante. */
export function calcularDiasComerciais(
  datas: string[], vendas: VendaParaCaixa[], estornos: EstornoParaCaixa[],
): ResumoComercialDia[] {
  const agrupados = new Map(datas.map((data) => {
    const dia = {
    data, quantidadeVendas: 0, quantidadeEstornos: 0,
    brutoAntesDescontos: new Prisma.Decimal(0),
    descontos: new Prisma.Decimal(0),
    vendasEfetivas: new Prisma.Decimal(0),
    estornosDoDia: new Prisma.Decimal(0),
    porFormaPagamento: Object.fromEntries(
      FORMAS_CAIXA.map((forma) => [forma, new Prisma.Decimal(0)]),
    ) as Record<FormaCaixa, Prisma.Decimal>,
    };
    return [data, dia] as const;
  }));

  for (const venda of vendas) {
    const dia = agrupados.get(dataComercial(venda.criadoEm));
    if (!dia) continue;
    dia.quantidadeVendas += 1;
    dia.brutoAntesDescontos = dia.brutoAntesDescontos.plus(venda.subtotalOriginal);
    dia.descontos = dia.descontos.plus(venda.valorDesconto);
    dia.vendasEfetivas = dia.vendasEfetivas.plus(venda.total);
    dia.porFormaPagamento[venda.formaPagamento] =
      dia.porFormaPagamento[venda.formaPagamento].plus(venda.total);
  }
  for (const estorno of estornos) {
    const dia = agrupados.get(dataComercial(estorno.criadoEm));
    if (!dia) continue;
    dia.quantidadeEstornos += 1;
    dia.estornosDoDia = dia.estornosDoDia.plus(estorno.totalEstornado);
  }

  return datas.map((data) => {
    const d = agrupados.get(data);
    if (!d) return resumoVazio(data);
    const porFormaPagamento = Object.fromEntries(FORMAS_CAIXA.map((forma) => [
      forma, Number(d.porFormaPagamento[forma].toDecimalPlaces(2)),
    ])) as Record<FormaCaixa, number>;
    return {
      data, quantidadeVendas: d.quantidadeVendas,
      quantidadeEstornos: d.quantidadeEstornos,
      brutoAntesDescontos: Number(d.brutoAntesDescontos.toDecimalPlaces(2)),
      descontos: Number(d.descontos.toDecimalPlaces(2)),
      vendasEfetivas: Number(d.vendasEfetivas.toDecimalPlaces(2)),
      estornosDoDia: Number(d.estornosDoDia.toDecimalPlaces(2)),
      faturamentoLiquido: Number(d.vendasEfetivas.minus(d.estornosDoDia).toDecimalPlaces(2)),
      porFormaPagamento,
      outroSemClassificacaoFinanceira: porFormaPagamento.OUTRO,
    };
  });
}

/** Agrega dias sem arredondar cada operação novamente. */
export function consolidarDias(dias: ResumoComercialDia[]): ResumoComercialDia {
  const ponto = dias.at(-1)?.data ?? '';
  const final = resumoVazio(ponto);
  const chaves = [
    'brutoAntesDescontos', 'descontos', 'vendasEfetivas',
    'estornosDoDia', 'faturamentoLiquido', 'outroSemClassificacaoFinanceira',
  ] as const;
  for (const dia of dias) {
    final.quantidadeVendas += dia.quantidadeVendas;
    final.quantidadeEstornos += dia.quantidadeEstornos;
    for (const chave of chaves) {
      final[chave] = Number(new Prisma.Decimal(final[chave]).plus(dia[chave]).toDecimalPlaces(2));
    }
    for (const forma of FORMAS_CAIXA) {
      final.porFormaPagamento[forma] = Number(new Prisma.Decimal(final.porFormaPagamento[forma])
        .plus(dia.porFormaPagamento[forma]).toDecimalPlaces(2));
    }
  }
  return final;
}
