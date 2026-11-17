"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { MenuLateral } from "../componentes/menu-lateral";
import {
  CAMPOS_ENDERECO_POR_CEP,
  normalizarCepFiscal,
  UFS_BRASIL as UFS,
  useConsultaCepFiscal,
} from "../componentes/consulta-cep-fiscal";
import layout from "../usuarios/usuarios.module.css";
import styles from "./configuracao-fiscal.module.css";

const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001").replace(/\/$/, "");
const GRUPOS_FISCAIS = [
  {
    titulo: "Identificação fiscal",
    campos: [
      { chave: "razaoSocial", rotulo: "Razão social", limite: 150 },
      { chave: "nomeFantasia", rotulo: "Nome fantasia", limite: 150 },
      { chave: "inscricaoEstadual", rotulo: "Inscrição estadual", limite: 20 },
      { chave: "codigoCRT", rotulo: "Código do regime tributário (CRT)", limite: 2,
        formato: "[0-9]{1,2}", dica: "Informe um ou dois dígitos." },
    ],
  },
  {
    titulo: "Endereço fiscal",
    campos: [
      { chave: "cep", rotulo: "CEP", limite: 9,
        formato: "[0-9]{5}-?[0-9]{3}", dica: "Informe oito dígitos, com ou sem hífen." },
      { chave: "logradouro", rotulo: "Logradouro", limite: 150 },
      { chave: "numero", rotulo: "Número", limite: 20 },
      { chave: "complemento", rotulo: "Complemento", limite: 100 },
      { chave: "bairro", rotulo: "Bairro", limite: 100 },
      { chave: "nomeMunicipio", rotulo: "Município", limite: 100 },
      { chave: "codigoMunicipio", rotulo: "Código do município (IBGE)", limite: 7,
        formato: "[0-9]{7}", dica: "Informe o código IBGE com sete dígitos." },
      { chave: "uf", rotulo: "UF", limite: 2 },
    ],
  },
] as const;
const CAMPOS_FISCAIS = [...GRUPOS_FISCAIS[0].campos, ...GRUPOS_FISCAIS[1].campos];

type CampoFiscal = (typeof CAMPOS_FISCAIS)[number]["chave"];
type DadosFiscais = Partial<Record<CampoFiscal, string>>;
type AlteracoesFiscais = Partial<Record<CampoFiscal, string | null>>;
type CampoFormulario = {
  chave: CampoFiscal;
  rotulo: string;
  limite: number;
  formato?: string;
  dica?: string;
};
type EstadoTela =
  | { fase: "carregando" | "negado" }
  | { fase: "erro"; mensagem: string }
  | { fase: "pronta"; empresaId: string; cadastrado: boolean; inicial: DadosFiscais; formulario: DadosFiscais };

/** Lê o identificador que a API associou à sessão empresarial. */
function lerEmpresaId(corpo: unknown): string | null {
  if (
    corpo &&
    typeof corpo === "object" &&
    "empresaId" in corpo &&
    typeof corpo.empresaId === "string" &&
    corpo.empresaId.trim()
  ) {
    return corpo.empresaId;
  }
  return null;
}

/** O GET devolve o cadastro diretamente ou { configuracao: null }. */
function lerCadastroFiscal(corpo: unknown): DadosFiscais | null {
  if (!corpo || typeof corpo !== "object" || Array.isArray(corpo)) {
    throw new Error("Resposta de configuração fiscal inválida.");
  }

  const cadastro = corpo as Record<string, unknown>;
  if (cadastro.configuracao === null) return null;
  if (typeof cadastro.id !== "string") throw new Error("Resposta de configuração fiscal inválida.");

  const formulario: DadosFiscais = {};
  for (const { chave } of CAMPOS_FISCAIS) {
    const valor = cadastro[chave];
    if (typeof valor === "string") formulario[chave] = valor;
  }
  return formulario;
}

function normalizarCampo(chave: CampoFiscal, valor: string | undefined): string {
  const texto = valor?.trim() ?? "";
  return chave === "cep" ? normalizarCepFiscal(texto) : texto;
}

/** Envia as diferenças. Um null limpa um valor que estava gravado. */
function montarAlteracoes(inicial: DadosFiscais, formulario: DadosFiscais): AlteracoesFiscais {
  const alteracoes: AlteracoesFiscais = {};
  for (const { chave } of CAMPOS_FISCAIS) {
    const valor = normalizarCampo(chave, formulario[chave]);
    if (valor !== normalizarCampo(chave, inicial[chave])) alteracoes[chave] = valor || null;
  }
  return alteracoes;
}

function mensagemApi(corpo: unknown, padrao: string): string {
  if (corpo && typeof corpo === "object" && "message" in corpo) {
    if (typeof corpo.message === "string" && corpo.message.trim()) return corpo.message;
    if (Array.isArray(corpo.message)) {
      const mensagens = corpo.message.filter(
        (item): item is string => typeof item === "string" && item.trim().length > 0,
      );
      if (mensagens.length > 0) return mensagens.join(" ");
    }
  }
  return padrao;
}

function removerSessaoEmpresarial() {
  sessionStorage.removeItem("gestao.accessToken");
  sessionStorage.removeItem("gestao.usuario");
}

export default function PaginaConfiguracaoFiscal() {
  const router = useRouter();
  const tokenConsulta = useRef<string | null>(null);
  const [tela, setTela] = useState<EstadoTela>({ fase: "carregando" });
  const [tentativa, setTentativa] = useState(0);
  const [salvando, setSalvando] = useState(false);
  const [aviso, setAviso] = useState("");
  const [erroFormulario, setErroFormulario] = useState("");

  useEffect(() => {
    const controle = new AbortController();
    const token = sessionStorage.getItem("gestao.accessToken");

    function sessaoAtual(): boolean {
      if (controle.signal.aborted) return false;
      if (sessionStorage.getItem("gestao.accessToken") === token) return true;

      setTela({ fase: "erro", mensagem: "A sessão mudou. Consulte os dados novamente." });
      return false;
    }

    async function consultar() {
      if (!token) {
        router.replace("/");
        return;
      }

      try {
        const resposta = await fetch(API_URL + "/configuracao-fiscal", {
          headers: { Authorization: "Bearer " + token },
          cache: "no-store",
          signal: controle.signal,
        });

        const corpo: unknown = await resposta.json().catch(() => null);
        if (!sessaoAtual()) return;

        if (resposta.status === 401) {
          removerSessaoEmpresarial();
          router.replace("/");
          return;
        }
        if (resposta.status === 403) {
          setTela({ fase: "negado" });
          return;
        }
        if (!resposta.ok) {
          setTela({ fase: "erro", mensagem: "Não foi possível consultar os dados fiscais." });
          return;
        }

        const cadastro = lerCadastroFiscal(corpo);
        let empresaId = lerEmpresaId(corpo);

        // A resposta de cadastro vazio não inclui o EmpresaId.
        if (!empresaId) {
          const identidade = await fetch(API_URL + "/usuarios/me", {
            headers: { Authorization: "Bearer " + token },
            cache: "no-store",
            signal: controle.signal,
          });
          const usuario: unknown = await identidade.json().catch(() => null);
          if (!sessaoAtual()) return;

          if (identidade.status === 401) {
            removerSessaoEmpresarial();
            router.replace("/");
            return;
          }

          empresaId = identidade.ok ? lerEmpresaId(usuario) : null;
          if (!empresaId) {
            setTela({ fase: "erro", mensagem: "Não foi possível identificar a empresa da sessão." });
            return;
          }
        }

        const inicial = cadastro ?? {};
        tokenConsulta.current = token;
        setTela({
          fase: "pronta",
          empresaId,
          cadastrado: cadastro !== null,
          inicial,
          formulario: inicial,
        });
      } catch {
        if (!controle.signal.aborted) {
          setTela({ fase: "erro", mensagem: "Não foi possível consultar os dados fiscais." });
        }
      }
    }

    void consultar();
    return () => controle.abort();
  }, [router, tentativa]);

  const cepFiscal = tela.fase === "pronta" ? normalizarCepFiscal(tela.formulario.cep ?? "") : "";
  const cepInicial = tela.fase === "pronta" ? normalizarCepFiscal(tela.inicial.cep ?? "") : "";
  // Abrir ou atualizar a tela preserva o endereço que já está salvo.
  const { endereco, consultandoCep, mensagemCep, limparConsultaCep } =
    useConsultaCepFiscal(cepFiscal, tela.fase === "pronta" && cepFiscal !== cepInicial);
  const formularioExibido = tela.fase === "pronta" ? { ...endereco, ...tela.formulario } : {};
  const alteracoes = tela.fase === "pronta" ? montarAlteracoes(tela.inicial, formularioExibido) : {};
  const alterado = Object.keys(alteracoes).length > 0;

  function consultarNovamente() {
    limparConsultaCep();
    tokenConsulta.current = null;
    setAviso("");
    setErroFormulario("");
    setTela({ fase: "carregando" });
    setTentativa((atual) => atual + 1);
  }

  function editarCampo(chave: CampoFiscal, valor: string) {
    setAviso("");
    setErroFormulario("");

    const novoCep = chave === "cep" ? normalizarCepFiscal(valor) : null;
    const mudouCep = novoCep !== null && novoCep !== cepFiscal;
    if (mudouCep) limparConsultaCep();

    setTela((atual) => {
      if (atual.fase !== "pronta") return atual;

      const formulario = { ...atual.formulario, [chave]: valor };
      if (mudouCep) {
        const restaurarEnderecoSalvo = /^\d{8}$/.test(novoCep) &&
          novoCep === normalizarCepFiscal(atual.inicial.cep ?? "");

        // Se o usuário voltar ao CEP original, recupera o endereço já gravado.
        for (const campo of CAMPOS_ENDERECO_POR_CEP) {
          const original = restaurarEnderecoSalvo ? atual.inicial[campo] : undefined;
          if (original === undefined) delete formulario[campo];
          else formulario[campo] = original;
        }
      }

      return { ...atual, formulario };
    });
  }

  function descartarAlteracoes() {
    limparConsultaCep();
    setAviso("");
    setErroFormulario("");
    setTela((atual) => atual.fase === "pronta"
      ? { ...atual, formulario: atual.inicial }
      : atual);
  }

  async function salvar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    if (tela.fase !== "pronta" || salvando || !alterado || consultandoCep) return;

    const token = sessionStorage.getItem("gestao.accessToken");
    if (!token) {
      removerSessaoEmpresarial();
      router.replace("/");
      return;
    }

    // Revalida a leitura se a sessão mudou depois que o formulário foi carregado.
    if (token !== tokenConsulta.current) {
      consultarNovamente();
      return;
    }

    setSalvando(true);
    setAviso("");
    setErroFormulario("");

    try {
      const resposta = await fetch(API_URL + "/configuracao-fiscal", {
        method: "PATCH",
        headers: {
          Authorization: "Bearer " + token,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(alteracoes),
      });
      const corpo: unknown = await resposta.json().catch(() => null);

      if (sessionStorage.getItem("gestao.accessToken") !== token) {
        consultarNovamente();
        return;
      }

      if (resposta.status === 401) {
        removerSessaoEmpresarial();
        router.replace("/");
        return;
      }
      if (resposta.status === 403) {
        setTela({ fase: "negado" });
        return;
      }
      if (!resposta.ok) {
        const padrao = "Não foi possível salvar os dados fiscais.";
        setErroFormulario(resposta.status < 500 ? mensagemApi(corpo, padrao) : padrao);
        return;
      }

      const cadastro = lerCadastroFiscal(corpo);
      if (!cadastro) throw new Error("Resposta de atualização inválida.");
      setTela({
        fase: "pronta",
        empresaId: tela.empresaId,
        cadastrado: true,
        inicial: cadastro,
        formulario: cadastro,
      });
      setAviso("Dados fiscais salvos com sucesso.");
    } catch {
      setErroFormulario("Não foi possível confirmar o salvamento. Consulte os dados antes de tentar novamente.");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className={layout.estrutura}>
      <MenuLateral />
      <main className={layout.conteudo}>
        <div className={layout.largura}>
          <header className={layout.cabecalho}>
            <div>
              <span className={layout.sobretitulo}>GESTÃO DA EMPRESA</span>
              <h1>Configuração fiscal</h1>
              <p>Consulte e atualize os dados fiscais da empresa.</p>
            </div>
          </header>

          {tela.fase === "carregando" && (
            <p role="status" className={styles.cartao}>Consultando dados fiscais...</p>
          )}

          {tela.fase === "negado" && (
            <p role="alert" className={styles.cartao}>
              Esta tela está disponível para administradores e gerentes da empresa.
            </p>
          )}

          {tela.fase === "erro" && (
            <div className={styles.cartao}>
              <p role="alert">{tela.mensagem}</p>
              <button type="button" className={styles.secundario} onClick={consultarNovamente}>
                Tentar novamente
              </button>
            </div>
          )}

          {tela.fase === "pronta" && (
            <form className={styles.cartao} onSubmit={salvar}>
              <div className={styles.resumoEmpresa}>
                <div>
                  <strong>Empresa da sessão</strong>
                  <p>EmpresaId <code>{tela.empresaId}</code></p>
                </div>
                <button
                  type="button"
                  className={styles.secundario}
                  disabled={salvando || alterado}
                  aria-describedby={alterado ? "fiscal-atualizacao-pendente" : undefined}
                  onClick={consultarNovamente}
                >
                  Atualizar dados
                </button>
              </div>
              {alterado && (
                <p id="fiscal-atualizacao-pendente" className={styles.dicaAtualizacao}>
                  Salve ou descarte as alterações para atualizar a consulta.
                </p>
              )}
              {!tela.cadastrado && <p className={styles.aviso}>Esta empresa ainda não tem cadastro fiscal.</p>}
              <fieldset className={styles.campos} disabled={salvando}>
                <legend className={styles.legenda}>Dados cadastrais fiscais</legend>
                {GRUPOS_FISCAIS.map(({ titulo, campos }) => (
                  <section key={titulo} className={styles.grupo}>
                    <h2>{titulo}</h2>
                    <div className={styles.grade}>
                      {campos.map((campo: CampoFormulario) => {
                        const id = "fiscal-" + campo.chave;
                        const valor = formularioExibido[campo.chave] ?? "";
                        // Remonta os campos de endereço ao mudar o CEP.
                        const chaveRenderizacao = CAMPOS_ENDERECO_POR_CEP.some(
                          (chave) => chave === campo.chave,
                        ) ? campo.chave + ":" + cepFiscal : campo.chave;
                        return (
                          <div key={chaveRenderizacao} className={styles.campo}>
                            <label htmlFor={id}>{campo.rotulo}</label>
                            {campo.chave === "uf" ? (
                              <select id={id} value={valor}
                                onChange={(evento) => editarCampo(campo.chave, evento.target.value)}>
                                <option value="">Selecione a UF</option>
                                {UFS.map((uf) => <option key={uf} value={uf}>{uf}</option>)}
                              </select>
                            ) : (
                              <input id={id} value={valor} maxLength={campo.limite}
                                inputMode={campo.formato ? "numeric" : "text"}
                                pattern={campo.formato}
                                title={campo.dica}
                                aria-describedby={campo.chave === "cep" ? "fiscal-cep-status" : undefined}
                                autoComplete="off"
                                onChange={(evento) => editarCampo(campo.chave, evento.target.value)}
                              />
                            )}
                            {campo.chave === "cep" && (
                              <small id="fiscal-cep-status" role="status">{mensagemCep}</small>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </section>
                ))}
              </fieldset>
              <div role="status" aria-atomic="true">
                {aviso && <p className={styles.confirmacaoSalvamento}>{aviso}</p>}
              </div>
              {erroFormulario && <p role="alert" className={styles.erro}>{erroFormulario}</p>}
              <div className={styles.acoes}>
                <button className={styles.primario} type="submit" disabled={!alterado || salvando || consultandoCep}>
                  {salvando ? "Salvando..." : "Salvar dados fiscais"}
                </button>
                <button className={styles.secundario} type="button" disabled={!alterado || salvando}
                  onClick={descartarAlteracoes}>
                  Descartar alterações
                </button>
                {!alterado && !salvando && (
                  <span className={styles.estadoAcoes}>Sem alterações pendentes</span>
                )}
              </div>
            </form>
          )}
        </div>
      </main>
    </div>
  );
}
