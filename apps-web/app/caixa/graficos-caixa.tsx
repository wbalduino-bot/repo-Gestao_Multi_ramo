"use client";

import type { DiaCaixa } from "./metricas-caixa";
import { mediaMovelSeteDias, participacaoPagamento } from "./metricas-caixa";
import styles from "./caixa.module.css";

const reais = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const reaisCompactos = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const percentual = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1, minimumFractionDigits: 1 });
const PAGAMENTOS = [
  { chave: "CARTAO_CREDITO", nome: "Cartão de crédito", cor: "#2463bd" },
  { chave: "CARTAO_DEBITO", nome: "Cartão de débito", cor: "#19a66a" },
  { chave: "DINHEIRO", nome: "Dinheiro", cor: "#ee9a2b" },
  { chave: "PIX", nome: "PIX", cor: "#8963df" },
  { chave: "OUTRO", nome: "Outro / não classificado", cor: "#94a3b8" },
] as const;

function dataCurta(data: string) {
  const [, mes, dia] = data.split("-");
  return `${dia}/${mes}`;
}

export function GraficoEvolucao({ dias }: { dias: DiaCaixa[] }) {
  const largura = 930;
  const altura = 285;
  const borda = { esquerda: 71, direita: 16, topo: 19, baixo: 40 };
  const larguraUtil = largura - borda.esquerda - borda.direita;
  const alturaUtil = altura - borda.topo - borda.baixo;
  const medias = mediaMovelSeteDias(dias);
  const extremos = dias.flatMap((dia, i) => [dia.vendasEfetivas, dia.faturamentoLiquido, -dia.estornosDoDia, medias[i]]);
  const maximo = Math.max(1, ...extremos, 0);
  const minimo = Math.min(0, ...extremos);
  const amplitude = maximo - minimo;
  const y = (valor: number) => borda.topo + (maximo - valor) / amplitude * alturaUtil;
  const zero = y(0);
  const passo = larguraUtil / Math.max(1, dias.length);
  const barra = Math.min(13, Math.max(3, passo * 0.22));
  const x = (i: number) => borda.esquerda + (i + 0.5) * passo;
  const mostrarCada = dias.length > 20 ? 4 : dias.length > 7 ? 2 : 1;
  const linha = medias.map((media, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(media).toFixed(1)}`).join(" ");
  const dados = dias.length > 0;
  const linhasGrade = Array.from({ length: 5 }, (_, i) => maximo - i * amplitude / 4);

  return (
    <div className={styles.graficoComLegenda}>
      <div className={styles.legendaGrafico}>
        <span><i style={{background: "#2868c5"}} /> Vendas após descontos</span>
        <span><i style={{background: "#ee9336"}} /> Estornos</span>
        <span><i style={{background: "#21a974"}} /> Líquido</span>
        <span><i style={{background: "#8560d7"}} /> Média móvel de 7 dias</span>
      </div>
      <div className={styles.graficoSvgWrap}>
        <svg viewBox={`0 0 ${largura} ${altura}`} role="img" aria-label="Evolução comercial diária: vendas após descontos, estornos, líquido e tendência" className={styles.svgGrafico}>
          <title>Evolução comercial por dia</title>
          <desc>Valores por data comercial em Brasília. Estornos podem se referir a vendas de dias anteriores. A curva roxa é a média móvel de sete dias.</desc>
          {linhasGrade.map((valor, indice) => (
            <g key={indice}>
              <line x1={borda.esquerda} x2={largura-borda.direita} y1={y(valor)} y2={y(valor)} stroke="#e4ebf3" strokeWidth="1" />
              <text x={borda.esquerda-10} y={y(valor)+4} textAnchor="end" className={styles.eixoGrafico}>{maximo < 5 ? reais.format(valor) : reaisCompactos.format(valor)}</text>
            </g>
          ))}
          <line x1={borda.esquerda} x2={largura-borda.direita} y1={zero} y2={zero} stroke="#b0c0d2" strokeWidth="1.5" />
          {dias.map((dia, i) => {
            const centro = x(i);
            const vendaY = y(dia.vendasEfetivas);
            const liquidY = y(dia.faturamentoLiquido);
            const estornoY = y(-dia.estornosDoDia);
            return (
              <g key={dia.data}>
                {dia.vendasEfetivas > 0 && <rect x={centro-barra*1.65} y={Math.min(zero, vendaY)} width={barra} height={Math.max(0.8, Math.abs(zero-vendaY))} rx="2" fill="#2868c5" />}
                {dia.estornosDoDia > 0 && <rect x={centro-barra*.5} y={Math.min(zero, estornoY)} width={barra} height={Math.max(1.5, Math.abs(zero-estornoY))} rx="2" fill="#ee9336" />}
                {dia.faturamentoLiquido !== 0 && <rect x={centro+barra*.65} y={Math.min(zero, liquidY)} width={barra} height={Math.max(0.8, Math.abs(zero-liquidY))} rx="2" fill="#21a974" />}
                {i % mostrarCada === 0 || i === dias.length-1 ? <text x={centro} y={altura-13} textAnchor="middle" className={styles.eixoGrafico}>{dataCurta(dia.data)}</text> : null}
                <rect x={centro-passo/2} y={borda.topo} width={passo} height={alturaUtil} fill="transparent">
                  <title>{`${dia.data}\nVendas após descontos: ${reais.format(dia.vendasEfetivas)}\nEstornos: ${reais.format(dia.estornosDoDia)}\nLíquido comercial: ${reais.format(dia.faturamentoLiquido)}`}</title>
                </rect>
              </g>
            );
          })}
          {dados && <path d={linha} stroke="#8560d7" strokeWidth="2.7" fill="none" strokeLinejoin="round" strokeLinecap="round" />}
          {dados && dias.length <= 15 && medias.map((valor, i) => <circle key={dias[i].data} cx={x(i)} cy={y(valor)} r="3.2" fill="#8560d7" />)}
        </svg>
      </div>
      <p className={styles.legendaNota}>Vendas por data da operação. Dias sem movimento permanecem no gráfico; valores negativos podem resultar de estornos de vendas anteriores.</p>
    </div>
  );
}

export function GraficoPagamentos({ valores }: { valores: Record<string, number> }) {
  const segmentos = PAGAMENTOS.map((p) => ({...p, valor: Math.max(0, valores[p.chave] ?? 0)}));
  const total = segmentos.reduce((s, p) => s + p.valor, 0);
  const raio = 57;
  const circunferencia = 2 * Math.PI * raio;
  let anterior = 0;
  return (
    <div className={styles.pagamentoContainer}>
      <div className={styles.roscaColuna}>
        <svg viewBox="0 0 160 160" role="img" aria-label="Participação das modalidades declaradas nas vendas antes de estornos" className={styles.roscaGrafico}>
          <title>Distribuição das vendas por forma de pagamento declarada</title>
          <circle cx="80" cy="80" r={raio} fill="none" stroke="#edf2f8" strokeWidth="19" />
          {segmentos.filter((p) => p.valor > 0).map((p) => {
            const parcela = total > 0 ? p.valor / total : 0;
            const comprimento = parcela * circunferencia;
            const deslocamento = -anterior * circunferencia;
            anterior += parcela;
            return <circle key={p.chave} cx="80" cy="80" r={raio} fill="none" stroke={p.cor} strokeWidth="19" strokeDasharray={`${comprimento} ${circunferencia-comprimento}`} strokeDashoffset={deslocamento} transform="rotate(-90 80 80)">
              <title>{`${p.nome}: ${reais.format(p.valor)} (${percentual.format(participacaoPagamento(p.valor,total))}%)`}</title>
            </circle>;
          })}
          <text x="80" y="76" textAnchor="middle" className={styles.roscaValor}>{reaisCompactos.format(total)}</text>
          <text x="80" y="93" textAnchor="middle" className={styles.roscaRotulo}>Vendas declaradas</text>
        </svg>
      </div>
      <div className={styles.legendaPagamento}>
        {segmentos.map((p) => <div key={p.chave} className={styles.itemPagamento}>
          <div className={styles.pagamentoNome}><i style={{background:p.cor}} /> <span>{p.nome}</span></div>
          <strong>{reais.format(p.valor)}</strong>
          <span className={styles.pctPagamento}>{percentual.format(participacaoPagamento(p.valor, total))}%</span>
        </div>)}
      </div>
    </div>
  );
}

export function Medidor({ rotulo, valor, descricao, cor }: { rotulo: string; valor: number | null; descricao: string; cor: string }) {
  const base = Math.PI * 54;
  const fatia = valor === null ? 0 : Math.max(0, Math.min(1, valor / 100));
  return (
    <div className={styles.medidorCard}>
      <h3>{rotulo}</h3>
      <svg viewBox="0 0 146 93" role="img" aria-label={`${rotulo}: ${valor === null ? 'sem dados' : percentual.format(valor) + '%'}`} className={styles.medidorSvg}>
        <path d="M 19 78 A 54 54 0 0 1 127 78" fill="none" stroke="#e8edf5" strokeWidth="15" strokeLinecap="round" />
        {valor !== null && fatia > 0 && <path d="M 19 78 A 54 54 0 0 1 127 78" fill="none" stroke={cor} strokeWidth="15" strokeLinecap="round" strokeDasharray={`${base*fatia} ${base}`} />}
        <text x="73" y="72" textAnchor="middle" className={styles.medidorValor}>{valor === null ? "—" : `${percentual.format(valor)}%`}</text>
      </svg>
      <p>{descricao}</p>
    </div>
  );
}

export function MiniTendencia({ valores, cor }: { valores: number[]; cor: string }) {
  const maior = Math.max(1, ...valores);
  const menor = Math.min(0, ...valores);
  const alcance = maior - menor;
  const caminho = valores.map((valor, i) => `${i===0?'M':'L'}${4 + (i/Math.max(1,valores.length-1))*102},${35 - (valor-menor)/alcance*28}`).join(' ');
  return <svg viewBox="0 0 112 42" aria-hidden="true" className={styles.miniTendencia}>
    {valores.length > 0 && <path d={caminho} fill="none" stroke={cor} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"/>}
  </svg>;
}
