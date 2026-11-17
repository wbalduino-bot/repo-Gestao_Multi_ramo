/** Cálculos de apresentação baseados exclusivamente no relatório comercial da API.
 * Estes valores NÃO são conciliação financeira, lucro ou margem contábil.
 */
export type ResumoCaixa = {
  data: string;
  quantidadeVendas: number;
  quantidadeEstornos: number;
  brutoAntesDescontos: number;
  descontos: number;
  vendasEfetivas: number;
  estornosDoDia: number;
  faturamentoLiquido: number;
  porFormaPagamento: Record<string, number>;
  outroSemClassificacaoFinanceira: number;
};

export type DiaCaixa = ResumoCaixa & {
  situacao: "ABERTO" | "FECHADO";
  fechamento: null | { id: string; criadoEm: string; responsavel: string };
  divergenciaAposFechamento: boolean;
};

export type RelatorioCaixa = {
  periodoDias: number;
  inicio: string;
  fim: string;
  fusoHorario: string;
  natureza: string;
  avisoFinanceiro: string;
  dias: DiaCaixa[];
  consolidado: ResumoCaixa;
  quantidadeDiasFechados: number;
  quantidadeDiasComDivergencia: number;
};

export type IndicadoresComerciais = {
  ticketMedioVendas: number | null;
  taxaEstornosSobreVendas: number | null;
  participacaoCartoes: number | null;
  percentualAposDescontos: number | null;
  percentualDiasFechados: number | null;
  totalModalidadesDeclaradas: number;
};

function numeroSeguro(valor: unknown): number {
  return typeof valor === "number" && Number.isFinite(valor) ? valor : 0;
}
function razao(numerador: number, denominador: number): number | null {
  return denominador > 0 ? (numerador / denominador) * 100 : null;
}

/**
 * Ticket médio usa vendas após DESCONTO, mas antes de ESTORNOS de outras datas.
 * Taxa de estornos é operacional e pode incluir devoluções de vendas antigas.
 */
export function indicadoresComerciais(resumo: ResumoCaixa, diasFechados: number, periodoDias: number): IndicadoresComerciais {
  const modalidades = resumo.porFormaPagamento ?? {};
  const totalModalidadesDeclaradas = Object.values(modalidades).reduce((total, valor) => total + numeroSeguro(valor), 0);
  const cartoes = numeroSeguro(modalidades.CARTAO_DEBITO) + numeroSeguro(modalidades.CARTAO_CREDITO);
  return {
    ticketMedioVendas: resumo.quantidadeVendas > 0 ? resumo.vendasEfetivas / resumo.quantidadeVendas : null,
    taxaEstornosSobreVendas: razao(resumo.estornosDoDia, resumo.vendasEfetivas),
    participacaoCartoes: razao(cartoes, totalModalidadesDeclaradas),
    percentualAposDescontos: razao(resumo.vendasEfetivas, resumo.brutoAntesDescontos),
    percentualDiasFechados: razao(diasFechados, periodoDias),
    totalModalidadesDeclaradas,
  };
}

export function participacaoPagamento(valor: number, totalDeclarado: number): number {
  return totalDeclarado > 0 ? Math.max(0, numeroSeguro(valor) / totalDeclarado * 100) : 0;
}

/** Média móvel dos últimos 7 dias com janela parcial nos primeiros pontos. */
export function mediaMovelSeteDias(dias: Pick<ResumoCaixa, "faturamentoLiquido">[]): number[] {
  return dias.map((_, indice) => {
    const janela = dias.slice(Math.max(0, indice - 6), indice + 1);
    return janela.reduce((total, dia) => total + numeroSeguro(dia.faturamentoLiquido), 0) / janela.length;
  });
}
