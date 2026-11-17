/** Calendário comercial explícito; não depende do fuso do servidor AWS. */
export const FUSO_CAIXA = 'America/Sao_Paulo';

export function validarDataCaixa(data: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) throw new Error('Data inválida. Use AAAA-MM-DD.');
  const dataUTC = new Date(`${data}T00:00:00.000Z`);
  if (!Number.isFinite(dataUTC.valueOf()) || dataUTC.toISOString().slice(0, 10) !== data) {
    throw new Error('Data inexistente no calendário.');
  }
  return data;
}

export function dataComercial(instantaneo: Date, fuso = FUSO_CAIXA): string {
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: fuso, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(instantaneo);
  const obter = (tipo: string) => partes.find((p) => p.type === tipo)?.value ?? '';
  return `${obter('year')}-${obter('month')}-${obter('day')}`;
}

export function somarDias(data: string, dias: number): string {
  validarDataCaixa(data);
  const instante = new Date(`${data}T00:00:00.000Z`);
  instante.setUTCDate(instante.getUTCDate() + dias);
  return instante.toISOString().slice(0, 10);
}

function diferencaFuso(instantaneo: Date, fuso: string): number {
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: fuso, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(instantaneo);
  const obter = (tipo: string) => Number(partes.find((p) => p.type === tipo)?.value ?? 0);
  const localEmUTC = Date.UTC(obter('year'), obter('month') - 1, obter('day'),
    obter('hour'), obter('minute'), obter('second'));
  return localEmUTC - Math.trunc(instantaneo.getTime() / 1000) * 1000;
}

/** Converte meia-noite local para o instante UTC, inclusive em fronteiras de mês. */
export function inicioDiaComercialUTC(data: string, fuso = FUSO_CAIXA): Date {
  validarDataCaixa(data);
  const bruto = new Date(`${data}T00:00:00.000Z`).getTime();
  let candidato = bruto - diferencaFuso(new Date(bruto + 12 * 60 * 60 * 1000), fuso);
  candidato = bruto - diferencaFuso(new Date(candidato), fuso);
  return new Date(candidato);
}

export function diasDoPeriodo(dataFinal: string, dias: 1 | 15 | 30): string[] {
  validarDataCaixa(dataFinal);
  return Array.from({ length: dias }, (_, i) => somarDias(dataFinal, i - dias + 1));
}

export type FormaCaixa = 'DINHEIRO' | 'PIX' | 'CARTAO_DEBITO' | 'CARTAO_CREDITO' | 'OUTRO';
export const FORMAS_CAIXA: FormaCaixa[] = ['DINHEIRO', 'PIX', 'CARTAO_DEBITO', 'CARTAO_CREDITO', 'OUTRO'];

export interface ResumoComercialDia {
  data: string;
  quantidadeVendas: number;
  quantidadeEstornos: number;
  brutoAntesDescontos: number;
  descontos: number;
  vendasEfetivas: number;
  estornosDoDia: number;
  faturamentoLiquido: number;
  porFormaPagamento: Record<FormaCaixa, number>;
  outroSemClassificacaoFinanceira: number;
}

export function resumoVazio(data: string): ResumoComercialDia {
  return {
    data, quantidadeVendas: 0, quantidadeEstornos: 0,
    brutoAntesDescontos: 0, descontos: 0, vendasEfetivas: 0,
    estornosDoDia: 0, faturamentoLiquido: 0,
    porFormaPagamento: {
      DINHEIRO: 0, PIX: 0, CARTAO_DEBITO: 0, CARTAO_CREDITO: 0, OUTRO: 0,
    },
    outroSemClassificacaoFinanceira: 0,
  };
}
