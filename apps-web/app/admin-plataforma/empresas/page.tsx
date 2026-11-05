"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import styles from "../admin-plataforma.module.css";
import {
  API_URL_ADMIN,
  CHAVE_ADMIN_TOKEN,
  CHAVE_ADMIN_USUARIO,
  lerMensagemErro,
  limparSessaoAdmin,
} from "../sessao-admin";

type Empresa = {
  id: string;
  nome: string;
  cnpj: string;
  ativo: boolean;
  criadoEm?: string;
};

type RespostaLista = {
  dados: Empresa[];
  total: number;
  pagina: number;
  limite: number;
  totalPaginas: number;
};

type FiltroAtivo = "todas" | "ativas" | "inativas";

type CredencialInicial = {
  chave: number;
  nome: string;
  email: string;
  senha: string;
};

type AdministradorEmpresa = {
  id: string;
  nome: string;
  email: string;
  perfil: "ADMINISTRADOR";
  ativo: boolean;
  criadoEm?: string;
};

/** Dados públicos devolvidos após o provisionamento; nunca incluem hash de senha. */
type RespostaProvisionamento = {
  empresa: Empresa;
  administradores: AdministradorEmpresa[];
};

function novaCredencial(chave: number): CredencialInicial {
  return { chave, nome: "", email: "", senha: "" };
}

const LIMITE = 10;

/**
 * Área exclusiva do administrador da plataforma.
 * As permissões são impostas pelo AdminPlataformaGuard no backend;
 * este componente apenas controla navegação e apresentação.
 */
export default function EmpresasAdminPlataforma() {
  const router = useRouter();
  const [nomeAdministrador, setNomeAdministrador] = useState("Administrador da plataforma");
  const [carregando, setCarregando] = useState(true);
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPaginas, setTotalPaginas] = useState(1);
  const [pagina, setPagina] = useState(1);
  const [filtro, setFiltro] = useState<FiltroAtivo>("todas");
  const [atualizacao, setAtualizacao] = useState(0);
  const [erroLista, setErroLista] = useState("");
  const [mensagem, setMensagem] = useState("");
  const [erroFormulario, setErroFormulario] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [operacaoEmpresaId, setOperacaoEmpresaId] = useState<string | null>(null);
  const [empresaEditadaId, setEmpresaEditadaId] = useState<string | null>(null);
  const [nome, setNome] = useState("");
  const [cnpj, setCnpj] = useState("");

  // Na criação conjunta, a API exige de um a dez administradores iniciais.
  const [administradoresIniciais, setAdministradoresIniciais] = useState<CredencialInicial[]>([
    novaCredencial(1),
  ]);
  const [ultimaEmpresaCriada, setUltimaEmpresaCriada] = useState<Empresa | null>(null);
  const [mensagemCopia, setMensagemCopia] = useState("");

  // Gestão separada de administradores para empresas já cadastradas.
  const [empresaSelecionada, setEmpresaSelecionada] = useState<Empresa | null>(null);
  const [administradoresEmpresa, setAdministradoresEmpresa] = useState<AdministradorEmpresa[]>([]);
  const [carregandoAdministradores, setCarregandoAdministradores] = useState(false);
  const [erroAdministradores, setErroAdministradores] = useState("");
  const [atualizacaoAdministradores, setAtualizacaoAdministradores] = useState(0);
  const [novoAdministrador, setNovoAdministrador] = useState<CredencialInicial>(novaCredencial(1));
  const [salvandoAdministrador, setSalvandoAdministrador] = useState(false);

  // Somente a sessão SaaS pode acessar estas chamadas.
  useEffect(() => {
    const token = sessionStorage.getItem(CHAVE_ADMIN_TOKEN);
    if (!token) {
      router.replace("/admin-plataforma");
      return;
    }

    try {
      const usuario = JSON.parse(sessionStorage.getItem(CHAVE_ADMIN_USUARIO) ?? "null") as unknown;
      if (usuario && typeof usuario === "object" && "nome" in usuario && typeof usuario.nome === "string") {
        setNomeAdministrador(usuario.nome);
      }
    } catch {
      // Metadados locais inválidos não devem impedir a consulta autenticada.
    }

    const controle = new AbortController();
    async function consultar() {
      setCarregando(true);
      setErroLista("");
      try {
        const parametros = new URLSearchParams({
          pagina: String(pagina),
          limite: String(LIMITE),
        });
        if (filtro !== "todas") {
          parametros.set("ativo", String(filtro === "ativas"));
        }

        const resposta = await fetch(`${API_URL_ADMIN}/empresas?${parametros}`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
          signal: controle.signal,
        });

        if (resposta.status === 401 || resposta.status === 403) {
          limparSessaoAdmin();
          router.replace("/admin-plataforma");
          return;
        }
        if (!resposta.ok) {
          setErroLista(await lerMensagemErro(resposta, "Não foi possível consultar as empresas."));
          return;
        }

        const dados: RespostaLista = await resposta.json();
        if (!Array.isArray(dados.dados) || typeof dados.total !== "number") {
          setErroLista("O servidor retornou uma listagem em formato inesperado.");
          return;
        }
        setEmpresas(dados.dados);
        setTotal(dados.total);
        setTotalPaginas(Math.max(1, Number(dados.totalPaginas) || 1));
      } catch (erro) {
        if (!controle.signal.aborted) {
          setErroLista("Falha de comunicação com o backend. Verifique se a API está ativa.");
        }
      } finally {
        if (!controle.signal.aborted) setCarregando(false);
      }
    }

    void consultar();
    return () => controle.abort();
  }, [router, pagina, filtro, atualizacao]);

  // Esta listagem é exclusiva da empresa selecionada no painel SaaS.
  useEffect(() => {
    if (!empresaSelecionada) {
      setAdministradoresEmpresa([]);
      setErroAdministradores("");
      return;
    }

    const token = sessionStorage.getItem(CHAVE_ADMIN_TOKEN);
    if (!token) {
      router.replace("/admin-plataforma");
      return;
    }

    const controle = new AbortController();

    async function consultarAdministradores() {
      setCarregandoAdministradores(true);
      setErroAdministradores("");
      setAdministradoresEmpresa([]);

      try {
        const resposta = await fetch(
          `${API_URL_ADMIN}/empresas/${encodeURIComponent(empresaSelecionada!.id)}/administradores`,
          {
            headers: { Authorization: `Bearer ${token}` },
            cache: "no-store",
            signal: controle.signal,
          },
        );

        if (controle.signal.aborted) return;
        if (resposta.status === 401 || resposta.status === 403) {
          limparSessaoAdmin();
          router.replace("/admin-plataforma");
          return;
        }
        if (!resposta.ok) {
          setErroAdministradores(await lerMensagemErro(resposta, "Não foi possível consultar os administradores."));
          return;
        }

        // O endpoint entrega um array de usuários públicos, sem hashes.
        const dados: unknown = await resposta.json();
        if (!Array.isArray(dados)) {
          setErroAdministradores("O backend retornou os administradores em formato inesperado.");
          return;
        }
        setAdministradoresEmpresa(dados as AdministradorEmpresa[]);
      } catch {
        if (!controle.signal.aborted) {
          setErroAdministradores("Falha de comunicação ao consultar os administradores.");
        }
      } finally {
        if (!controle.signal.aborted) setCarregandoAdministradores(false);
      }
    }

    void consultarAdministradores();
    return () => controle.abort();
  }, [empresaSelecionada, atualizacaoAdministradores, router]);

  function sair() {
    limparSessaoAdmin();
    router.replace("/admin-plataforma");
  }

  function atualizarListagem() {
    setAtualizacao((atual) => atual + 1);
  }

  function limparFormulario() {
    setEmpresaEditadaId(null);
    setNome("");
    setCnpj("");
    setAdministradoresIniciais([novaCredencial(1)]);
    setErroFormulario("");
  }

  /** Atualiza somente um campo da credencial, sem persistir senha no navegador. */
  function atualizarCredencial(chave: number, campo: "nome" | "email" | "senha", valor: string) {
    setAdministradoresIniciais((atuais) =>
      atuais.map((item) => item.chave === chave ? { ...item, [campo]: valor } : item),
    );
  }

  function adicionarLinhaAdministrador() {
    setAdministradoresIniciais((atuais) => {
      if (atuais.length >= 10) return atuais;
      const proximaChave = Math.max(...atuais.map((item) => item.chave)) + 1;
      return [...atuais, novaCredencial(proximaChave)];
    });
  }

  function removerLinhaAdministrador(chave: number) {
    setAdministradoresIniciais((atuais) =>
      atuais.length > 1 ? atuais.filter((item) => item.chave !== chave) : atuais,
    );
  }

  /** EmpresaId não é segredo; as permissões continuam validadas por JWT no backend. */
  async function copiarEmpresaId(empresaId: string) {
    try {
      await navigator.clipboard.writeText(empresaId);
      setMensagemCopia(`EmpresaId copiado: ${empresaId}`);
    } catch {
      setMensagemCopia("A cópia automática não foi permitida. Selecione o EmpresaId exibido na tela.");
    }
  }

  function selecionarEmpresa(empresa: Empresa) {
    setEmpresaSelecionada((atual) => atual?.id === empresa.id ? null : empresa);
    setNovoAdministrador(novaCredencial(1));
    setErroAdministradores("");
    setMensagem("");
  }

  function editar(empresa: Empresa) {
    setEmpresaEditadaId(empresa.id);
    setNome(empresa.nome);
    setCnpj(empresa.cnpj);
    setErroFormulario("");
    setMensagem("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function salvar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    if (salvando) return;
    // Valida duplicidade antes de enviar as senhas à API.
    if (!empresaEditadaId) {
      const emails = administradoresIniciais.map((item) => item.email.trim().toLowerCase());
      if (new Set(emails).size !== emails.length) {
        setErroFormulario("Os e-mails dos administradores iniciais devem ser diferentes.");
        return;
      }
      if (administradoresIniciais.length < 1 || administradoresIniciais.length > 10) {
        setErroFormulario("Informe de 1 a 10 administradores iniciais.");
        return;
      }
    }

    setSalvando(true);
    setErroFormulario("");
    setMensagem("");
    setMensagemCopia("");

    try {
      const token = sessionStorage.getItem(CHAVE_ADMIN_TOKEN);
      if (!token) {
        router.replace("/admin-plataforma");
        return;
      }
      const ehEdicao = empresaEditadaId !== null;
      const destino = ehEdicao
        ? `${API_URL_ADMIN}/empresas/${encodeURIComponent(empresaEditadaId)}`
        : `${API_URL_ADMIN}/empresas/com-administradores`;

      const dadosEnvio = ehEdicao
        ? { nome: nome.trim(), cnpj: cnpj.trim() }
        : {
            nome: nome.trim(),
            cnpj: cnpj.trim(),
            administradores: administradoresIniciais.map(({ nome, email, senha }) => ({
              nome: nome.trim(),
              email: email.trim().toLowerCase(),
              senha,
            })),
          };

      const resposta = await fetch(destino, {
        method: ehEdicao ? "PATCH" : "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(dadosEnvio),
      });

      if (resposta.status === 401 || resposta.status === 403) {
        limparSessaoAdmin();
        router.replace("/admin-plataforma");
        return;
      }
      if (!resposta.ok) {
        setErroFormulario(await lerMensagemErro(resposta, "Não foi possível salvar os dados da empresa."));
        return;
      }
      if (ehEdicao) {
        setMensagem("Empresa atualizada com sucesso.");
        setEmpresaSelecionada((atual) =>
          atual?.id === empresaEditadaId
            ? { ...atual, nome: nome.trim(), cnpj: cnpj.trim() }
            : atual,
        );
      } else {
        const dados: RespostaProvisionamento = await resposta.json();
        if (dados?.empresa?.id) {
          setUltimaEmpresaCriada(dados.empresa);
        }
        setMensagem("Empresa e administradores iniciais cadastrados com sucesso.");
      }
      limparFormulario();
      setPagina(1);
      atualizarListagem();
    } catch {
      setErroFormulario(
        "Não foi possível confirmar a operação. Confira a listagem antes de tentar novamente, para evitar duplicidade.",
      );
    } finally {
      setSalvando(false);
    }
  }

  async function alterarAtivacao(empresa: Empresa) {
    if (operacaoEmpresaId) return;
    const acao = empresa.ativo ? "desativar" : "ativar";
    if (!window.confirm(`Deseja ${acao} a empresa “${empresa.nome}”?`)) return;

    const token = sessionStorage.getItem(CHAVE_ADMIN_TOKEN);
    if (!token) {
      router.replace("/admin-plataforma");
      return;
    }

    setOperacaoEmpresaId(empresa.id);
    setErroLista("");
    setMensagem("");
    try {
      const resposta = await fetch(
        `${API_URL_ADMIN}/empresas/${encodeURIComponent(empresa.id)}/ativacao`,
        {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ ativo: !empresa.ativo }),
        },
      );
      if (resposta.status === 401 || resposta.status === 403) {
        limparSessaoAdmin();
        router.replace("/admin-plataforma");
        return;
      }
      if (!resposta.ok) {
        setErroLista(await lerMensagemErro(resposta, "Não foi possível alterar a situação da empresa."));
        return;
      }
      setMensagem(empresa.ativo ? "Empresa desativada com sucesso." : "Empresa ativada com sucesso.");
      atualizarListagem();
    } catch {
      setErroLista("Falha de comunicação ao alterar a situação da empresa.");
    } finally {
      setOperacaoEmpresaId(null);
    }
  }

  async function salvarAdministrador(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    if (!empresaSelecionada || salvandoAdministrador) return;

    const token = sessionStorage.getItem(CHAVE_ADMIN_TOKEN);
    if (!token) {
      router.replace("/admin-plataforma");
      return;
    }

    setSalvandoAdministrador(true);
    setErroAdministradores("");
    setMensagem("");

    try {
      const resposta = await fetch(
        `${API_URL_ADMIN}/empresas/${encodeURIComponent(empresaSelecionada.id)}/administradores`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            nome: novoAdministrador.nome.trim(),
            email: novoAdministrador.email.trim().toLowerCase(),
            senha: novoAdministrador.senha,
          }),
        },
      );

      if (resposta.status === 401 || resposta.status === 403) {
        limparSessaoAdmin();
        router.replace("/admin-plataforma");
        return;
      }
      if (!resposta.ok) {
        setErroAdministradores(await lerMensagemErro(resposta, "Não foi possível cadastrar o administrador."));
        return;
      }

      // Limpa a senha inicial imediatamente após a confirmação.
      setNovoAdministrador(novaCredencial(1));
      setMensagem("Novo administrador vinculado à empresa com sucesso.");
      setAtualizacaoAdministradores((atual) => atual + 1);
    } catch {
      setErroAdministradores(
        "Falha de comunicação. Consulte a lista antes de tentar novamente, para evitar duplicidade.",
      );
    } finally {
      setSalvandoAdministrador(false);
    }
  }

  return (
    <main className={styles.painelPagina}>
      <header className={styles.cabecalho}>
        <div className={styles.marca}>
          <span className={styles.marcaIcone}>GC</span>
          <span>GESTÃO COMERCIAL <small>PLATAFORMA SAAS</small></span>
        </div>
        <div className={styles.cabecalhoDireito}>
          <span className={styles.nomeAdmin}>{nomeAdministrador}</span>
          <a href="/admin-plataforma/auditoria" className={styles.botaoSair}>Auditoria</a>
          <button className={styles.botaoSair} onClick={sair} type="button">Sair do painel</button>
        </div>
      </header>

      <div className={styles.areaConteudo}>
        <div className={styles.topoPagina}>
          <div>
            <span className={styles.etiquetaClara}>ADMINISTRAÇÃO DA PLATAFORMA</span>
            <h1>Empresas clientes</h1>
            <p className={styles.mutado}>
              Cadastre empresas com administradores próprios. O EmpresaId é gerado automaticamente.
            </p>
          </div>
          <div className={styles.contador}>
            <strong>{total}</strong>
            <small>empresa(s) no filtro atual</small>
          </div>
        </div>

        {mensagem && <p role="status" className={styles.mensagemSucesso}>{mensagem}</p>}
        {mensagemCopia && <p role="status" className={styles.avisoCopia}>{mensagemCopia}</p>}
        {ultimaEmpresaCriada && (
          <section className={styles.empresaCriada} aria-label="Identificador da empresa criada">
            <div>
              <strong>Empresa criada: {ultimaEmpresaCriada.nome}</strong>
              <span>EmpresaId para o primeiro acesso empresarial:</span>
              <code className={styles.identificadorCompleto}>{ultimaEmpresaCriada.id}</code>
            </div>
            <button type="button" className={styles.botaoSecundario}
              onClick={() => void copiarEmpresaId(ultimaEmpresaCriada.id)}>Copiar EmpresaId</button>
          </section>
        )}

        <section className={styles.cartao} aria-labelledby="titulo-formulario-empresa">
          <div className={styles.secaoTopo}>
            <div>
              <h2 id="titulo-formulario-empresa">{empresaEditadaId ? "Editar empresa" : "Cadastrar empresa"}</h2>
              <p className={styles.mutado}>
                {empresaEditadaId
                  ? "Atualize os dados cadastrais da empresa selecionada."
                  : "Preencha nome, CNPJ e pelo menos um administrador inicial. A criação será concluída numa única transação."}
              </p>
            </div>
            {empresaEditadaId && <button type="button" className={styles.botaoSecundario} onClick={limparFormulario}>Cancelar edição</button>}
          </div>
          <form onSubmit={salvar} className={styles.formGrid}>
            <div className={styles.campo}>
              <label htmlFor="empresa-nome">Nome da empresa</label>
              <input
                id="empresa-nome"
                value={nome}
                onChange={(evento) => setNome(evento.target.value)}
                maxLength={150}
                required
                placeholder="Nome da empresa"
              />
            </div>
            <div className={styles.campo}>
              <label htmlFor="empresa-cnpj">CNPJ</label>
              <input
                id="empresa-cnpj"
                value={cnpj}
                onChange={(evento) => setCnpj(evento.target.value)}
                maxLength={18}
                required
                inputMode="numeric"
                placeholder="00.000.000/0000-00"
              />
            </div>
            {!empresaEditadaId && (
              <div className={styles.blocoAdminsIniciais}>
                <div className={styles.tituloBlocoAdmin}>
                  <div>
                    <h3>Administradores iniciais</h3>
                    <p className={styles.mutado}>
                      De 1 a 10 administradores. Cada conta terá perfil ADMINISTRADOR, restrito à empresa criada.
                    </p>
                  </div>
                  <button type="button" className={styles.botaoSecundario}
                    disabled={salvando || administradoresIniciais.length >= 10}
                    onClick={adicionarLinhaAdministrador}>
                    Adicionar administrador
                  </button>
                </div>
                {administradoresIniciais.map((item, indice) => (
                  <div className={styles.formAdministrador} key={item.chave}>
                    <div className={styles.campo}>
                      <label htmlFor={`admin-inicial-nome-${item.chave}`}>Nome do administrador {indice + 1}</label>
                      <input id={`admin-inicial-nome-${item.chave}`} value={item.nome}
                        minLength={3} maxLength={120} required autoComplete="off"
                        onChange={(evento) => atualizarCredencial(item.chave, "nome", evento.target.value)}
                        placeholder="Nome completo" />
                    </div>
                    <div className={styles.campo}>
                      <label htmlFor={`admin-inicial-email-${item.chave}`}>E-mail de acesso</label>
                      <input id={`admin-inicial-email-${item.chave}`} type="email" value={item.email}
                        maxLength={160} required autoComplete="off"
                        onChange={(evento) => atualizarCredencial(item.chave, "email", evento.target.value)}
                        placeholder="admin@empresa.com.br" />
                    </div>
                    <div className={styles.campo}>
                      <label htmlFor={`admin-inicial-senha-${item.chave}`}>Senha inicial</label>
                      <input id={`admin-inicial-senha-${item.chave}`} type="password" value={item.senha}
                        minLength={8} maxLength={128} required autoComplete="new-password"
                        onChange={(evento) => atualizarCredencial(item.chave, "senha", evento.target.value)}
                        placeholder="Mínimo de 8 caracteres" />
                    </div>
                    <button type="button" className={styles.botaoRemover}
                      disabled={salvando || administradoresIniciais.length === 1}
                      onClick={() => removerLinhaAdministrador(item.chave)}>
                      Remover
                    </button>
                  </div>
                ))}
                <p className={styles.avisoSenha}>
                  A senha inicial não será exibida novamente. Compartilhe-a com o titular por um canal seguro.
                </p>
              </div>
            )}
            <div className={styles.botaoCampo}>
              <button type="submit" className={styles.botaoPrincipal} disabled={salvando}>
                {salvando ? "Salvando..." : empresaEditadaId ? "Salvar alterações" : "Cadastrar empresa e administradores"}
              </button>
            </div>
          </form>
          {erroFormulario && <p role="alert" className={styles.mensagemErro}>{erroFormulario}</p>}
        </section>

        <section className={styles.cartao} aria-labelledby="titulo-lista-empresas">
          <div className={styles.secaoTopo}>
            <div>
              <h2 id="titulo-lista-empresas">Empresas cadastradas</h2>
              <p className={styles.mutado}>Consulta limitada a administradores da plataforma.</p>
            </div>
            <div className={styles.acoesLista}>
              <label htmlFor="filtro-ativo">Situação</label>
              <select
                id="filtro-ativo"
                value={filtro}
                onChange={(evento) => {
                  setFiltro(evento.target.value as FiltroAtivo);
                  setPagina(1);
                }}
              >
                <option value="todas">Todas</option>
                <option value="ativas">Ativas</option>
                <option value="inativas">Inativas</option>
              </select>
              <button type="button" className={styles.botaoSecundario} onClick={atualizarListagem}>Atualizar</button>
            </div>
          </div>

          {erroLista && <p role="alert" className={styles.mensagemErro}>{erroLista}</p>}
          {carregando ? (
            <p className={styles.mutado}>Carregando empresas...</p>
          ) : empresas.length === 0 ? (
            <p className={styles.vazio}>Nenhuma empresa encontrada para o filtro selecionado.</p>
          ) : (
            <div className={styles.tabelaRolagem}>
              <table className={styles.tabela}>
                <thead>
                  <tr><th>Empresa</th><th>EmpresaId</th><th>CNPJ</th><th>Situação</th><th>Ações</th></tr>
                </thead>
                <tbody>
                  {empresas.map((empresa) => (
                    <tr key={empresa.id} className={empresaSelecionada?.id === empresa.id ? styles.linhaSelecionada : undefined}>
                      <td><strong>{empresa.nome}</strong></td>
                      <td>
                        <div className={styles.identificadorNaTabela}>
                          <code title={empresa.id}>{empresa.id}</code>
                          <button type="button" className={styles.botaoSecundario}
                            onClick={() => void copiarEmpresaId(empresa.id)}>Copiar</button>
                        </div>
                      </td>
                      <td>{empresa.cnpj}</td>
                      <td><span className={empresa.ativo ? styles.ativo : styles.inativo}>{empresa.ativo ? "Ativa" : "Inativa"}</span></td>
                      <td>
                        <div className={styles.acoesLinha}>
                          <button type="button" className={styles.botaoSecundario} onClick={() => editar(empresa)}>Editar</button>
                          <button type="button" className={styles.botaoSecundario}
                            onClick={() => selecionarEmpresa(empresa)}>
                            {empresaSelecionada?.id === empresa.id ? "Fechar administradores" : "Administradores"}
                          </button>
                          <button
                            type="button"
                            className={empresa.ativo ? styles.botaoPerigo : styles.botaoSecundario}
                            onClick={() => void alterarAtivacao(empresa)}
                            disabled={operacaoEmpresaId === empresa.id}
                          >
                            {operacaoEmpresaId === empresa.id ? "Aguarde..." : empresa.ativo ? "Desativar" : "Ativar"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className={styles.paginacao}>
            <span>Página {pagina} de {totalPaginas}</span>
            <div className={styles.acoesLinha}>
              <button type="button" className={styles.botaoSecundario} onClick={() => setPagina((atual) => Math.max(1, atual - 1))} disabled={carregando || pagina <= 1}>Anterior</button>
              <button type="button" className={styles.botaoSecundario} onClick={() => setPagina((atual) => Math.min(totalPaginas, atual + 1))} disabled={carregando || pagina >= totalPaginas}>Próxima</button>
            </div>
          </div>
        </section>

        {empresaSelecionada && (
          <section className={styles.cartao} aria-labelledby="titulo-admins-empresa">
            <div className={styles.secaoTopo}>
              <div>
                <h2 id="titulo-admins-empresa">Administradores de {empresaSelecionada.nome}</h2>
                <p className={styles.mutado}>
                  EmpresaId: <code className={styles.identificadorCompleto}>{empresaSelecionada.id}</code>
                </p>
              </div>
              <button type="button" className={styles.botaoSecundario}
                onClick={() => setEmpresaSelecionada(null)}>Fechar</button>
            </div>

            {erroAdministradores && <p role="alert" className={styles.mensagemErro}>{erroAdministradores}</p>}
            {carregandoAdministradores ? (
              <p className={styles.mutado}>Consultando administradores...</p>
            ) : administradoresEmpresa.length === 0 ? (
              <p className={styles.vazio}>Esta empresa ainda não possui administradores cadastrados.</p>
            ) : (
              <div className={styles.tabelaRolagem}>
                <table className={styles.tabela}>
                  <thead><tr><th>Nome</th><th>E-mail</th><th>Perfil</th><th>Situação</th></tr></thead>
                  <tbody>
                    {administradoresEmpresa.map((administrador) => (
                      <tr key={administrador.id}>
                        <td><strong>{administrador.nome}</strong></td>
                        <td>{administrador.email}</td>
                        <td>{administrador.perfil}</td>
                        <td><span className={administrador.ativo ? styles.ativo : styles.inativo}>
                          {administrador.ativo ? "Ativo" : "Inativo"}
                        </span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className={styles.adicionarAdminExistente}>
              <h3>Adicionar administrador a esta empresa</h3>
              <p className={styles.mutado}>
                O novo usuário terá perfil ADMINISTRADOR somente nesta empresa.
              </p>
              <form className={styles.formAdministradorExistente} onSubmit={salvarAdministrador}>
                <div className={styles.campo}>
                  <label htmlFor="novo-administrador-nome">Nome</label>
                  <input id="novo-administrador-nome" value={novoAdministrador.nome}
                    required minLength={3} maxLength={120} autoComplete="off"
                    onChange={(evento) => setNovoAdministrador((atual) => ({ ...atual, nome: evento.target.value }))}
                    placeholder="Nome completo" />
                </div>
                <div className={styles.campo}>
                  <label htmlFor="novo-administrador-email">E-mail</label>
                  <input id="novo-administrador-email" type="email" value={novoAdministrador.email}
                    required maxLength={160} autoComplete="off"
                    onChange={(evento) => setNovoAdministrador((atual) => ({ ...atual, email: evento.target.value }))}
                    placeholder="admin@empresa.com.br" />
                </div>
                <div className={styles.campo}>
                  <label htmlFor="novo-administrador-senha">Senha inicial</label>
                  <input id="novo-administrador-senha" type="password" value={novoAdministrador.senha}
                    required minLength={8} maxLength={128} autoComplete="new-password"
                    onChange={(evento) => setNovoAdministrador((atual) => ({ ...atual, senha: evento.target.value }))}
                    placeholder="Mínimo de 8 caracteres" />
                </div>
                <button type="submit" className={styles.botaoPrincipal}
                  disabled={salvandoAdministrador}>
                  {salvandoAdministrador ? "Cadastrando..." : "Adicionar administrador"}
                </button>
              </form>
              <p className={styles.avisoSenha}>
                A senha é enviada somente à API e não será incluída na listagem ou na auditoria.
              </p>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
