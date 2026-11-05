"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import styles from "../admin-plataforma.module.css";
import {
  API_URL_ADMIN,
  CHAVE_ADMIN_TOKEN,
  CHAVE_ADMIN_USUARIO,
  lerMensagemErro,
  limparSessaoAdmin,
} from "../sessao-admin";

type Resultado = "SUCESSO" | "FALHA" | "BLOQUEADO";
type Evento = {
  id: string;
  criadoEm: string;
  tipoAtor: string;
  atorId: string | null;
  modulo: string;
  acao: string;
  entidade: string | null;
  entidadeId: string | null;
  resultado: Resultado;
  motivo: string | null;
  requestId: string | null;
  empresaAlvoId: string | null;
};
type Resposta = {
  dados: Evento[];
  total: number;
  pagina: number;
  limite: number;
  totalPaginas: number;
  indicadores: { sucesso: number; falha: number; bloqueado: number };
  periodo: { inicio: string; fim: string };
};
type Filtros = {
  inicio: string;
  fim: string;
  modulo: string;
  acao: string;
  resultado: "" | Resultado;
};
const FILTROS_INICIAIS: Filtros = {
  inicio: "", fim: "", modulo: "", acao: "", resultado: "",
};
const LIMITE = 20;

/**
 * Central de auditoria administrativa da plataforma.
 * Este frontend não autoriza acessos: a API sempre valida AdminPlataformaGuard
 * e limita os eventos à atuação SaaS, sem exibir logs operacionais dos clientes.
 */
export default function AuditoriaPlataformaPage() {
  const router = useRouter();
  const [nomeAdministrador, setNomeAdministrador] = useState("Administrador da plataforma");
  const [filtros, setFiltros] = useState<Filtros>(FILTROS_INICIAIS);
  const [aplicados, setAplicados] = useState<Filtros>(FILTROS_INICIAIS);
  const [pagina, setPagina] = useState(1);
  const [atualizacao, setAtualizacao] = useState(0);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");
  const [resposta, setResposta] = useState<Resposta | null>(null);
  const [detalheId, setDetalheId] = useState<string | null>(null);

  useEffect(() => {
    try {
      const usuario = JSON.parse(sessionStorage.getItem(CHAVE_ADMIN_USUARIO) ?? "null") as unknown;
      if (usuario && typeof usuario === "object" && "nome" in usuario && typeof usuario.nome === "string") {
        setNomeAdministrador(usuario.nome);
      }
    } catch {
      // Metadados da sessão são apenas informativos; autorização é feita na API.
    }
  }, []);

  useEffect(() => {
    const token = sessionStorage.getItem(CHAVE_ADMIN_TOKEN);
    if (!token) {
      router.replace("/admin-plataforma");
      return;
    }
    const controle = new AbortController();

    async function consultar() {
      setCarregando(true);
      setErro("");
      try {
        const parametros = new URLSearchParams({
          pagina: String(pagina),
          limite: String(LIMITE),
        });
        if (aplicados.modulo.trim()) parametros.set("modulo", aplicados.modulo.trim().toUpperCase());
        if (aplicados.acao.trim()) parametros.set("acao", aplicados.acao.trim().toUpperCase());
        if (aplicados.resultado) parametros.set("resultado", aplicados.resultado);
        // Datas do formulário são interpretadas no fuso local do navegador.
        if (aplicados.inicio) parametros.set("inicio", new Date(`${aplicados.inicio}T00:00:00`).toISOString());
        if (aplicados.fim) parametros.set("fim", new Date(`${aplicados.fim}T23:59:59.999`).toISOString());

        const retorno = await fetch(`${API_URL_ADMIN}/admin-plataforma/auditoria?${parametros}`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
          signal: controle.signal,
        });
        if (retorno.status === 401 || retorno.status === 403) {
          limparSessaoAdmin();
          router.replace("/admin-plataforma");
          return;
        }
        if (!retorno.ok) {
          setErro(await lerMensagemErro(retorno, "Não foi possível consultar os eventos."));
          return;
        }
        const dados: Resposta = await retorno.json();
        if (!Array.isArray(dados.dados) || typeof dados.total !== "number" || !dados.indicadores) {
          setErro("A API retornou dados de auditoria em formato inesperado.");
          return;
        }
        setResposta(dados);
        setDetalheId(null);
      } catch {
        if (!controle.signal.aborted) {
          setErro("Falha de comunicação com o backend. Verifique se a API está ativa.");
        }
      } finally {
        if (!controle.signal.aborted) setCarregando(false);
      }
    }

    void consultar();
    return () => controle.abort();
  }, [router, pagina, aplicados, atualizacao]);

  function filtrar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    setPagina(1);
    setAplicados({ ...filtros });
  }

  function limparFiltros() {
    setFiltros({ ...FILTROS_INICIAIS });
    setAplicados({ ...FILTROS_INICIAIS });
    setPagina(1);
  }

  function sair() {
    limparSessaoAdmin();
    router.replace("/admin-plataforma");
  }

  const dataHora = (valor: string) => {
    const data = new Date(valor);
    return Number.isFinite(data.getTime())
      ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "medium" }).format(data)
      : "Data não informada";
  };

  return (
    <main className={styles.painelPagina}>
      <header className={styles.cabecalho}>
        <div className={styles.marca}>
          <span className={styles.marcaIcone}>GC</span>
          <span>GESTÃO COMERCIAL <small>PLATAFORMA SAAS</small></span>
        </div>
        <div className={styles.cabecalhoDireito}>
          <span className={styles.nomeAdmin}>{nomeAdministrador}</span>
          <Link href="/admin-plataforma/empresas" className={styles.botaoSair}>Empresas</Link>
          <button type="button" onClick={sair} className={styles.botaoSair}>Sair do painel</button>
        </div>
      </header>

      <div className={styles.areaConteudo}>
        <div className={styles.topoPagina}>
          <div>
            <span className={styles.etiquetaClara}>ADMINISTRAÇÃO DA PLATAFORMA</span>
            <h1>Central de Auditoria</h1>
            <p className={styles.mutado}>
              Eventos administrativos da plataforma, incluindo provisionamento e tentativas de login SaaS.
              Operações internas dos clientes não são exibidas nesta visão.
            </p>
          </div>
          <div className={styles.contador}>
            <strong>{resposta?.total ?? "—"}</strong>
            <small>eventos no filtro atual</small>
          </div>
        </div>

        <section className={styles.auditoriaIndicadores} aria-label="Resumo dos eventos">
          <div className={styles.auditoriaIndicador}><span>Sucessos</span><strong>{resposta?.indicadores.sucesso ?? "—"}</strong></div>
          <div className={styles.auditoriaIndicador}><span>Falhas</span><strong>{resposta?.indicadores.falha ?? "—"}</strong></div>
          <div className={styles.auditoriaIndicador}><span>Bloqueios</span><strong>{resposta?.indicadores.bloqueado ?? "—"}</strong></div>
        </section>

        <section className={styles.cartao} aria-labelledby="titulo-filtros-auditoria">
          <div className={styles.secaoTopo}>
            <div>
              <h2 id="titulo-filtros-auditoria">Filtros</h2>
              <p className={styles.mutado}>Sem datas informadas, são consultados os últimos 30 dias. Período máximo: 93 dias.</p>
            </div>
          </div>
          <form className={styles.auditoriaFiltros} onSubmit={filtrar}>
            <div className={styles.campo}>
              <label htmlFor="audit-inicio">Data inicial</label>
              <input id="audit-inicio" type="date" value={filtros.inicio} onChange={(e) => setFiltros((a) => ({ ...a, inicio: e.target.value }))} />
            </div>
            <div className={styles.campo}>
              <label htmlFor="audit-fim">Data final</label>
              <input id="audit-fim" type="date" value={filtros.fim} onChange={(e) => setFiltros((a) => ({ ...a, fim: e.target.value }))} />
            </div>
            <div className={styles.campo}>
              <label htmlFor="audit-modulo">Módulo</label>
              <select id="audit-modulo" value={filtros.modulo} onChange={(e) => setFiltros((a) => ({ ...a, modulo: e.target.value }))}>
                <option value="">Todos</option>
                <option value="ADMIN_PLATAFORMA">Administração SaaS</option>
                <option value="EMPRESAS">Empresas</option>
                <option value="USUARIOS">Usuários provisionados</option>
                <option value="AUDITORIA">Consultas de auditoria</option>
              </select>
            </div>
            <div className={styles.campo}>
              <label htmlFor="audit-resultado">Resultado</label>
              <select id="audit-resultado" value={filtros.resultado} onChange={(e) => setFiltros((a) => ({ ...a, resultado: e.target.value as Filtros["resultado"] }))}>
                <option value="">Todos</option><option value="SUCESSO">Sucesso</option><option value="FALHA">Falha</option><option value="BLOQUEADO">Bloqueado</option>
              </select>
            </div>
            <div className={styles.campo}>
              <label htmlFor="audit-acao">Ação (opcional)</label>
              <input id="audit-acao" value={filtros.acao} maxLength={100} placeholder="Ex.: LOGIN" onChange={(e) => setFiltros((a) => ({ ...a, acao: e.target.value }))} />
            </div>
            <div className={styles.auditoriaAcoes}>
              <button type="submit" className={styles.botaoPrincipal} disabled={carregando}>Filtrar</button>
              <button type="button" className={styles.botaoSecundario} onClick={limparFiltros}>Limpar</button>
              <button type="button" className={styles.botaoSecundario} onClick={() => setAtualizacao((a) => a + 1)}>Atualizar</button>
            </div>
          </form>
        </section>

        <section className={styles.cartao} aria-labelledby="titulo-eventos-auditoria">
          <div className={styles.secaoTopo}>
            <div>
              <h2 id="titulo-eventos-auditoria">Histórico de eventos</h2>
              <p className={styles.mutado}>Clique em um evento para visualizar seus dados técnicos permitidos.</p>
            </div>
          </div>
          {erro && <p className={styles.mensagemErro} role="alert">{erro}</p>}
          {carregando ? (
            <p className={styles.mutado}>Consultando eventos...</p>
          ) : !resposta || resposta.dados.length === 0 ? (
            <p className={styles.vazio}>Nenhum evento administrativo encontrado para os filtros informados.</p>
          ) : (
            <div className={styles.tabelaRolagem}>
              <table className={styles.tabela}>
                <thead><tr><th>Quando</th><th>Módulo</th><th>Ação</th><th>Responsável</th><th>Resultado</th><th>Detalhes</th></tr></thead>
                <tbody>
                  {resposta.dados.map((evento) => (
                    <tr key={evento.id}>
                      <td>{dataHora(evento.criadoEm)}</td>
                      <td>{evento.modulo}</td>
                      <td>{evento.acao}</td>
                      <td>{evento.tipoAtor === "ANONIMO" ? "Não autenticado" : "Administrador SaaS"}</td>
                      <td><span className={evento.resultado === "SUCESSO" ? styles.ativo : styles.inativo}>{evento.resultado}</span></td>
                      <td><button type="button" className={styles.botaoSecundario} onClick={() => setDetalheId((a) => a === evento.id ? null : evento.id)} aria-expanded={detalheId === evento.id}>{detalheId === evento.id ? "Ocultar" : "Ver"}</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {resposta && detalheId && (() => {
            const evento = resposta.dados.find((e) => e.id === detalheId);
            if (!evento) return null;
            return (
              <div className={styles.auditoriaDetalhes}>
                <h3>Detalhes do evento</h3>
                <dl className={styles.auditoriaDetalhesGrid}>
                  <div><dt>Identificador</dt><dd>{evento.id}</dd></div>
                  <div><dt>Data e hora</dt><dd>{dataHora(evento.criadoEm)}</dd></div>
                  <div><dt>Ator</dt><dd>{evento.atorId ?? "Não autenticado"}</dd></div>
                  <div><dt>Tipo de ator</dt><dd>{evento.tipoAtor}</dd></div>
                  <div><dt>Entidade</dt><dd>{evento.entidade ?? "—"}</dd></div>
                  <div><dt>ID da entidade</dt><dd>{evento.entidadeId ?? "—"}</dd></div>
                  <div><dt>Empresa atendida</dt><dd>{evento.empresaAlvoId ?? "Não aplicável"}</dd></div>
                  <div><dt>Request ID</dt><dd>{evento.requestId ?? "Não disponível"}</dd></div>
                  <div><dt>Motivo</dt><dd>{evento.motivo ?? "Não informado"}</dd></div>
                </dl>
              </div>
            );
          })()}
          <div className={styles.paginacao}>
            <span>Página {pagina} de {Math.max(1, resposta?.totalPaginas ?? 1)}</span>
            <div className={styles.acoesLinha}>
              <button type="button" className={styles.botaoSecundario} disabled={carregando || pagina <= 1} onClick={() => setPagina((a) => Math.max(1, a - 1))}>Anterior</button>
              <button type="button" className={styles.botaoSecundario} disabled={carregando || pagina >= (resposta?.totalPaginas ?? 1)} onClick={() => setPagina((a) => a + 1)}>Próxima</button>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
