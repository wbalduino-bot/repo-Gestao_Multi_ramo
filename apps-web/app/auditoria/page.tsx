"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { MenuLateral } from "../componentes/menu-lateral";
import styles from "./auditoria.module.css";

const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5433").replace(/\/$/, "");
const LIMITE = 20;

type Evento = {
  id: string;
  criadoEm: string;
  atorId: string | null;
  responsavel: string;
  tipoAtor: string;
  modulo: string;
  acao: string;
  entidade: string | null;
  entidadeId: string | null;
  resultado: "SUCESSO" | "FALHA" | "BLOQUEADO";
  motivo: string | null;
  requestId: string | null;
};
type Resposta = {
  dados: Evento[];
  total: number;
  sucessos: number;
  falhas: number;
  bloqueados: number;
  totalPaginas: number;
  message?: string | string[];
};
type Filtros = { modulo: string; acao: string; resultado: string; atorId: string; inicio: string; fim: string };
const vazios: Filtros = { modulo: "", acao: "", resultado: "", atorId: "", inicio: "", fim: "" };

function mensagemErro(valor: unknown): string {
  if (valor && typeof valor === "object" && "message" in valor) {
    const texto = (valor as { message: unknown }).message;
    return Array.isArray(texto) ? texto.join(", ") : typeof texto === "string" ? texto : "Falha na consulta.";
  }
  return "Não foi possível consultar a auditoria.";
}

export default function PaginaAuditoria() {
  const router = useRouter();
  const [autorizado, setAutorizado] = useState(false);
  const [verificando, setVerificando] = useState(true);
  const [negado, setNegado] = useState(false);
  const [nomeEmpresa, setNomeEmpresa] = useState("Empresa autenticada");
  const [filtros, setFiltros] = useState<Filtros>(vazios);
  const [aplicados, setAplicados] = useState<Filtros>(vazios);
  const [pagina, setPagina] = useState(1);
  const [dados, setDados] = useState<Resposta | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState("");
  const [detalhe, setDetalhe] = useState<string | null>(null);

  const encerrar = useCallback(() => {
    sessionStorage.removeItem("gestao.accessToken");
    sessionStorage.removeItem("gestao.usuario");
    router.replace("/");
  }, [router]);

  useEffect(() => {
    const token = sessionStorage.getItem("gestao.accessToken");
    if (!token) { encerrar(); return; }
    try {
      const salvo = JSON.parse(sessionStorage.getItem("gestao.usuario") ?? "{}");
      if (typeof salvo.empresaNome === "string") setNomeEmpresa(salvo.empresaNome);
    } catch { /* A identidade é verificada pelo backend, nunca pela sessão local. */ }
    let ativo = true;
    fetch(`${API_URL}/usuarios/me`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" })
      .then(async (res) => {
        if (res.status === 401) { encerrar(); return null; }
        if (!res.ok) throw new Error("Não foi possível confirmar as permissões.");
        return res.json() as Promise<{ perfil: string }>;
      })
      .then((usuario) => {
        if (!ativo || !usuario) return;
        const permitido = usuario.perfil === "ADMINISTRADOR" || usuario.perfil === "GERENTE";
        setAutorizado(permitido);
        setNegado(!permitido);
      })
      .catch(() => { if (ativo) setNegado(true); })
      .finally(() => { if (ativo) setVerificando(false); });
    return () => { ativo = false; };
  }, [encerrar]);

  useEffect(() => {
    if (!autorizado) return;
    const token = sessionStorage.getItem("gestao.accessToken");
    if (!token) { encerrar(); return; }
    const controlador = new AbortController();
    const parametros = new URLSearchParams({ pagina: String(pagina), limite: String(LIMITE) });
    for (const [chave, valor] of Object.entries(aplicados)) {
      if (!valor) continue;
      if ((chave === "inicio" || chave === "fim")) {
        const data = new Date(valor);
        if (!Number.isFinite(data.getTime())) continue;
        parametros.set(chave, data.toISOString());
      } else parametros.set(chave, valor);
    }
    setCarregando(true);
    setErro("");
    fetch(`${API_URL}/auditoria?${parametros.toString()}`, {
      headers: { Authorization: `Bearer ${token}` }, signal: controlador.signal, cache: "no-store",
    })
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (res.status === 401) { encerrar(); return null; }
        if (!res.ok) throw new Error(mensagemErro(body));
        return body as Resposta;
      })
      .then((body) => { if (body && !controlador.signal.aborted) setDados(body); })
      .catch((e: unknown) => {
        if (!controlador.signal.aborted) setErro(e instanceof Error ? e.message : "Erro na consulta.");
      })
      .finally(() => { if (!controlador.signal.aborted) setCarregando(false); });
    return () => controlador.abort();
  }, [autorizado, aplicados, pagina, encerrar]);

  function aplicarFiltros(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    setPagina(1);
    setDetalhe(null);
    setAplicados({ ...filtros });
  }

  return (
    <div className={styles.layout}>
      <MenuLateral nomeEmpresa={nomeEmpresa} />
      <main className={styles.main}>
        <div className={styles.cabecalho}>
          <div><h1>Auditoria da empresa</h1><p>Histórico de operações e segurança da empresa autenticada.</p></div>
        </div>
        {verificando && <p>Verificando permissões...</p>}
        {!verificando && negado && <p role="alert">Seu perfil não possui acesso à auditoria.</p>}
        {autorizado && <>
          <section className={styles.metricas} aria-label="Indicadores do período e filtros">
            <article><span>Eventos encontrados</span><strong>{dados?.total ?? "—"}</strong></article>
            <article><span>Sucessos</span><strong>{dados?.sucessos ?? "—"}</strong></article>
            <article><span>Falhas</span><strong>{dados?.falhas ?? "—"}</strong></article>
            <article><span>Bloqueios</span><strong>{dados?.bloqueados ?? "—"}</strong></article>
          </section>
          <form className={styles.filtros} onSubmit={aplicarFiltros}>
            <label>Módulo<input value={filtros.modulo} placeholder="Ex.: VENDAS" maxLength={80} onChange={(e) => setFiltros({ ...filtros, modulo: e.target.value.toUpperCase() })} /></label>
            <label>Ação<input value={filtros.acao} placeholder="Ex.: CRIAR" maxLength={100} onChange={(e) => setFiltros({ ...filtros, acao: e.target.value.toUpperCase() })} /></label>
            <label>Resultado<select value={filtros.resultado} onChange={(e) => setFiltros({ ...filtros, resultado: e.target.value })}><option value="">Todos</option><option value="SUCESSO">Sucesso</option><option value="FALHA">Falha</option><option value="BLOQUEADO">Bloqueado</option></select></label>
            <label>ID do responsável<input value={filtros.atorId} placeholder="UUID do usuário" onChange={(e) => setFiltros({ ...filtros, atorId: e.target.value })} /></label>
            <label>Início<input type="datetime-local" value={filtros.inicio} onChange={(e) => setFiltros({ ...filtros, inicio: e.target.value })} /></label>
            <label>Fim<input type="datetime-local" value={filtros.fim} onChange={(e) => setFiltros({ ...filtros, fim: e.target.value })} /></label>
            <div className={styles.acoes}><button type="submit">Filtrar</button><button type="button" onClick={() => { setFiltros(vazios); setAplicados(vazios); setPagina(1); }}>Limpar</button></div>
          </form>
          {erro && <p className={styles.erro} role="alert">{erro}</p>}
          {carregando && <p>Carregando eventos...</p>}
          <div className={styles.tabelaArea}>
            <table><thead><tr><th>Quando</th><th>Módulo</th><th>Ação</th><th>Responsável</th><th>Resultado</th><th>Detalhes</th></tr></thead>
              <tbody>{(dados?.dados ?? []).map((evento) => <tr key={evento.id}>
                <td>{new Date(evento.criadoEm).toLocaleString("pt-BR")}</td><td>{evento.modulo}</td><td>{evento.acao}</td>
                <td>{evento.responsavel}</td><td>{evento.resultado}</td>
                <td><button className={styles.detalhes} type="button" onClick={() => setDetalhe(detalhe === evento.id ? null : evento.id)}>{detalhe === evento.id ? "Ocultar" : "Ver"}</button>
                {detalhe === evento.id && <div className={styles.painelDetalhe}>
                  <p><b>ID:</b> {evento.id}</p><p><b>Ator ID:</b> {evento.atorId ?? "Não identificado"}</p>
                  <p><b>Entidade:</b> {evento.entidade ?? "—"}</p><p><b>ID da entidade:</b> {evento.entidadeId ?? "—"}</p>
                  <p><b>Motivo:</b> {evento.motivo ?? "Não informado"}</p><p><b>Request ID:</b> {evento.requestId ?? "Não disponível"}</p>
                </div>}</td>
              </tr>)}
              {!carregando && !erro && (dados?.dados.length ?? 0) === 0 && <tr><td colSpan={6}>Nenhum evento encontrado no período.</td></tr>}
              </tbody></table>
          </div>
          <div className={styles.paginacao}>
            <span>Página {pagina} de {Math.max(1, dados?.totalPaginas ?? 1)}</span>
            <button disabled={pagina <= 1 || carregando} onClick={() => setPagina((p) => p - 1)}>Anterior</button>
            <button disabled={pagina >= Math.max(1, dados?.totalPaginas ?? 1) || carregando} onClick={() => setPagina((p) => p + 1)}>Próxima</button>
          </div>
        </>}
      </main>
    </div>
  );
}
