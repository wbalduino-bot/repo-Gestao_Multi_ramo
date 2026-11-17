"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { identidadeVenda } from "./operacao-venda";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";
const moeda = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const quantidadeFormatada = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 3 });

type Item = { id: string; quantidade: number | string; produto: { nome: string } };
type ItemEstorno = { itemVendaId: string; quantidade: number; valorEstornado: number };
type Estorno = { id: string; usuarioId: string; justificativa: string; valorEstornado: number; criadoEm: string; itens: ItemEstorno[]; reembolsoFinanceiro: string };
type Pedido = { vendaId: string; chaveOperacao: string; justificativa: string; itens: { itemVendaId: string; quantidade: number }[] };

const cabecalho = { "Content-Type": "application/json" };

function chavePendente(token: string, vendaId: string) {
  const identidade = identidadeVenda(token);
  return `gestao.estorno.pendente.v1.${identidade.empresaId}.${identidade.usuarioId}.${vendaId}`;
}

export function EstornosVendaPainel({ vendaId, itens, onConcluido }: {
  vendaId: string;
  itens: Item[];
  onConcluido?: () => void;
}) {
  const [historico, setHistorico] = useState<Estorno[]>([]);
  const [quantidades, setQuantidades] = useState<Record<string, string>>({});
  const [justificativa, setJustificativa] = useState("");
  const [pendente, setPendente] = useState<Pedido | null>(null);
  const [bloqueado, setBloqueado] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");
  const [sucesso, setSucesso] = useState("");

  const atualizarHistorico = useCallback(async () => {
    const token = sessionStorage.getItem("gestao.accessToken");
    if (!token) throw new Error("Sessao expirada. Entre novamente.");
    const resposta = await fetch(`${API_URL}/vendas/${encodeURIComponent(vendaId)}/estornos`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
    });
    if (!resposta.ok) throw new Error(`Nao foi possivel consultar os estornos (HTTP ${resposta.status}).`);
    const dados: unknown = await resposta.json();
    if (!Array.isArray(dados)) throw new Error("Resposta inesperada do historico de estornos.");
    setHistorico(dados as Estorno[]);
  }, [vendaId]);

  useEffect(() => {
    let ativo = true;
    try {
      const token = sessionStorage.getItem("gestao.accessToken");
      if (!token) throw new Error("Sessao expirada. Entre novamente.");
      const cache = sessionStorage.getItem(chavePendente(token, vendaId));
      if (cache) {
        const dados: unknown = JSON.parse(cache);
        if (!dados || typeof dados !== "object" ||
            (dados as Pedido).vendaId !== vendaId ||
            typeof (dados as Pedido).chaveOperacao !== "string" ||
            !Array.isArray((dados as Pedido).itens)) {
          throw new Error("Tentativa pendente invalida. Consulte o suporte antes de operar novamente.");
        }
        setPendente(dados as Pedido);
        setJustificativa((dados as Pedido).justificativa);
        setBloqueado(true);
      }
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Nao foi possivel recuperar o estorno pendente.");
      setBloqueado(true);
    }
    atualizarHistorico().catch((e: unknown) => {
      if (ativo) setErro(e instanceof Error ? e.message : "Erro ao consultar os estornos.");
    }).finally(() => { if (ativo) setCarregando(false); });
    return () => { ativo = false; };
  }, [atualizarHistorico, vendaId]);

  const quantidadeEstornada = (itemVendaId: string) =>
    historico.reduce((soma, e) => soma + e.itens
      .filter((i) => i.itemVendaId === itemVendaId)
      .reduce((a, i) => a + Number(i.quantidade), 0), 0);

  const estoqueDisponivel = (item: Item) =>
    Math.max(0, Math.round((Number(item.quantidade) - quantidadeEstornada(item.id)) * 1000) / 1000);

  async function confirmar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    if (enviando || bloqueado && !pendente) return;
    setErro(""); setSucesso("");

    const token = sessionStorage.getItem("gestao.accessToken");
    if (!token) { setErro("Sessao expirada. Entre novamente."); return; }

    let pedido = pendente;
    let chave = "";
    try {
      chave = chavePendente(token, vendaId);
      if (!pedido) {
        const motivo = justificativa.trim();
        if (motivo.length < 10 || motivo.length > 500) {
          throw new Error("Informe justificativa entre 10 e 500 caracteres.");
        }
        const selecionados = itens.flatMap((i) => {
          const texto = (quantidades[i.id] ?? "").trim().replace(",", ".");
          if (!texto) return [];
          if (!/^\d{1,11}(?:\.\d{1,3})?$/.test(texto)) {
            throw new Error(`Quantidade invalida para ${i.produto.nome}.`);
          }
          const quantidade = Number(texto);
          if (quantidade === 0) return [];
          if (quantidade < 0 || quantidade > estoqueDisponivel(i)) {
            throw new Error(`Quantidade acima do disponivel para ${i.produto.nome}.`);
          }
          return [{ itemVendaId: i.id, quantidade }];
        });
        if (selecionados.length === 0) throw new Error("Informe quantidades para estornar.");
        pedido = { vendaId, chaveOperacao: crypto.randomUUID(), justificativa: motivo, itens: selecionados };
        // Persistir ANTES de enviar: internet instavel nao pode criar dois estornos.
        sessionStorage.setItem(chave, JSON.stringify(pedido));
        setPendente(pedido);
      }
      setEnviando(true);
      const resposta = await fetch(`${API_URL}/vendas/${encodeURIComponent(vendaId)}/estornos`, {
        method: "POST",
        headers: { ...cabecalho, Authorization: `Bearer ${token}` },
        // Nao enviar vendaId no JSON: o ID ja faz parte da URL e o DTO e estrito.
        body: JSON.stringify({
          chaveOperacao: pedido.chaveOperacao,
          justificativa: pedido.justificativa,
          itens: pedido.itens,
        }),
        cache: "no-store",
        signal: AbortSignal.timeout(15000),
      });
      if (!resposta.ok) {
        const erroHttp: unknown = await resposta.json().catch(() => null);
        const mensagem = erroHttp && typeof erroHttp === "object" && "message" in erroHttp
          ? String((erroHttp as { message: unknown }).message)
          : `HTTP ${resposta.status}`;
        // Apenas erro definitivo de entrada/autorizacao permite editar novamente.
        if ([400, 401, 403, 404, 422].includes(resposta.status)) {
          sessionStorage.removeItem(chave);
          setPendente(null);
          setBloqueado(false);
        } else {
          setBloqueado(true);
        }
        throw new Error(mensagem);
      }
      sessionStorage.removeItem(chave);
      setPendente(null); setBloqueado(false);
      setQuantidades({}); setJustificativa("");
      setSucesso("Estorno registrado. O estoque foi atualizado. Reembolso financeiro nao registrado.");
      await atualizarHistorico();
      onConcluido?.();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha no estorno. Nao inicie outra operacao.");
      if (pendente || sessionStorage.getItem(chave)) setBloqueado(true);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <section aria-labelledby="titulo-estorno-venda" style={{ padding: 16, marginTop: 20, border: "1px solid #9ca3af", borderRadius: 8 }}>
      <h4 id="titulo-estorno-venda">Estorno de produtos e vendas</h4>
      <p>Somente ADMINISTRADOR e GERENTE. O estoque retorna aos lotes originais. O estorno nao registra devolucao de dinheiro.</p>
      {carregando ? <p>Consultando estornos...</p> : (
        <>
          {historico.length > 0 && <div>
            <h5>Estornos ja registrados</h5>
            {historico.map((estorno) => <div key={estorno.id} style={{ marginBottom: 8 }}>
              <strong>{new Date(estorno.criadoEm).toLocaleString("pt-BR")}: {moeda.format(estorno.valorEstornado)}</strong>
              <p>{estorno.justificativa}</p>
              <small>{estorno.itens.map((i) => `${quantidadeFormatada.format(i.quantidade)} de ${itens.find((v) => v.id === i.itemVendaId)?.produto.nome ?? i.itemVendaId}`).join(", ")}</small>
            </div>)}
          </div>}
          <form onSubmit={confirmar}>
            <h5>Selecionar itens para estornar</h5>
            {itens.map((item) => <div key={item.id} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12, marginBottom: 10 }}>
              <label htmlFor={`estorno-${item.id}`} style={{ flex: "1 1 200px" }}>
                {item.produto.nome} — Disponivel: {quantidadeFormatada.format(estoqueDisponivel(item))}
              </label>
              <input id={`estorno-${item.id}`} type="text" inputMode="decimal" placeholder="Quantidade" style={{ width: 120 }}
                value={quantidades[item.id] ?? ""} disabled={enviando || bloqueado || estoqueDisponivel(item) <= 0}
                onChange={(e) => setQuantidades((atual) => ({ ...atual, [item.id]: e.target.value }))}/>
            </div>)}
            <button type="button" disabled={enviando || bloqueado} onClick={() =>
              setQuantidades(Object.fromEntries(itens.filter((i) => estoqueDisponivel(i) > 0)
                .map((i) => [i.id, String(estoqueDisponivel(i))])))}>
              Estornar todo o saldo restante
            </button>
            <div style={{ marginTop: 12 }}>
              <label htmlFor={`justificativa-${vendaId}`}>Justificativa obrigatoria</label>
              <textarea id={`justificativa-${vendaId}`} value={justificativa}
                onChange={(e) => setJustificativa(e.target.value)}
                rows={3} maxLength={500} disabled={enviando || bloqueado}
                placeholder="Explique o motivo do estorno (minimo 10 caracteres)"
                style={{ display: "block", width: "100%", maxWidth: 560 }}/>
            </div>
            {bloqueado && pendente && <p role="status">A confirmacao anterior pode ter sido processada. Reenvie a mesma operacao; nunca crie outra antes de obter confirmacao.</p>}
            {erro && <p role="alert" style={{ color: "#b91c1c" }}>{erro}</p>}
            {sucesso && <p role="status">{sucesso}</p>}
            <button type="submit" disabled={enviando || bloqueado && !pendente} style={{ marginTop: 12 }}>
              {enviando ? "Registrando..." : pendente ? "Reconfirmar estorno pendente" : "Confirmar estorno com justificativa"}
            </button>
          </form>
        </>
      )}
    </section>
  );
}
