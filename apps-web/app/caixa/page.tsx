"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import { ProtecaoSessao } from "../componentes/protecao-sessao";
import { MenuLateral } from "../componentes/menu-lateral";
import styles from "./caixa.module.css";
import { indicadoresComerciais } from "./metricas-caixa";
import { GraficoEvolucao, GraficoPagamentos, Medidor, MiniTendencia } from "./graficos-caixa";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";
const moeda = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

type Resumo = {
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
type DiaCaixa = Resumo & {
  situacao: "ABERTO" | "FECHADO";
  fechamento: null | { id: string; criadoEm: string; responsavel: string };
  divergenciaAposFechamento: boolean;
};
type RelatorioCaixa = {
  periodoDias: number; inicio: string; fim: string; fusoHorario: string;
  natureza: string; avisoFinanceiro: string;
  dias: DiaCaixa[]; consolidado: Resumo;
  quantidadeDiasFechados: number;
  quantidadeDiasComDivergencia: number;
};

type ProdutoRanking = {
  produtoId: string;
  nome: string;
  unidade: string;
  quantidadeVendida: number;
  valorBrutoItens: number;
};
type RankingProdutos = {
  inicio: string;
  fim: string;
  natureza: "PRODUTOS_BRUTOS_SEM_DESCONTO_OU_ESTORNO";
  topFaturamento: ProdutoRanking[];
  quantidadePorUnidade: Array<{ unidade: string; itens: ProdutoRanking[] }>;
};
const quantidade = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 3 });
const porcentagem = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

function percentualBarra(valor: number, maximo: number) {
  return `${maximo > 0 ? Math.max(0, Math.min(100, valor / maximo * 100)) : 0}%`;
}
function dataCurta(data: string) {
  const [, mes, dia] = data.split("-");
  return `${dia}/${mes}`;
}

function hojeComercial() {
  const partes = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const parte = (tipo: string) => partes.find((p) => p.type === tipo)?.value ?? "";
  return `${parte("year")}-${parte("month")}-${parte("day")}`;
}
function mensagemErro(valor: unknown): string {
  if (valor && typeof valor === "object" && "message" in valor) {
    const texto = (valor as { message?: unknown }).message;
    if (typeof texto === "string") return texto;
    if (Array.isArray(texto)) return texto.join(", ");
  }
  return "Não foi possível concluir a operação. Confira a API e sua sessão.";
}

export default function CaixaPage() {
  const router = useRouter();
  const [nomeEmpresa, setNomeEmpresa] = useState("Empresa autenticada");
  const [permitido, setPermitido] = useState<boolean | null>(null);
  const [dias, setDias] = useState<1 | 15 | 30>(1);
  const [dataFinal, setDataFinal] = useState("");
  const [dataMaxima, setDataMaxima] = useState("");
  const [relatorio, setRelatorio] = useState<RelatorioCaixa | null>(null);
  const [ranking, setRanking] = useState<RankingProdutos | null>(null);
  const [erroRanking, setErroRanking] = useState("");
  const [carregando, setCarregando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState("");
  const [sucesso, setSucesso] = useState("");
  const [observacao, setObservacao] = useState("");
  const [recarregar, setRecarregar] = useState(0);
  const [unidadeEscolhida, setUnidadeEscolhida] = useState("");

  useEffect(() => {
    const hoje = hojeComercial();
    setDataFinal(hoje);
    setDataMaxima(hoje);
    try {
      const usuario = JSON.parse(sessionStorage.getItem("gestao.usuario") ?? "{}");
      const perfil = usuario.perfil;
      setPermitido(perfil === "ADMINISTRADOR" || perfil === "GERENTE");
      if (typeof usuario.empresaNome === "string" && usuario.empresaNome.trim()) {
        setNomeEmpresa(usuario.empresaNome);
      }
    } catch {
      setPermitido(false);
    }
  }, []);

  const buscar = useCallback(async (signal?: AbortSignal) => {
    const token = sessionStorage.getItem("gestao.accessToken");
    if (!token) { router.replace("/"); return; }
    const params = new URLSearchParams({ dias: String(dias), dataFinal });
    const resposta = await fetch(`${API_URL}/caixa/relatorio?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store", signal,
    });
    const json = await resposta.json().catch(() => null);
    if (resposta.status === 401) { router.replace("/"); return; }
    if (!resposta.ok) throw new Error(mensagemErro(json));
    setRelatorio(json as RelatorioCaixa);
    setRanking(null);
    setErroRanking("");
    try {
      const respostaRanking = await fetch(`${API_URL}/caixa/ranking-produtos?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store", signal,
      });
      const dadosRanking = await respostaRanking.json().catch(() => null);
      if (respostaRanking.status === 401) { router.replace("/"); return; }
      if (!respostaRanking.ok) throw new Error(mensagemErro(dadosRanking));
      setRanking(dadosRanking as RankingProdutos);
    } catch (erro) {
      if (!signal?.aborted) {
        setErroRanking(erro instanceof Error ? erro.message : "Falha no ranking de produtos.");
      }
    }
  }, [dias, dataFinal, router]);

  useEffect(() => {
    if (!permitido || !dataFinal) return;
    const controle = new AbortController();
    let ativo = true;
    const carregar = async () => {
      setCarregando(true); setErro("");
      try { await buscar(controle.signal); }
      catch (e) {
        if (ativo && !controle.signal.aborted) setErro(e instanceof Error ? e.message : "Falha na consulta.");
      } finally { if (ativo) setCarregando(false); }
    };
    void carregar();
    return () => { ativo = false; controle.abort(); };
  }, [permitido, buscar, recarregar]);

  const fecharDia = async () => {
    if (dias !== 1 || relatorio?.dias[0]?.situacao === "FECHADO") return;
    if (!window.confirm(
      `Registrar o fechamento COMERCIAL de ${dataFinal}? ` +
      "Isso salva uma fotografia auditável, NÃO comprova liquidação ou reembolsos.",
    )) return;
    const token = sessionStorage.getItem("gestao.accessToken");
    if (!token) { router.replace("/"); return; }
    setEnviando(true); setErro(""); setSucesso("");
    try {
      const resposta = await fetch(`${API_URL}/caixa/fechamentos`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ data: dataFinal, observacao: observacao.trim() || undefined }),
      });
      const json = await resposta.json().catch(() => null);
      if (!resposta.ok) throw new Error(mensagemErro(json));
      setSucesso("Fechamento comercial registrado com auditoria. A conciliação financeira permanece pendente.");
      setRecarregar((n) => n + 1);
    } catch (e) { setErro(e instanceof Error ? e.message : "Falha ao fechar o dia."); }
    finally { setEnviando(false); }
  };

  const consolidado = relatorio?.consolidado;
  const indicadores = relatorio ? indicadoresComerciais(
    relatorio.consolidado,
    relatorio.quantidadeDiasFechados,
    relatorio.periodoDias,
  ) : null;
  const resumoUltimoDia = relatorio?.dias.at(-1) ?? null;
  const gruposUnidade = ranking?.quantidadePorUnidade ?? [];
  const grupoAtivo = gruposUnidade.find((grupo) => grupo.unidade === unidadeEscolhida) ?? gruposUnidade[0];
  const serie = relatorio?.dias ?? [];
  const valorPct = (valor: number | null) => valor === null ? "Sem dados" : `${porcentagem.format(valor)}%`;

  return (
    <ProtecaoSessao>
      <div className={styles.pagina}>
        <MenuLateral nomeEmpresa={nomeEmpresa} />
        <main className={styles.conteudo}>
          <header className={styles.cabecalho}>
            <div className={styles.tituloComIcone}>
              <span className={styles.iconeCabecalho} aria-hidden="true">▥</span>
              <div>
                <p className={styles.sobretitulo}>GESTÃO COMERCIAL / PAINEL GERENCIAL</p>
                <h1>Fechamento de caixa</h1>
                <p>Apuração comercial diária e consolidados dos últimos 15 e 30 dias.</p>
              </div>
            </div>
            <Link href="/vendas" className={styles.link}>← Voltar às vendas</Link>
          </header>

          {permitido === false ? (
            <section className={styles.alerta} role="alert">Acesso reservado a ADMINISTRADOR e GERENTE.</section>
          ) : permitido === null ? (
            <p>Verificando sessão...</p>
          ) : (
            <>
              <section className={styles.aviso} role="note">
                <span className={styles.avisoIcone} aria-hidden="true">!</span>
                <div>
                  <strong>Apuração comercial — não conciliada financeiramente</strong>
                  <p>As formas de pagamento são as declaradas na venda. Não há confirmação independente de quitação, reembolso, sangria ou suprimento. Estes valores não representam saldo físico ou bancário.</p>
                </div>
              </section>
              <section className={`${styles.painel} ${styles.painelFiltros}`} aria-label="Filtros do relatório">
                <div className={styles.controles}>
                  <label>Período
                    <select value={dias} onChange={(e: ChangeEvent<HTMLSelectElement>) => setDias(Number(e.target.value) as 1 | 15 | 30)} disabled={enviando}>
                      <option value={1}>Diário</option>
                      <option value={15}>Últimos 15 dias</option>
                      <option value={30}>Últimos 30 dias</option>
                    </select>
                  </label>
                  <label>Data final (horário de Brasília)
                    <input type="date" value={dataFinal} max={dataMaxima} onChange={(e: ChangeEvent<HTMLInputElement>) => setDataFinal(e.target.value)} disabled={enviando} />
                  </label>
                  <button type="button" className={styles.botaoPrimario} disabled={carregando || enviando} onClick={() => setRecarregar((n) => n + 1)}>↻ Atualizar</button>
                </div>
                {relatorio && <span className={styles.resumoPeriodo}>{dataCurta(relatorio.inicio)} a {dataCurta(relatorio.fim)} · {relatorio.quantidadeDiasFechados}/{relatorio.periodoDias} dias fechados</span>}
              </section>

              {erro && <div className={styles.erro} role="alert">{erro}</div>}
              {sucesso && <div className={styles.sucesso} role="status">{sucesso}</div>}
              {carregando && <p role="status" className={styles.carregando}>Atualizando indicadores com os dados do sistema...</p>}
              {relatorio && consolidado && indicadores && (
                <>
                  {relatorio.quantidadeDiasComDivergencia > 0 && (
                    <div className={styles.erro} role="alert">Atenção: {relatorio.quantidadeDiasComDivergencia} dia(s) tiveram novas movimentações após o fechamento. Os registros anteriores permanecem preservados e precisam de revisão.</div>
                  )}
                  <div className={styles.cards} aria-label="Indicadores comerciais">
                    <div className={`${styles.card} ${styles.cardAzul}`}>
                      <div className={styles.cardCabecalho}><span className={styles.cardIcone}>VB</span><span>Vendas antes de descontos</span></div>
                      <strong>{moeda.format(consolidado.brutoAntesDescontos)}</strong>
                      <div className={styles.cardRodape}><span>{consolidado.quantidadeVendas} venda(s) no período</span><MiniTendencia valores={serie.map(d=>d.brutoAntesDescontos)} cor="#2f73d1" /></div>
                    </div>
                    <div className={`${styles.card} ${styles.cardRosa}`}>
                      <div className={styles.cardCabecalho}><span className={styles.cardIcone}>D</span><span>Descontos</span></div>
                      <strong>− {moeda.format(consolidado.descontos)}</strong>
                      <div className={styles.cardRodape}><span>Concedidos nas vendas</span><MiniTendencia valores={serie.map(d=>d.descontos)} cor="#dc5268" /></div>
                    </div>
                    <div className={`${styles.card} ${styles.cardLaranja}`}>
                      <div className={styles.cardCabecalho}><span className={styles.cardIcone}>E</span><span>Estornos no período</span></div>
                      <strong>− {moeda.format(consolidado.estornosDoDia)}</strong>
                      <div className={styles.cardRodape}><span>{consolidado.quantidadeEstornos} operação(ões)</span><MiniTendencia valores={serie.map(d=>d.estornosDoDia)} cor="#e29135" /></div>
                    </div>
                    <div className={`${styles.card} ${styles.cardVerde}`}>
                      <div className={styles.cardCabecalho}><span className={styles.cardIcone}>FL</span><span>Faturamento comercial líquido</span></div>
                      <strong>{moeda.format(consolidado.faturamentoLiquido)}</strong>
                      <div className={styles.cardRodape}><span>Vendas menos estornos</span><MiniTendencia valores={serie.map(d=>d.faturamentoLiquido)} cor="#189b61" /></div>
                    </div>
                    <div className={`${styles.card} ${styles.cardCiano}`}>
                      <div className={styles.cardCabecalho}><span className={styles.cardIcone}>TM</span><span>Ticket médio das vendas</span></div>
                      <strong>{indicadores.ticketMedioVendas === null ? "—" : moeda.format(indicadores.ticketMedioVendas)}</strong>
                      <div className={styles.cardRodape}><span>Após descontos; antes dos estornos</span></div>
                    </div>
                    <div className={`${styles.card} ${styles.cardVioleta}`}>
                      <div className={styles.cardCabecalho}><span className={styles.cardIcone}>CF</span><span>Dias fechados</span></div>
                      <strong>{relatorio.quantidadeDiasFechados} / {relatorio.periodoDias}</strong>
                      <div className={styles.cardRodape}><span>{valorPct(indicadores.percentualDiasFechados)} do período</span></div>
                    </div>
                  </div>

                  <div className={styles.gradeDestaque}>
                    <section className={`${styles.painel} ${styles.painelEvolucao}`}>
                      <div className={styles.painelTitulo}>
                        <div><h2><span className={styles.emojiTitulo} aria-hidden="true">▥</span> Faturamento comercial por dia</h2>
                        <p className={styles.nota}>Vendas, estornos e valor líquido pela data da operação.</p></div>
                        <strong className={styles.valorPainel}>{moeda.format(consolidado.faturamentoLiquido)}</strong>
                      </div>
                      <GraficoEvolucao dias={relatorio.dias} />
                    </section>
                    <section className={styles.painel}>
                      <div className={styles.painelTitulo}><div>
                        <h2><span className={styles.emojiTitulo} aria-hidden="true">◉</span> Formas de pagamento declaradas</h2>
                        <p className={styles.nota}>Valores das vendas registradas, antes de estornos. Não são recebimentos confirmados.</p>
                      </div></div>
                      <GraficoPagamentos valores={consolidado.porFormaPagamento} />
                    </section>
                  </div>

                  <section className={`${styles.painel} ${styles.painelIndicadores}`}>
                    <div className={styles.painelTitulo}><div>
                      <h2><span className={styles.emojiTitulo} aria-hidden="true">◴</span> Indicadores comerciais do período</h2>
                      <p className={styles.nota}>Indicadores operacionais; não representam margem, lucro ou conciliação.</p>
                    </div></div>
                    <div className={styles.gradeMedidores}>
                      <Medidor rotulo="Estornos / vendas" valor={indicadores.taxaEstornosSobreVendas} descricao="Pode incluir estornos de vendas anteriores" cor="#dd7650" />
                      <Medidor rotulo="Participação dos cartões" valor={indicadores.participacaoCartoes} descricao="Nas modalidades declaradas" cor="#3979d4" />
                      <Medidor rotulo="Valor após descontos" valor={indicadores.percentualAposDescontos} descricao="Vendas efetivas / bruto original" cor="#20a46e" />
                      <Medidor rotulo="Dias fechados" valor={indicadores.percentualDiasFechados} descricao="Fechamentos comerciais registrados" cor="#8862d4" />
                    </div>
                  </section>

                  <div className={styles.gradeProdutos}>
                    <section className={styles.painel}>
                      <div className={styles.painelTitulo}><div>
                        <h2><span className={styles.emojiTitulo} aria-hidden="true">★</span> Top 10 produtos por valor bruto</h2>
                        <p className={styles.nota}>Subtotal dos itens vendidos, antes de descontos e estornos.</p>
                      </div></div>
                      {erroRanking && <p role="alert" className={styles.erro}>{erroRanking}</p>}
                      {!ranking && !erroRanking && <p>Carregando ranking...</p>}
                      {ranking?.topFaturamento.length === 0 && <p>Nenhum item vendido no período.</p>}
                      <div className={styles.rankingLista}>
                        {ranking?.topFaturamento.map((item, indice) => (
                          <div key={item.produtoId} className={styles.rankingLinha}>
                            <div className={styles.rankingDescricao}><span><b className={styles.posicaoRank}>{indice + 1}</b>{item.nome}</span><strong>{moeda.format(item.valorBrutoItens)}</strong></div>
                            <div className={styles.barraTrilho}><div className={styles.barraAzul} style={{width: percentualBarra(item.valorBrutoItens, ranking.topFaturamento[0]?.valorBrutoItens ?? 1)}}/></div>
                            <small>{quantidade.format(item.quantidadeVendida)} {item.unidade}</small>
                          </div>
                        ))}
                      </div>
                    </section>
                    <section className={styles.painel}>
                      <div className={styles.painelTitulo}>
                        <div><h2><span className={styles.emojiTitulo} aria-hidden="true">▤</span> Mais vendidos por quantidade</h2>
                        <p className={styles.nota}>Quantidade bruta. Unidades diferentes não são somadas.</p></div>
                        {gruposUnidade.length > 0 && (
                          <label className={styles.seletorUnidade}>Unidade
                            <select value={grupoAtivo?.unidade ?? ""} onChange={(e: ChangeEvent<HTMLSelectElement>) => setUnidadeEscolhida(e.target.value)}>
                              {gruposUnidade.map(grupo => <option key={grupo.unidade} value={grupo.unidade}>{grupo.unidade}</option>)}
                            </select>
                          </label>
                        )}
                      </div>
                      {gruposUnidade.length === 0 && <p>Nenhum item vendido no período.</p>}
                      <div className={styles.rankingLista}>
                        {grupoAtivo?.itens.map((item, indice) => (
                          <div key={item.produtoId} className={styles.rankingLinha}>
                            <div className={styles.rankingDescricao}><span><b className={styles.posicaoRank}>{indice + 1}</b>{item.nome}</span><strong>{quantidade.format(item.quantidadeVendida)} {grupoAtivo.unidade}</strong></div>
                            <div className={styles.barraTrilho}><div className={styles.barraVerde} style={{width: percentualBarra(item.quantidadeVendida, grupoAtivo.itens[0]?.quantidadeVendida ?? 1)}}/></div>
                          </div>
                        ))}
                      </div>
                    </section>
                  </div>

                  <div className={styles.gradeResumoAlertas}>
                    <section className={styles.painel}>
                      <h2><span className={styles.emojiTitulo} aria-hidden="true">▣</span> Resumo de {dataCurta(resumoUltimoDia?.data ?? relatorio.fim)}</h2>
                      <p className={styles.nota}>Último dia selecionado, não o acumulado do período.</p>
                      <div className={styles.linhasResumo}>
                        <div><span>Vendas antes de descontos</span><strong>{moeda.format(resumoUltimoDia?.brutoAntesDescontos ?? 0)}</strong></div>
                        <div><span>Descontos</span><strong>− {moeda.format(resumoUltimoDia?.descontos ?? 0)}</strong></div>
                        <div><span>Estornos do dia</span><strong>− {moeda.format(resumoUltimoDia?.estornosDoDia ?? 0)}</strong></div>
                        <div className={styles.linhaDestaque}><span>Líquido comercial</span><strong>{moeda.format(resumoUltimoDia?.faturamentoLiquido ?? 0)}</strong></div>
                        <div><span>Quantidade de vendas</span><strong>{resumoUltimoDia?.quantidadeVendas ?? 0}</strong></div>
                        <div><span>Situação</span><strong>{resumoUltimoDia?.situacao === "FECHADO" ? "Fechado" : "Aberto"}</strong></div>
                      </div>
                    </section>
                    <section className={styles.painel}>
                      <h2><span className={styles.emojiTitulo} aria-hidden="true">!</span> Alertas e observações</h2>
                      <div className={styles.listaAlertas}>
                        {relatorio.quantidadeDiasComDivergencia > 0 && <div className={`${styles.itemAlerta} ${styles.alertaVermelho}`}><strong>Divergência após fechamento</strong><span>{relatorio.quantidadeDiasComDivergencia} dia(s) com novas operações que exigem revisão.</span></div>}
                        {consolidado.outroSemClassificacaoFinanceira > 0 && <div className={`${styles.itemAlerta} ${styles.alertaLaranja}`}><strong>Modalidade OUTRO</strong><span>{moeda.format(consolidado.outroSemClassificacaoFinanceira)} declarados; pagamento não conciliado.</span></div>}
                        {consolidado.estornosDoDia > 0 && <div className={`${styles.itemAlerta} ${styles.alertaLaranja}`}><strong>Estornos operacionais</strong><span>{moeda.format(consolidado.estornosDoDia)} no período. Não comprovam reembolso.</span></div>}
                        {relatorio.quantidadeDiasFechados < relatorio.periodoDias && <div className={`${styles.itemAlerta} ${styles.alertaAzul}`}><strong>Dias ainda abertos</strong><span>{relatorio.periodoDias - relatorio.quantidadeDiasFechados} dia(s) sem fechamento comercial registrado.</span></div>}
                        {relatorio.quantidadeDiasComDivergencia === 0 && <div className={`${styles.itemAlerta} ${styles.alertaVerde}`}><strong>Sem divergência de snapshot detectada</strong><span>Não substitui conciliação financeira nem validação bancária.</span></div>}
                      </div>
                    </section>
                  </div>

                  {dias === 1 && (
                    <section className={`${styles.painel} ${styles.painelFechamento}`}>
                      <h2>Registrar fechamento comercial diário</h2>
                      <p className={styles.nota}>O registro preserva os valores da data e o gestor responsável. Não constitui conferência do dinheiro físico.</p>
                      {relatorio.dias[0]?.situacao === "FECHADO" ? (
                        <div className={styles.sucesso}>Dia fechado por {relatorio.dias[0].fechamento?.responsavel} em {relatorio.dias[0].fechamento?.criadoEm ? new Date(relatorio.dias[0].fechamento.criadoEm).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "data não informada"}.</div>
                      ) : (
                        <div className={styles.formFechar}>
                          <label>Observação (opcional)
                            <textarea maxLength={500} rows={2} value={observacao} onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setObservacao(e.target.value)} placeholder="Informações sobre a apuração do dia" />
                          </label>
                          <button type="button" disabled={enviando || carregando} onClick={() => void fecharDia()}>{enviando ? "Registrando..." : "Registrar fechamento comercial"}</button>
                        </div>
                      )}
                    </section>
                  )}

                  <section className={`${styles.painel} ${styles.painelTabela}`}>
                    <div className={styles.painelTitulo}><div>
                      <h2><span className={styles.emojiTitulo} aria-hidden="true">▦</span> {dias === 1 ? "Evolução do dia" : `Evolução dos últimos ${dias} dias`}</h2>
                      <p className={styles.nota}>Dias fechados preservam o snapshot; alterações posteriores são sinalizadas.</p>
                    </div></div>
                    <div className={styles.tabelaWrapper}>
                      <table>
                        <thead><tr><th>Dia</th><th>Situação</th><th>Vendas</th><th>Estornos</th><th>Vendas efetivas</th><th>Estornos (R$)</th><th>Líquido (R$)</th></tr></thead>
                        <tbody>
                          {relatorio.dias.map((dia) => (
                            <tr key={dia.data}>
                              <td>{dia.data}</td>
                              <td><span className={dia.situacao === "FECHADO" ? styles.situacaoFechado : styles.situacaoAberto}>● {dia.situacao === "FECHADO" ? "Fechado" : "Aberto"}</span>{dia.divergenciaAposFechamento ? <span className={styles.divergencia}> · Divergência</span> : null}</td>
                              <td>{dia.quantidadeVendas}</td>
                              <td>{dia.quantidadeEstornos}</td>
                              <td>{moeda.format(dia.vendasEfetivas)}</td>
                              <td>{moeda.format(dia.estornosDoDia)}</td>
                              <td><strong>{moeda.format(dia.faturamentoLiquido)}</strong></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </section>
                  <p className={styles.rodapeDados}>Fonte: registros da empresa autenticada. Base comercial; faturamento, pagamentos declarados e estornos não significam liquidação ou reembolso financeiro.</p>
                </>
              )}
            </>
          )}
        </main>
      </div>
    </ProtecaoSessao>
  );
}
