"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { MenuLateral } from "../componentes/menu-lateral";
import styles from "./usuarios.module.css";

// Mantém a mesma configuração de API já utilizada pelas telas existentes.
const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5433").replace(/\/$/, "");
const LIMITE_POR_PAGINA = 10;

type Perfil = "ADMINISTRADOR" | "GERENTE" | "CAIXA" | "ATENDENTE" | "GARCOM";
type Situacao = "" | "true" | "false";

type Usuario = {
  id: string;
  nome: string;
  email: string;
  perfil: Perfil;
  ativo: boolean;
  criadoEm?: string;
};

type Sessao = {
  usuarioId: string;
  empresaId: string;
  perfil: Perfil;
};

type ListagemUsuarios = {
  dados: Usuario[];
  total: number;
  pagina: number;
  limite: number;
  totalPaginas: number;
};

type Filtros = {
  busca: string;
  ativo: Situacao;
  perfil: "" | Perfil;
};

type Formulario = {
  nome: string;
  email: string;
  senha: string;
  perfil: Perfil;
};

const PERFIS: { valor: Perfil; rotulo: string }[] = [
  { valor: "ADMINISTRADOR", rotulo: "Administrador" },
  { valor: "GERENTE", rotulo: "Gerente" },
  { valor: "CAIXA", rotulo: "Caixa" },
  { valor: "ATENDENTE", rotulo: "Atendente" },
  { valor: "GARCOM", rotulo: "Garçom" },
];

const PERFIS_OPERACIONAIS: Perfil[] = ["CAIXA", "ATENDENTE", "GARCOM"];
const FILTROS_INICIAIS: Filtros = { busca: "", ativo: "", perfil: "" };

function rotuloPerfil(perfil: string): string {
  return PERFIS.find((opcao) => opcao.valor === perfil)?.rotulo ?? perfil;
}

function obterMensagemErro(resposta: unknown, padrao: string): string {
  if (resposta && typeof resposta === "object" && "message" in resposta) {
    const mensagem = (resposta as { message?: unknown }).message;
    if (typeof mensagem === "string") return mensagem;
    if (Array.isArray(mensagem)) return mensagem.filter((item) => typeof item === "string").join(", ");
  }
  return padrao;
}

async function lerJson(resposta: Response): Promise<unknown> {
  return resposta.json().catch(() => null);
}

function formularioVazio(perfil: Perfil): Formulario {
  return {
    nome: "",
    email: "",
    senha: "",
    perfil: perfil === "GERENTE" ? "ATENDENTE" : "CAIXA",
  };
}

export default function PaginaUsuarios() {
  const router = useRouter();
  const [identidade, setIdentidade] = useState<Sessao | null>(null);
  const [verificandoAcesso, setVerificandoAcesso] = useState(true);
  const [acessoNegado, setAcessoNegado] = useState(false);
  const [carregandoLista, setCarregandoLista] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [alterandoId, setAlterandoId] = useState<string | null>(null);
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [total, setTotal] = useState(0);
  const [pagina, setPagina] = useState(1);
  const [totalPaginas, setTotalPaginas] = useState(1);
  const [filtros, setFiltros] = useState<Filtros>(FILTROS_INICIAIS);
  const [filtrosAplicados, setFiltrosAplicados] = useState<Filtros>(FILTROS_INICIAIS);
  const [erroLista, setErroLista] = useState("");
  const [aviso, setAviso] = useState("");
  const [formularioAberto, setFormularioAberto] = useState(false);
  const [edicaoId, setEdicaoId] = useState<string | null>(null);
  const [formulario, setFormulario] = useState<Formulario>(formularioVazio("ADMINISTRADOR"));
  const [erroFormulario, setErroFormulario] = useState("");

  // Elimina as credenciais locais quando o backend rejeita a sessão.
  const encerrarSessaoInvalida = useCallback(() => {
    sessionStorage.removeItem("gestao.accessToken");
    sessionStorage.removeItem("gestao.usuario");
    router.replace("/");
  }, [router]);

  const consultarUsuarios = useCallback(async (paginaDestino: number, filtrosDestino: Filtros) => {
    const token = sessionStorage.getItem("gestao.accessToken");
    if (!token) {
      encerrarSessaoInvalida();
      return;
    }

    setCarregandoLista(true);
    setErroLista("");

    try {
      const parametros = new URLSearchParams({
        pagina: String(paginaDestino),
        limite: String(LIMITE_POR_PAGINA),
      });
      if (filtrosDestino.busca.trim()) parametros.set("busca", filtrosDestino.busca.trim());
      if (filtrosDestino.ativo) parametros.set("ativo", filtrosDestino.ativo);
      if (filtrosDestino.perfil) parametros.set("perfil", filtrosDestino.perfil);

      const resposta = await fetch(`${API_URL}/usuarios?${parametros.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const corpo = await lerJson(resposta);

      if (resposta.status === 401) {
        encerrarSessaoInvalida();
        return;
      }
      if (resposta.status === 403) {
        setAcessoNegado(true);
        return;
      }
      if (!resposta.ok) {
        throw new Error(obterMensagemErro(corpo, "Não foi possível consultar os usuários."));
      }

      const dados = corpo as Partial<ListagemUsuarios> | null;
      if (!dados || !Array.isArray(dados.dados)) {
        throw new Error("A API retornou um formato inesperado para a lista de usuários.");
      }

      setUsuarios(dados.dados);
      setTotal(typeof dados.total === "number" ? dados.total : dados.dados.length);
      setPagina(paginaDestino);
      setTotalPaginas(
        typeof dados.totalPaginas === "number"
          ? Math.max(1, dados.totalPaginas)
          : Math.max(1, Math.ceil((dados.total ?? dados.dados.length) / LIMITE_POR_PAGINA)),
      );
    } catch (erro) {
      setErroLista(erro instanceof Error ? erro.message : "Não foi possível consultar os usuários.");
    } finally {
      setCarregandoLista(false);
    }
  }, [encerrarSessaoInvalida]);

  // Obtém o perfil diretamente do backend antes de permitir consultas ou cadastros.
  useEffect(() => {
    let desmontado = false;

    async function verificarSessao() {
      const token = sessionStorage.getItem("gestao.accessToken");
      if (!token) {
        encerrarSessaoInvalida();
        return;
      }

      try {
        const resposta = await fetch(`${API_URL}/usuarios/me`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        });
        if (desmontado) return;
        if (resposta.status === 401) {
          encerrarSessaoInvalida();
          return;
        }
        if (!resposta.ok) throw new Error("Não foi possível verificar suas permissões.");

        const dados = (await lerJson(resposta)) as Sessao | null;
        if (desmontado) return;
        if (!dados?.usuarioId || !dados.empresaId) {
          throw new Error("A API não retornou uma identidade válida.");
        }
        if (dados.perfil !== "ADMINISTRADOR" && dados.perfil !== "GERENTE") {
          setAcessoNegado(true);
          return;
        }
        setIdentidade(dados);
        await consultarUsuarios(1, FILTROS_INICIAIS);
      } catch (erro) {
        if (!desmontado) {
          setErroLista(erro instanceof Error ? erro.message : "Erro ao verificar acesso.");
        }
      } finally {
        if (!desmontado) setVerificandoAcesso(false);
      }
    }

    void verificarSessao();
    return () => { desmontado = true; };
  }, [consultarUsuarios, encerrarSessaoInvalida]);

  const perfisPermitidos = identidade?.perfil === "GERENTE"
    ? PERFIS.filter((opcao) => PERFIS_OPERACIONAIS.includes(opcao.valor))
    : PERFIS;

  function abrirCadastro() {
    if (!identidade) return;
    setFormulario(formularioVazio(identidade.perfil));
    setEdicaoId(null);
    setErroFormulario("");
    setAviso("");
    setFormularioAberto(true);
  }

  function abrirEdicao(usuario: Usuario) {
    if (!identidade) return;
    if (identidade.perfil === "GERENTE" && !PERFIS_OPERACIONAIS.includes(usuario.perfil)) return;
    setFormulario({
      nome: usuario.nome,
      email: usuario.email,
      senha: "", // A senha atual nunca é recuperada nem exibida.
      perfil: usuario.perfil,
    });
    setEdicaoId(usuario.id);
    setErroFormulario("");
    setAviso("");
    setFormularioAberto(true);
  }

  async function salvarUsuario(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    if (!identidade || salvando) return;
    const token = sessionStorage.getItem("gestao.accessToken");
    if (!token) {
      encerrarSessaoInvalida();
      return;
    }

    setSalvando(true);
    setErroFormulario("");

    try {
      const corpo: { nome: string; email: string; perfil: Perfil; senha?: string } = {
        nome: formulario.nome.trim(),
        email: formulario.email.trim().toLowerCase(),
        perfil: formulario.perfil,
      };
      // Na edição, só atualiza a senha quando uma nova for informada.
      if (!edicaoId || formulario.senha.length > 0) corpo.senha = formulario.senha;

      const resposta = await fetch(
        edicaoId ? `${API_URL}/usuarios/${edicaoId}` : `${API_URL}/usuarios`,
        {
          method: edicaoId ? "PATCH" : "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(corpo),
        },
      );
      const retorno = await lerJson(resposta);
      if (resposta.status === 401) {
        encerrarSessaoInvalida();
        return;
      }
      if (!resposta.ok) {
        throw new Error(obterMensagemErro(retorno, "Não foi possível salvar o usuário."));
      }

      setFormularioAberto(false);
      setFormulario(formularioVazio(identidade.perfil));
      setAviso(edicaoId ? "Usuário atualizado com sucesso." : "Usuário cadastrado com sucesso.");
      await consultarUsuarios(edicaoId ? pagina : 1, filtrosAplicados);
    } catch (erro) {
      setErroFormulario(erro instanceof Error ? erro.message : "Não foi possível salvar o usuário.");
    } finally {
      setSalvando(false);
    }
  }

  async function alterarSituacao(usuario: Usuario) {
    if (!identidade || alterandoId) return;
    if (usuario.id === identidade.usuarioId) return;
    if (identidade.perfil === "GERENTE" && !PERFIS_OPERACIONAIS.includes(usuario.perfil)) return;

    const novaSituacao = !usuario.ativo;
    const confirmacao = window.confirm(
      `Deseja ${novaSituacao ? "ativar" : "desativar"} o usuário ${usuario.nome}?`,
    );
    if (!confirmacao) return;

    const token = sessionStorage.getItem("gestao.accessToken");
    if (!token) {
      encerrarSessaoInvalida();
      return;
    }

    setAlterandoId(usuario.id);
    setErroLista("");
    setAviso("");
    try {
      const resposta = await fetch(`${API_URL}/usuarios/${usuario.id}/ativacao`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ ativo: novaSituacao }),
      });
      const retorno = await lerJson(resposta);
      if (resposta.status === 401) {
        encerrarSessaoInvalida();
        return;
      }
      if (!resposta.ok) {
        throw new Error(obterMensagemErro(retorno, "Não foi possível alterar a situação do usuário."));
      }
      setAviso(`Usuário ${novaSituacao ? "ativado" : "desativado"} com sucesso.`);
      await consultarUsuarios(pagina, filtrosAplicados);
    } catch (erro) {
      setErroLista(erro instanceof Error ? erro.message : "Erro ao alterar situação.");
    } finally {
      setAlterandoId(null);
    }
  }

  function pesquisar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    setAviso("");
    setFiltrosAplicados(filtros);
    void consultarUsuarios(1, filtros);
  }

  function limparPesquisa() {
    setFiltros(FILTROS_INICIAIS);
    setFiltrosAplicados(FILTROS_INICIAIS);
    setAviso("");
    void consultarUsuarios(1, FILTROS_INICIAIS);
  }

  return (
    <div className={styles.estrutura}>
      <MenuLateral />
      <main className={styles.conteudo}>
        <div className={styles.largura}>
          <header className={styles.cabecalho}>
            <div>
              <span className={styles.sobretitulo}>GESTÃO DE ACESSOS</span>
              <h1>Usuários</h1>
              <p>Administre os funcionários e seus níveis de acesso à empresa.</p>
            </div>
            {identidade && !acessoNegado && (
              <button className={styles.botaoPrimario} type="button" onClick={abrirCadastro}>
                + Novo usuário
              </button>
            )}
          </header>

          {verificandoAcesso ? (
            <section className={styles.cartao} role="status">Verificando sua sessão e permissões...</section>
          ) : acessoNegado ? (
            <section className={styles.cartao}>
              <h2>Acesso restrito</h2>
              <p>Somente administradores e gerentes autorizados podem acessar a gestão de usuários.</p>
              <button className={styles.botaoSecundario} onClick={() => router.push("/dashboard")} type="button">
                Voltar ao dashboard
              </button>
            </section>
          ) : identidade ? (
            <>
              <div className={styles.resumo}>
                <div className={styles.indicador}>
                  <span>Usuários encontrados</span>
                  <strong>{total}</strong>
                </div>
                <div className={styles.indicador}>
                  <span>Seu perfil de acesso</span>
                  <strong>{rotuloPerfil(identidade.perfil)}</strong>
                </div>
              </div>

              {aviso && <p className={styles.sucesso} role="status">{aviso}</p>}

              {formularioAberto && (
                <section className={styles.cartao} aria-label="Formulário de usuário">
                  <div className={styles.secaoCabecalho}>
                    <div>
                      <h2>{edicaoId ? "Editar usuário" : "Cadastrar usuário"}</h2>
                      <p>{edicaoId ? "Altere os dados permitidos para esta conta." : "Informe os dados do novo funcionário."}</p>
                    </div>
                    <button className={styles.botaoTexto} type="button" disabled={salvando} onClick={() => setFormularioAberto(false)}>
                      Fechar
                    </button>
                  </div>
                  <form onSubmit={salvarUsuario}>
                    <div className={styles.gradeFormulario}>
                      <label className={styles.campo}>
                        Nome completo
                        <input required minLength={3} maxLength={120} value={formulario.nome}
                          onChange={(evento) => setFormulario({ ...formulario, nome: evento.target.value })} />
                      </label>
                      <label className={styles.campo}>
                        E-mail
                        <input required type="email" maxLength={160} autoComplete="off" value={formulario.email}
                          onChange={(evento) => setFormulario({ ...formulario, email: evento.target.value })} />
                      </label>
                      <label className={styles.campo}>
                        {edicaoId ? "Nova senha (opcional)" : "Senha inicial"}
                        <input type="password" autoComplete="new-password" minLength={8} maxLength={128}
                          required={!edicaoId} value={formulario.senha}
                          placeholder={edicaoId ? "Deixe em branco para manter a atual" : "Mínimo de 8 caracteres"}
                          onChange={(evento) => setFormulario({ ...formulario, senha: evento.target.value })} />
                      </label>
                      <label className={styles.campo}>
                        Perfil de acesso
                        <select value={formulario.perfil}
                          onChange={(evento) => setFormulario({ ...formulario, perfil: evento.target.value as Perfil })}>
                          {perfisPermitidos.map((opcao) => (
                            <option key={opcao.valor} value={opcao.valor}>{opcao.rotulo}</option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <p className={styles.observacao}>O cadastro será vinculado automaticamente à empresa autenticada. A senha não será exibida na listagem.</p>
                    {erroFormulario && <p className={styles.erro} role="alert">{erroFormulario}</p>}
                    <div className={styles.acoesFormulario}>
                      <button type="button" className={styles.botaoSecundario} disabled={salvando} onClick={() => setFormularioAberto(false)}>
                        Cancelar
                      </button>
                      <button type="submit" className={styles.botaoPrimario} disabled={salvando}>
                        {salvando ? "Salvando..." : edicaoId ? "Salvar alterações" : "Cadastrar usuário"}
                      </button>
                    </div>
                  </form>
                </section>
              )}

              <section className={styles.cartao} aria-label="Listagem de usuários">
                <div className={styles.secaoCabecalho}>
                  <div>
                    <h2>Equipe cadastrada</h2>
                    <p>Pesquise e gerencie os usuários vinculados à sua empresa.</p>
                  </div>
                </div>
                <form className={styles.filtros} onSubmit={pesquisar}>
                  <label className={styles.campo}>
                    Buscar por nome ou e-mail
                    <input value={filtros.busca} maxLength={100} placeholder="Digite para pesquisar"
                      onChange={(evento) => setFiltros({ ...filtros, busca: evento.target.value })} />
                  </label>
                  <label className={styles.campo}>
                    Perfil
                    <select value={filtros.perfil}
                      onChange={(evento) => setFiltros({ ...filtros, perfil: evento.target.value as Filtros["perfil"] })}>
                      <option value="">Todos os perfis</option>
                      {perfisPermitidos.map((opcao) => <option value={opcao.valor} key={opcao.valor}>{opcao.rotulo}</option>)}
                    </select>
                  </label>
                  <label className={styles.campo}>
                    Situação
                    <select value={filtros.ativo}
                      onChange={(evento) => setFiltros({ ...filtros, ativo: evento.target.value as Situacao })}>
                      <option value="">Todos</option>
                      <option value="true">Ativos</option>
                      <option value="false">Inativos</option>
                    </select>
                  </label>
                  <div className={styles.acoesFiltro}>
                    <button type="submit" className={styles.botaoPrimario} disabled={carregandoLista}>Buscar</button>
                    <button type="button" className={styles.botaoSecundario} onClick={limparPesquisa} disabled={carregandoLista}>Limpar</button>
                  </div>
                </form>

                {erroLista && <p className={styles.erro} role="alert">{erroLista}</p>}
                {carregandoLista ? (
                  <p className={styles.mensagemTabela} role="status">Carregando usuários...</p>
                ) : usuarios.length === 0 ? (
                  <p className={styles.mensagemTabela}>Nenhum usuário encontrado para os filtros selecionados.</p>
                ) : (
                  <div className={styles.rolagemTabela}>
                    <table className={styles.tabela}>
                      <thead>
                        <tr><th>Usuário</th><th>Perfil</th><th>Situação</th><th>Ações</th></tr>
                      </thead>
                      <tbody>
                        {usuarios.map((usuario) => {
                          const proprioUsuario = usuario.id === identidade.usuarioId;
                          const permitido = identidade.perfil === "ADMINISTRADOR" || PERFIS_OPERACIONAIS.includes(usuario.perfil);
                          return (
                            <tr key={usuario.id}>
                              <td>
                                <strong>{usuario.nome}</strong>
                                <span className={styles.email}>{usuario.email}</span>
                              </td>
                              <td>{rotuloPerfil(usuario.perfil)}</td>
                              <td><span className={usuario.ativo ? styles.ativo : styles.inativo}>{usuario.ativo ? "Ativo" : "Inativo"}</span></td>
                              <td>
                                <div className={styles.acoesLinha}>
                                  {permitido && (
                                    <button type="button" className={styles.botaoTexto} onClick={() => abrirEdicao(usuario)}>
                                      Editar
                                    </button>
                                  )}
                                  {permitido && !proprioUsuario && (
                                    <button type="button" className={styles.botaoTexto}
                                      disabled={alterandoId !== null}
                                      onClick={() => void alterarSituacao(usuario)}>
                                      {alterandoId === usuario.id ? "Processando..." : usuario.ativo ? "Desativar" : "Ativar"}
                                    </button>
                                  )}
                                  {proprioUsuario && <span className={styles.contaAtual}>Sua conta</span>}
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}

                <div className={styles.paginacao}>
                  <span>Página {pagina} de {totalPaginas} · {total} registro(s)</span>
                  <div>
                    <button type="button" className={styles.botaoSecundario}
                      disabled={pagina <= 1 || carregandoLista}
                      onClick={() => void consultarUsuarios(pagina - 1, filtrosAplicados)}>
                      Anterior
                    </button>
                    <button type="button" className={styles.botaoSecundario}
                      disabled={pagina >= totalPaginas || carregandoLista}
                      onClick={() => void consultarUsuarios(pagina + 1, filtrosAplicados)}>
                      Próxima
                    </button>
                  </div>
                </div>
              </section>
            </>
          ) : (
            <section className={styles.cartao}>
              <h2>Não foi possível abrir a gestão de usuários</h2>
              <p>{erroLista || "Verifique a conexão com o backend e tente novamente."}</p>
              <button className={styles.botaoSecundario} type="button" onClick={() => router.push("/dashboard")}>
                Voltar ao dashboard
              </button>
            </section>
          )}
        </div>
      </main>
    </div>
  );
}
