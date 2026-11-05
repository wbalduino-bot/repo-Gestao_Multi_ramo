"use client";

/**
 * Cadastros auxiliares para o catalogo da empresa autenticada.
 * A empresa e o perfil sao conferidos no backend pelo JWT.
 * O frontend nao envia empresaId em nenhuma requisicao.
 */
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { MenuLateral } from "../componentes/menu-lateral";
import styles from "./cadastros-produtos.module.css";

const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5433").replace(/\/$/, "");

type Categoria = { id: string; nome: string; categoriaPaiId: string | null };
type Unidade = { id: string; codigo: string; nome: string };
type RespostaErro = { message?: string | string[] };
type Sessao = { perfil: string };

function mensagemErro(dados: unknown, padrao: string): string {
  if (dados && typeof dados === "object" && "message" in dados) {
    const mensagem = (dados as RespostaErro).message;
    if (typeof mensagem === "string") return mensagem;
    if (Array.isArray(mensagem)) return mensagem.join(", ");
  }
  return padrao;
}

/** Aceita listagens simples ou paginadas, sem inventar resultados. */
function listaDaApi<T>(dados: unknown): T[] {
  if (Array.isArray(dados)) return dados as T[];
  if (dados && typeof dados === "object" && "dados" in dados) {
    const lista = (dados as { dados: unknown }).dados;
    if (Array.isArray(lista)) return lista as T[];
  }
  throw new Error("Formato inesperado na resposta de listagem.");
}

export default function CadastrosProdutosPage() {
  const router = useRouter();
  const [autorizado, setAutorizado] = useState(false);
  const [verificando, setVerificando] = useState(true);
  const [nomeEmpresa, setNomeEmpresa] = useState("Empresa autenticada");
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [unidades, setUnidades] = useState<Unidade[]>([]);
  const [carregando, setCarregando] = useState(false);
  const [salvando, setSalvando] = useState<"categoria" | "unidade" | "edicao" | "edicaoUnidade" | null>(null);
  const [erro, setErro] = useState("");
  const [sucesso, setSucesso] = useState("");
  const [nomeCategoria, setNomeCategoria] = useState("");
  const [categoriaPaiId, setCategoriaPaiId] = useState("");
  // Edição isolada do formulário de inclusão; não altera o cadastro até salvar.
  const [categoriaEditandoId, setCategoriaEditandoId] = useState<string | null>(null);
  const [nomeCategoriaEdicao, setNomeCategoriaEdicao] = useState("");
  const [paiCategoriaEdicao, setPaiCategoriaEdicao] = useState("");
  const [codigoUnidade, setCodigoUnidade] = useState("");
  const [nomeUnidade, setNomeUnidade] = useState("");
  // Edição separada do cadastro; não modifica a unidade até o usuário salvar.
  const [unidadeEditandoId, setUnidadeEditandoId] = useState<string | null>(null);
  const [codigoUnidadeEdicao, setCodigoUnidadeEdicao] = useState("");
  const [nomeUnidadeEdicao, setNomeUnidadeEdicao] = useState("");

  const encerrar = useCallback(() => {
    sessionStorage.removeItem("gestao.accessToken");
    sessionStorage.removeItem("gestao.usuario");
    router.replace("/");
  }, [router]);

  const requisitar = useCallback(async (caminho: string, opcoes: RequestInit = {}) => {
    const token = sessionStorage.getItem("gestao.accessToken");
    if (!token) { encerrar(); throw new Error("Sessão expirada."); }
    const resposta = await fetch(`${API_URL}${caminho}`, {
      ...opcoes,
      cache: "no-store",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
        ...(opcoes.body ? { "Content-Type": "application/json" } : {}),
        ...opcoes.headers,
      },
    });
    if (resposta.status === 401) { encerrar(); throw new Error("Sessão expirada."); }
    const dados: unknown = await resposta.json().catch(() => null);
    if (!resposta.ok) throw new Error(mensagemErro(dados, `Erro HTTP ${resposta.status}.`));
    return dados;
  }, [encerrar]);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro("");
    try {
      const [listaCategorias, listaUnidades] = await Promise.all([
        requisitar("/categorias"),
        requisitar("/unidades"),
      ]);
      setCategorias(listaDaApi<Categoria>(listaCategorias));
      setUnidades(listaDaApi<Unidade>(listaUnidades));
    } catch (falha) {
      setErro(falha instanceof Error ? falha.message : "Não foi possível carregar os cadastros.");
    } finally {
      setCarregando(false);
    }
  }, [requisitar]);

  useEffect(() => {
    let ativo = true;
    try {
      const usuario = JSON.parse(sessionStorage.getItem("gestao.usuario") ?? "{}") as { empresaNome?: unknown };
      if (typeof usuario.empresaNome === "string" && usuario.empresaNome.trim()) {
        setNomeEmpresa(usuario.empresaNome.trim());
      }
    } catch { /* O nome exibido nao substitui a verificacao de identidade. */ }
    requisitar("/usuarios/me")
      .then((dados) => {
        if (!ativo) return;
        const perfil = (dados as Sessao | null)?.perfil;
        setAutorizado(perfil === "ADMINISTRADOR" || perfil === "GERENTE");
      })
      .catch((falha) => { if (ativo) setErro(falha instanceof Error ? falha.message : "Acesso não autorizado."); })
      .finally(() => { if (ativo) setVerificando(false); });
    return () => { ativo = false; };
  }, [requisitar]);

  useEffect(() => {
    if (autorizado) void carregar();
  }, [autorizado, carregar]);

  async function criarCategoria(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    setErro(""); setSucesso("");
    if (!nomeCategoria.trim()) { setErro("Informe o nome da categoria."); return; }
    setSalvando("categoria");
    try {
      await requisitar("/categorias", {
        method: "POST",
        body: JSON.stringify({
          nome: nomeCategoria.trim(),
          ...(categoriaPaiId ? { categoriaPaiId } : {}),
        }),
      });
      setNomeCategoria(""); setCategoriaPaiId("");
      setSucesso("Categoria cadastrada com sucesso.");
      await carregar();
    } catch (falha) {
      setErro(falha instanceof Error ? falha.message : "Não foi possível cadastrar a categoria.");
    } finally { setSalvando(null); }
  }

  /** Abre a edição com os valores atuais, sem salvar alterações antecipadamente. */
  function iniciarEdicao(categoria: Categoria) {
    setCategoriaEditandoId(categoria.id);
    setNomeCategoriaEdicao(categoria.nome);
    setPaiCategoriaEdicao(categoria.categoriaPaiId ?? "");
    setErro("");
    setSucesso("");
  }

  /** Corrige nome e categoria-pai sem alterar o ID nem produtos vinculados. */
  async function salvarEdicaoCategoria(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    if (!categoriaEditandoId || !nomeCategoriaEdicao.trim()) {
      setErro("Informe um nome válido para a categoria.");
      return;
    }
    setSalvando("edicao");
    setErro("");
    setSucesso("");
    try {
      await requisitar(`/categorias/${encodeURIComponent(categoriaEditandoId)}`, {
        method: "PATCH",
        body: JSON.stringify({
          nome: nomeCategoriaEdicao.trim(),
          categoriaPaiId: paiCategoriaEdicao || null,
        }),
      });
      setCategoriaEditandoId(null);
      setSucesso("Categoria atualizada com sucesso.");
      await carregar();
    } catch (falha) {
      setErro(falha instanceof Error ? falha.message : "Não foi possível editar a categoria.");
    } finally {
      setSalvando(null);
    }
  }

  /** Carrega os dados da unidade escolhida no formulário de edição. */
  function iniciarEdicaoUnidade(unidade: Unidade) {
    setUnidadeEditandoId(unidade.id);
    setCodigoUnidadeEdicao(unidade.codigo);
    setNomeUnidadeEdicao(unidade.nome);
    setErro("");
    setSucesso("");
  }

  /** Salva somente os campos corrigidos; o backend protege unidades em uso. */
  async function salvarEdicaoUnidade(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    if (!unidadeEditandoId || !codigoUnidadeEdicao.trim() || !nomeUnidadeEdicao.trim()) {
      setErro("Informe o código e a descrição da unidade.");
      return;
    }
    const anterior = unidades.find((item) => item.id === unidadeEditandoId);
    if (!anterior) { setErro("Unidade não encontrada na listagem."); return; }
    const codigo = codigoUnidadeEdicao.trim().toUpperCase();
    const nome = nomeUnidadeEdicao.trim();
    if (codigo === anterior.codigo && nome === anterior.nome) {
      setErro("Nenhuma alteração foi informada.");
      return;
    }
    setSalvando("edicaoUnidade");
    setErro("");
    setSucesso("");
    try {
      await requisitar(`/unidades/${encodeURIComponent(unidadeEditandoId)}`, {
        method: "PATCH",
        body: JSON.stringify({ codigo, nome }),
      });
      setUnidadeEditandoId(null);
      setSucesso("Unidade de medida atualizada com sucesso.");
      await carregar();
    } catch (falha) {
      setErro(falha instanceof Error ? falha.message : "Não foi possível atualizar a unidade.");
    } finally {
      setSalvando(null);
    }
  }

  async function criarUnidade(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    setErro(""); setSucesso("");
    if (!codigoUnidade.trim() || !nomeUnidade.trim()) {
      setErro("Informe o código e o nome da unidade."); return;
    }
    setSalvando("unidade");
    try {
      await requisitar("/unidades", {
        method: "POST",
        body: JSON.stringify({ codigo: codigoUnidade.trim().toUpperCase(), nome: nomeUnidade.trim() }),
      });
      setCodigoUnidade(""); setNomeUnidade("");
      setSucesso("Unidade cadastrada com sucesso.");
      await carregar();
    } catch (falha) {
      setErro(falha instanceof Error ? falha.message : "Não foi possível cadastrar a unidade.");
    } finally { setSalvando(null); }
  }

  return (
    <div className={styles.layout}>
      <MenuLateral nomeEmpresa={nomeEmpresa} />
      <main className={styles.main}>
        <header className={styles.cabecalho}>
          <h1>Categorias e unidades</h1>
          <p>Organize o catálogo e as unidades de controle dos produtos da sua empresa.</p>
        </header>
        {verificando ? <p>Verificando permissões...</p> : !autorizado ? (
          <p role="alert" className={styles.erro}>Acesso restrito a administradores e gerentes. {erro}</p>
        ) : (
          <>
            {erro && <p role="alert" className={styles.erro}>{erro}</p>}
            {sucesso && <p role="status" className={styles.sucesso}>{sucesso}</p>}
            <div className={styles.colunas}>
              <section className={styles.cartao} aria-labelledby="titulo-categorias">
                <h2 id="titulo-categorias">Categorias</h2>
                <p>Crie categorias principais ou subcategorias.</p>
                <form onSubmit={criarCategoria} className={styles.formulario}>
                  <label>Nome da categoria
                    <input required maxLength={150} value={nomeCategoria} onChange={(e) => setNomeCategoria(e.target.value)} placeholder="Ex.: Bebidas" disabled={!!salvando} />
                  </label>
                  <label>Categoria-pai (opcional)
                    <select value={categoriaPaiId} onChange={(e) => setCategoriaPaiId(e.target.value)} disabled={!!salvando}>
                      <option value="">Categoria principal</option>
                      {categorias.map((categoria) => <option key={categoria.id} value={categoria.id}>{categoria.nome}</option>)}
                    </select>
                  </label>
                  <button type="submit" disabled={!!salvando}>{salvando === "categoria" ? "Salvando..." : "Cadastrar categoria"}</button>
                </form>
                <h3>Categorias cadastradas ({categorias.length})</h3>
                {carregando ? <p>Carregando...</p> : categorias.length === 0 ? <p>Nenhuma categoria cadastrada.</p> : (
                  <ul className={styles.lista}>
                    {categorias.map((categoria) => {
                      const pai = categorias.find((item) => item.id === categoria.categoriaPaiId);
                      return <li key={categoria.id}>
                        <strong>{categoria.nome}</strong>
                        {pai && <small>Subcategoria de {pai.nome}</small>}
                        <button type="button" disabled={!!salvando} onClick={() => iniciarEdicao(categoria)}
                          style={{ marginLeft: 12, border: "1px solid #bfd0e2", borderRadius: 7, background: "#f0f5fb", padding: "6px 11px", color: "#153b64", cursor: "pointer" }}>
                          Editar
                        </button>
                        {categoriaEditandoId === categoria.id && (
                          <form onSubmit={salvarEdicaoCategoria} className={styles.formulario}
                            style={{ marginTop: 12, padding: 12, border: "1px solid #dce5f0", borderRadius: 8 }}>
                            <label>Nome da categoria
                              <input required maxLength={150} value={nomeCategoriaEdicao}
                                onChange={(e) => setNomeCategoriaEdicao(e.target.value)} disabled={!!salvando} />
                            </label>
                            <label>Categoria-pai (opcional)
                              <select value={paiCategoriaEdicao} onChange={(e) => setPaiCategoriaEdicao(e.target.value)} disabled={!!salvando}>
                                <option value="">Categoria principal</option>
                                {categorias.filter((outra) => outra.id !== categoria.id).map((outra) => (
                                  <option key={outra.id} value={outra.id}>{outra.nome}</option>
                                ))}
                              </select>
                            </label>
                            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                              <button type="submit" disabled={!!salvando}>{salvando === "edicao" ? "Salvando..." : "Salvar alteração"}</button>
                              <button type="button" disabled={!!salvando} onClick={() => setCategoriaEditandoId(null)}
                                style={{ background: "#e7edf4", color: "#153b64" }}>Cancelar</button>
                            </div>
                          </form>
                        )}
                      </li>;
                    })}
                  </ul>
                )}
              </section>
              <section className={styles.cartao} aria-labelledby="titulo-unidades">
                <h2 id="titulo-unidades">Unidades de medida</h2>
                <p>Defina como cada tipo de produto será controlado no estoque.</p>
                <form onSubmit={criarUnidade} className={styles.formulario}>
                  <label>Código da unidade
                    <input required maxLength={12} pattern="[A-Za-z0-9_-]+" value={codigoUnidade} onChange={(e) => setCodigoUnidade(e.target.value.toUpperCase())} placeholder="Ex.: UN, KG, L" disabled={!!salvando} />
                  </label>
                  <label>Descrição
                    <input required maxLength={100} value={nomeUnidade} onChange={(e) => setNomeUnidade(e.target.value)} placeholder="Ex.: Quilograma" disabled={!!salvando} />
                  </label>
                  <button type="submit" disabled={!!salvando}>{salvando === "unidade" ? "Salvando..." : "Cadastrar unidade"}</button>
                </form>
                <h3>Unidades cadastradas ({unidades.length})</h3>
                {carregando ? <p>Carregando...</p> : unidades.length === 0 ? <p>Nenhuma unidade cadastrada.</p> : (
                  <ul className={styles.lista}>
                    {unidades.map((unidade) => (
                      <li key={unidade.id}>
                        <strong>{unidade.codigo}</strong>
                        <small>{unidade.nome}</small>
                        <button type="button" disabled={!!salvando} onClick={() => iniciarEdicaoUnidade(unidade)}
                          style={{ marginLeft: 12, border: "1px solid #bfd0e2", borderRadius: 7, background: "#f0f5fb", padding: "6px 11px", color: "#153b64", cursor: "pointer" }}>
                          Editar
                        </button>
                        {unidadeEditandoId === unidade.id && (
                          <form onSubmit={salvarEdicaoUnidade} className={styles.formulario}
                            style={{ marginTop: 12, padding: 12, border: "1px solid #dce5f0", borderRadius: 8 }}>
                            <label>Código da unidade
                              <input required maxLength={12} pattern="[A-Za-z0-9_-]+" value={codigoUnidadeEdicao}
                                onChange={(e) => setCodigoUnidadeEdicao(e.target.value.toUpperCase())} disabled={!!salvando} />
                            </label>
                            <label>Descrição
                              <input required maxLength={100} value={nomeUnidadeEdicao}
                                onChange={(e) => setNomeUnidadeEdicao(e.target.value)} disabled={!!salvando} />
                            </label>
                            <small>O código não poderá ser alterado se a unidade já estiver vinculada a produtos.</small>
                            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                              <button type="submit" disabled={!!salvando}>
                                {salvando === "edicaoUnidade" ? "Salvando..." : "Salvar alteração"}
                              </button>
                              <button type="button" disabled={!!salvando} onClick={() => setUnidadeEditandoId(null)}
                                style={{ background: "#e7edf4", color: "#153b64" }}>Cancelar</button>
                            </div>
                          </form>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
