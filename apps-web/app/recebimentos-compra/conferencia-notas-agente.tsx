"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import painel from "../configuracao-fiscal/configuracao-fiscal.module.css";
import styles from "./recebimentos-compra.module.css";
import { FormularioRecebimento, type NotaAgente, type UnidadeEstoque, type CategoriaPreco, type VinculoNotaAgente } from "./formulario-recebimento";

import { RevisaoNotaOcr } from "./revisao-nota-ocr";
import { ReprocessarNotaVazia } from "./reprocessar-nota-vazia";
import { notaOcrRevisada } from "./formulario-recebimento";

type NotaPendente = {
  id: string;
  nomeOriginal: string;
  versaoExtracao: string;
  extracao: NotaAgente | null;
};

type Resultado = {
  dados: NotaPendente[];
  temProxima: boolean;
  unidades: UnidadeEstoque[];
  categorias: CategoriaPreco[];
};

export function ConferenciaNotasAgente({ apiUrl, aoConfirmar }: {
  apiUrl: string;
  aoConfirmar: () => void;
}) {
  const router = useRouter();
  const [pagina, setPagina] = useState(1);
  const [tentativa, setTentativa] = useState(0);
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [erro, setErro] = useState("");
  const [aviso, setAviso] = useState("");
  const [abrindoId, setAbrindoId] = useState<string | null>(null);
  const [reprocessando, setReprocessando] = useState(false);
  const [aberta, setAberta] = useState<{
    id: string;
    nota: NotaAgente;
    unidades: UnidadeEstoque[];
    categorias: CategoriaPreco[];
    vinculos: VinculoNotaAgente[];
  } | null>(null);

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
          `${apiUrl}/recebimentos-compra/notas-pendentes?pagina=${pagina}`,
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
        if (!resposta.ok) throw new Error("Falha na consulta.");
        const dados: Omit<Resultado, "categorias"> = await resposta.json();
        const respostaCategorias = await fetch(apiUrl + "/categorias", {
          headers: { Authorization: "Bearer " + token },
          cache: "no-store",
          signal: controlador.signal,
        });
        if (controlador.signal.aborted) return;
        if (respostaCategorias.status === 401) {
          sessionStorage.removeItem("gestao.accessToken");
          sessionStorage.removeItem("gestao.usuario");
          router.replace("/");
          return;
        }
        if (!respostaCategorias.ok) throw new Error("Falha na consulta de categorias.");
        const lista = await respostaCategorias.json();
        const categorias = Array.isArray(lista) ? lista : lista?.dados;
        if (!Array.isArray(categorias)) throw new Error("Resposta inválida de categorias.");
        if (!controlador.signal.aborted) setResultado({ ...dados, categorias });
      } catch {
        if (!controlador.signal.aborted) {
          setErro("Não foi possível consultar as notas pendentes do Agente GC.");
        }
      }
    }

    void carregar();
    return () => controlador.abort();
  }, [apiUrl, pagina, tentativa, router]);

  async function abrirNota(
    id: string,
    nota: NotaAgente,
    unidades: UnidadeEstoque[],
    categorias: CategoriaPreco[],
  ) {
    if (aberta || abrindoId || reprocessando) return;

    const token = sessionStorage.getItem("gestao.accessToken");
    if (!token) {
      router.replace("/");
      return;
    }

    setAbrindoId(id);
    setErro("");
    setAviso("");

    try {
      const resposta = await fetch(
        `${apiUrl}/recebimentos-compra/notas-pendentes/${encodeURIComponent(id)}/vinculos`,
        {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        },
      );

      if (resposta.status === 401) {
        sessionStorage.removeItem("gestao.accessToken");
        sessionStorage.removeItem("gestao.usuario");
        router.replace("/");
        return;
      }

      if (!resposta.ok) {
        throw new Error("Falha ao consultar vínculos.");
      }

      const dados: unknown = await resposta.json();

      if (
        !dados ||
        typeof dados !== "object" ||
        !("dados" in dados) ||
        !Array.isArray(dados.dados)
      ) {
        throw new Error("Resposta de vínculos inválida.");
      }

      const vinculos: VinculoNotaAgente[] = dados.dados;

      if (
        !vinculos.every(({ indiceNota, produto }) =>
          Number.isInteger(indiceNota) &&
          indiceNota >= 0 &&
          indiceNota < nota.itens.length &&
          produto &&
          typeof produto.id === "string" &&
          typeof produto.nome === "string" &&
          typeof produto.sku === "string"
        ) ||
        new Set(vinculos.map(({ indiceNota }) => indiceNota)).size !== vinculos.length
      ) {
        throw new Error("Vínculos inconsistentes.");
      }

      setAberta({ id, nota, unidades, categorias, vinculos });
    } catch {
      setErro(
        "Não foi possível consultar os vínculos da nota. " +
        "A conferência não foi aberta para evitar cadastros duplicados.",
      );
    } finally {
      setAbrindoId(null);
    }
  }

  function carregarPagina(novaPagina: number) {
    setResultado(null);
    setErro("");
    setPagina(novaPagina);
    setTentativa((atual) => atual + 1);
  }

  return (
    <>
      <section className={painel.cartao} aria-labelledby="titulo-notas-agente">
        <h2 id="titulo-notas-agente">Notas do Agente GC</h2>

        {erro && <p role="alert">{erro}</p>}
        {aviso && <p role="status">{aviso}</p>}
        {!resultado && !erro && <p role="status">Carregando notas pendentes…</p>}

        {resultado?.dados.length === 0 && <p>Nenhuma nota nesta página.</p>}
        {!!resultado?.dados.length && (
          <div className={styles.rolagem}>
            <table className={styles.tabela} aria-label="Notas pendentes">
              <thead>
                <tr>
                  <th scope="col">Nota</th>
                  <th scope="col">Fornecedor</th>
                  <th scope="col">Itens</th>
                  <th scope="col">Conferência</th>
                </tr>
              </thead>
              <tbody>
                {resultado.dados.map(({ id, nomeOriginal, extracao, versaoExtracao }) => (
                  <tr key={id}>
                    <td>{extracao?.numeroNota ?? nomeOriginal}</td>
                    <td>{extracao?.fornecedorNome ?? "—"}</td>
                    <td>{extracao?.itens?.length ?? "—"}</td>
                    <td>
                      {extracao?.itens?.length ? (
                        <button type="button" className={painel.secundario}
                          disabled={aberta !== null || abrindoId !== null || reprocessando}
                          onClick={() => void abrirNota(
                            id,
                            extracao,
                            resultado.unidades ?? [],
                            resultado.categorias,
                          )}>
                          {abrindoId === id
                            ? "Consultando vínculos…"
                            : aberta?.id === id
                              ? "Nota aberta"
                              : "Conferir nota"}
                        </button>
                      ) : <>
                        <span>Prévia indisponível </span>
                        {typeof versaoExtracao === "string" && <ReprocessarNotaVazia
                          apiUrl={apiUrl} arquivoId={id} versaoExtracao={versaoExtracao}
                          bloqueado={aberta !== null || abrindoId !== null || reprocessando}
                          aoOcupar={setReprocessando}
                          aoConcluir={() => {
                            setReprocessando(false);
                            carregarPagina(pagina);
                            setAviso("Leitura atualizada. Abra a nota e confira os dados no documento original.");
                          }}
                        />}
                      </>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <nav className={styles.paginacao} aria-label="Paginação de notas pendentes">
          <button type="button" className={painel.secundario}
            disabled={reprocessando || !resultado || pagina === 1}
            onClick={() => carregarPagina(pagina - 1)}>Anterior</button>
          <span>Página {pagina}</span>
          <button type="button" className={painel.secundario}
            disabled={reprocessando || !resultado?.temProxima}
            onClick={() => carregarPagina(pagina + 1)}>Próxima</button>
          <button type="button" className={painel.secundario}
            disabled={reprocessando || (!resultado && !erro)}
            onClick={() => carregarPagina(pagina)}>Atualizar notas</button>
        </nav>
      </section>

      {aberta && (aberta.nota.modoExtracao === "OCR_PILOTO" && !notaOcrRevisada(aberta.nota) ? (
        <RevisaoNotaOcr
          key={aberta.id}
          apiUrl={apiUrl}
          notaId={aberta.id}
          nota={aberta.nota}
          aoSalvar={() => {
            setAberta(null);
            carregarPagina(pagina);
            setAviso("Revisão fiscal salva. Abra a nota novamente para conferir produtos e confirmar a entrada no estoque.");
          }}
          aoFechar={() => setAberta(null)}
        />
      ) : (
        <FormularioRecebimento
          key={aberta.id}
          apiUrl={apiUrl}
          nota={aberta.nota}
          notaId={aberta.id}
          unidades={aberta.unidades}
          categorias={aberta.categorias}
          vinculos={aberta.vinculos}
          aoConfirmar={() => {
            setAberta(null);
            setAviso("Nota confirmada e estoque atualizado.");
            carregarPagina(1);
            aoConfirmar();
          }}
          aoFechar={() => setAberta(null)}
        />
      ))}
    </>
  );
}
