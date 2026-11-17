"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { MenuLateral } from "../componentes/menu-lateral";
import layout from "../usuarios/usuarios.module.css";
import painel from "../configuracao-fiscal/configuracao-fiscal.module.css";
import styles from "./recebimentos-compra.module.css";
import { FormularioRecebimento } from "./formulario-recebimento";
import { ConferenciaNotasAgente } from "./conferencia-notas-agente";

const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001").replace(/\/$/, "");

type Origem = "MANUAL" | "AGENTE_GC";
type Situacao = "RASCUNHO" | "AGUARDANDO_CONFERENCIA" | "INCLUIDO";

type Recebimento = {
  id: string;
  fornecedorNome: string | null;
  fornecedorCnpj: string | null;
  serieNota: string | null;
  numeroNota: string | null;
  emitidaEm: string | null;
  incluidoEm: string | null;
  origem: Origem;
  incluidoPorOrigem: Origem | null;
  incluidoPorNome: string | null;
  status: Situacao;
  quantidadeItens: number;
};

type Historico = {
  dados: Recebimento[];
  pagina: number;
  total: number;
  totalPaginas: number;
};

type Consulta =
  | { estado: "carregando" }
  | { estado: "erro"; mensagem: string }
  | { estado: "pronta"; historico: Historico };

const situacoes: Record<Situacao, string> = {
  RASCUNHO: "Rascunho",
  AGUARDANDO_CONFERENCIA: "Aguardando conferência",
  INCLUIDO: "Incluída",
};

const dataDaNota = new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "short",
  timeZone: "UTC",
});

const dataDaInclusao = new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "short",
  timeStyle: "short",
});

function origemVisivel(origem: Origem) {
  return origem === "AGENTE_GC" ? "Agente GC" : "Manual";
}

export default function RecebimentosCompraPage() {
  const router = useRouter();
  const [pagina, setPagina] = useState(1);
  const [autorizado, setAutorizado] = useState(false);
  const [tentativa, setTentativa] = useState(0);
  const [consulta, setConsulta] = useState<Consulta>({ estado: "carregando" });

  useEffect(() => {
    const controlador = new AbortController();

    async function carregar() {
      const token = sessionStorage.getItem("gestao.accessToken");
      if (!token) {
        router.replace("/");
        return;
      }

      try {
        const resposta = await fetch(
          `${API_URL}/recebimentos-compra?pagina=${pagina}&limite=20`,
          {
            headers: { Authorization: `Bearer ${token}` },
            cache: "no-store",
            signal: controlador.signal,
          },
        );

        if (controlador.signal.aborted) return;

        if (resposta.status === 401) {
          sessionStorage.removeItem("gestao.accessToken");
          sessionStorage.removeItem("gestao.usuario");
          router.replace("/");
          return;
        }

        if (resposta.status === 403) {
          setAutorizado(false);
          setConsulta({
            estado: "erro",
            mensagem: "O histórico está disponível para administradores e gerentes.",
          });
          return;
        }

        if (!resposta.ok) throw new Error("Falha na consulta.");

        const historico: Historico = await resposta.json();
        if (!controlador.signal.aborted) {
          setAutorizado(true);
          setConsulta({ estado: "pronta", historico });
        }
      } catch {
        if (!controlador.signal.aborted) {
          setConsulta({
            estado: "erro",
            mensagem: "Não foi possível carregar os recebimentos.",
          });
        }
      }
    }

    void carregar();
    return () => controlador.abort();
  }, [pagina, tentativa, router]);

  function mudarPagina(novaPagina: number) {
    setConsulta({ estado: "carregando" });
    setPagina(novaPagina);
  }

  function tentarNovamente() {
    setConsulta({ estado: "carregando" });
    setTentativa((atual) => atual + 1);
  }

  return (
    <div className={layout.estrutura}>
      <MenuLateral />
      <main className={layout.conteudo}>
        <div className={layout.largura}>
          <header className={layout.cabecalho}>
            <div>
              <span className={layout.sobretitulo}>COMPRAS E ESTOQUE</span>
              <h1>Recebimentos de compra</h1>
              <p>Acompanhe as notas recebidas e as entradas registradas no estoque.</p>
            </div>
          </header>

          {autorizado && (
            <ConferenciaNotasAgente apiUrl={API_URL} aoConfirmar={() => {
              setPagina(1);
              tentarNovamente();
            }} />
          )}

          {autorizado && (
            <FormularioRecebimento
              apiUrl={API_URL}
              aoConfirmar={() => {
                setPagina(1);
                tentarNovamente();
              }}
            />
          )}

          <section className={painel.cartao} aria-labelledby="titulo-historico">
            <h2 id="titulo-historico">Histórico de recebimentos</h2>

            {consulta.estado === "carregando" && (
              <p role="status">Carregando recebimentos…</p>
            )}

            {consulta.estado === "erro" && (
              <>
                <p role="alert">{consulta.mensagem}</p>
                <button
                  type="button"
                  className={painel.secundario}
                  onClick={tentarNovamente}
                >
                  Tentar novamente
                </button>
              </>
            )}

            {consulta.estado === "pronta" && (
              <>
                {consulta.historico.total === 0 ? (
                  <p>Nenhum recebimento registrado para esta empresa.</p>
                ) : (
                  <div className={styles.rolagem}>
                    <table className={styles.tabela} aria-label="Recebimentos de compra">
                      <thead>
                        <tr>
                          <th scope="col">Nota</th>
                          <th scope="col">Fornecedor</th>
                          <th scope="col">Emissão</th>
                          <th scope="col">Situação</th>
                          <th scope="col">Origem</th>
                          <th scope="col">Inclusão</th>
                          <th scope="col">Responsável</th>
                          <th scope="col">Itens</th>
                        </tr>
                      </thead>
                      <tbody>
                        {consulta.historico.dados.map((registro) => (
                          <tr key={registro.id}>
                            <td>
                              {registro.numeroNota ?? "—"}
                              {registro.serieNota && <small>Série {registro.serieNota}</small>}
                            </td>
                            <td>{registro.fornecedorNome ?? registro.fornecedorCnpj ?? "—"}</td>
                            <td>
                              {registro.emitidaEm
                                ? dataDaNota.format(new Date(registro.emitidaEm))
                                : "—"}
                            </td>
                            <td>{situacoes[registro.status]}</td>
                            <td>{origemVisivel(registro.origem)}</td>
                            <td>
                              {registro.incluidoEm
                                ? dataDaInclusao.format(new Date(registro.incluidoEm))
                                : "—"}
                            </td>
                            <td>
                              {registro.incluidoPorNome ??
                                (registro.incluidoPorOrigem === "AGENTE_GC" ? "Agente GC" : "—")}
                              {registro.incluidoPorOrigem && (
                                <small>{origemVisivel(registro.incluidoPorOrigem)}</small>
                              )}
                            </td>
                            <td>{registro.quantidadeItens}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {consulta.historico.total > 0 && (
                  <nav className={styles.paginacao} aria-label="Paginação de recebimentos">
                    <button
                      type="button"
                      className={painel.secundario}
                      disabled={pagina <= 1}
                      onClick={() => mudarPagina(pagina - 1)}
                    >
                      Anterior
                    </button>
                    <span>Página {pagina} de {consulta.historico.totalPaginas}</span>
                    <button
                      type="button"
                      className={painel.secundario}
                      disabled={pagina >= consulta.historico.totalPaginas}
                      onClick={() => mudarPagina(pagina + 1)}
                    >
                      Próxima
                    </button>
                  </nav>
                )}
              </>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}
