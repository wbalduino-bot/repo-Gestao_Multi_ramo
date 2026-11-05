"use client";

/**
 * Página de Produtos e Estoque do Gestão Comercial Multi-Ramo.
 *
 * Funcionalidades:
 * - Listagem paginada e pesquisa de produtos pela API NestJS.
 * - Cadastro de produtos, incluindo estoque inicial e estoque mínimo.
 * - Registro de entradas, saídas e ajustes posteriores de estoque.
 * - Consulta do histórico de movimentações com paginação.
 * - Exibição do saldo devolvido pelo backend após cada movimentação.
 * - Proteção da tela por meio do componente ProtecaoSessao.
 *
 * Segurança:
 * - O token é enviado no cabeçalho Authorization.
 * - O backend determina a empresa pelo usuário autenticado.
 * - A interface não envia empresaId nas operações.
 * - O backend permanece responsável pelas validações definitivas.
 */

import {
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type FormEvent,
} from "react";
import { useRouter } from "next/navigation";
import styles from "./produtos.module.css";
import { ProtecaoSessao } from "../componentes/protecao-sessao";
import { MenuLateral } from "../componentes/menu-lateral";

// Endereço do backend, configurável pelo ambiente.
const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5433";

/** Estrutura de um produto devolvido pela API. */
type ProdutoApi = {
  id: string;
  nome: string;
  sku: string;
  descricao: string | null;
  codigoBarras: string | null;
  categoriaId: string | null;
  unidadeId: string | null;
  preco: number | string;
  custo?: number | string;
  perecivel: boolean;
  peso: number | string | null;
  ativo: boolean;
  saldoEstoque?: {
    quantidadeDisponivel: number | string;
    quantidadeReservada: number | string;
    estoqueMinimo: number | string;
  } | null;
  createdAt?: string;
  updatedAt?: string;
};

/** Resposta paginada do endpoint de produtos. */
type RespostaListagem = {
  dados?: ProdutoApi[];
  total?: number;
  pagina?: number;
  limite?: number;
  totalPaginas?: number;
};

/** Estrutura padrão de respostas e erros da API. */
type RespostaApi = RespostaListagem & {
  message?: string | string[];
  error?: string;
};

/** Indicadores globais retornados pela API para a empresa autenticada. */
type ResumoGeralProdutos = {
  totalProdutos: number;
  produtosAtivos: number;
  produtosInativos: number;
  estoqueCritico: number;
  semEstoque: number;
  semSaldo: number;
};

/** Tipos de movimentação que a tela permite registrar manualmente. */
type TipoMovimentacao = "ENTRADA" | "SAIDA" | "AJUSTE";

/** Estrutura de uma movimentação devolvida pelo backend. */
type MovimentacaoApi = {
  id: string;
  tipo: string;
  quantidade: number | string;
  saldoApos: number | string;
  motivo: string;
  referenciaId?: string | null;
  usuarioId?: string;
  criadoEm: string;
};

/** Resposta paginada do histórico de estoque. */
type RespostaHistorico = {
  dados?: MovimentacaoApi[];
  total?: number;
  pagina?: number;
  limite?: number;
  totalPaginas?: number;
  message?: string | string[];
  error?: string;
};

/* INTEGRACAO CATEGORIAS UNIDADES PRODUTOS V1 */
/** Cadastros auxiliares pertencentes à empresa da sessão autenticada. */
type CategoriaCadastro = { id: string; nome: string; categoriaPaiId?: string | null };
type UnidadeCadastro = { id: string; codigo: string; nome: string };

type RespostaCadastros<T> = T[] | { dados: T[] };

/** Aceita retorno simples ou envelopado sem inventar registros. */
function extrairCadastros<T>(resposta: RespostaCadastros<T>): T[] {
  if (Array.isArray(resposta)) return resposta;
  if (resposta && Array.isArray(resposta.dados)) return resposta.dados;
  throw new Error("Formato inesperado dos cadastros auxiliares.");
}

/** Campos do formulário de cadastro de produtos. */
type FormularioProduto = {
  nome: string;
  sku: string;
  descricao: string;
  codigoBarras: string;
  categoriaId: string;
  unidadeId: string;
  preco: string;
  custo: string;
  quantidadeInicial: string;
  estoqueMinimo: string;
};

/** Estado inicial do cadastro de produto. */
const formularioVazio: FormularioProduto = {
  nome: "",
  sku: "",
  descricao: "",
  codigoBarras: "",
  categoriaId: "",
  unidadeId: "",
  preco: "",
  custo: "",
  quantidadeInicial: "0",
  estoqueMinimo: "0",
};

const LIMITE_POR_PAGINA = 20;
const LIMITE_HISTORICO = 10;

const formatadorMoeda = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

/** Formata percentuais de margem bruta. */
const formatadorPercentual = new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 2,
});

const formatadorQuantidade = new Intl.NumberFormat("pt-BR", {
  maximumFractionDigits: 3,
});

const formatadorDataHora = new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "short",
  timeStyle: "short",
});

/**
 * Lê JSON de forma segura. O tipo genérico permite reutilizar a função
 * nas respostas de produtos e no histórico de movimentações.
 */
async function lerRespostaJson<T extends object = RespostaApi>(
  resposta: Response,
): Promise<T> {
  try {
    return (await resposta.json()) as T;
  } catch {
    return {} as T;
  }
}

/** Obtém uma mensagem legível para erros retornados pelo NestJS. */
function obterMensagemErro(
  dados: { message?: string | string[]; error?: string },
  mensagemPadrao: string,
): string {
  if (Array.isArray(dados.message)) {
    return dados.message.join(", ");
  }

  if (typeof dados.message === "string") {
    return dados.message;
  }

  return mensagemPadrao;
}

/** Converte decimais serializados pelo Prisma em números utilizáveis na tela. */
function converterValorNumerico(
  valor: number | string | null | undefined,
): number {
  if (valor === null || valor === undefined) {
    return 0;
  }

  const numero = Number(valor);
  return Number.isFinite(numero) ? numero : 0;
}

/** Exibe uma data válida no padrão brasileiro e trata valores inválidos. */
function formatarDataHora(valor?: string): string {
  if (!valor) {
    return "—";
  }

  const data = new Date(valor);
  return Number.isNaN(data.getTime())
    ? "—"
    : formatadorDataHora.format(data);
}

/** Estados calculados para destacar situações relevantes do estoque. */
type CodigoEstadoEstoque =
  | "SEM_SALDO"
  | "SEM_ESTOQUE"
  | "CRITICO"
  | "NORMAL";

type EstadoEstoque = {
  codigo: CodigoEstadoEstoque;
  rotulo: string;
  detalhe: string;
  estilo: CSSProperties;
};

/**
 * Calcula o estado do estoque a partir do saldo atual e do mínimo configurado.
 * Um saldo ausente não é tratado como zero: isso evita alertas falsos para
 * produtos antigos cujo saldo ainda não foi inicializado.
 */
function obterEstadoEstoque(produto: ProdutoApi): EstadoEstoque {
  if (!produto.saldoEstoque) {
    return {
      codigo: "SEM_SALDO",
      rotulo: "Saldo não cadastrado",
      detalhe: "Este produto ainda não possui um registro de saldo de estoque.",
      estilo: {
        color: "#475569",
        backgroundColor: "#f1f5f9",
        border: "1px solid #cbd5e1",
      },
    };
  }

  const disponivel = converterValorNumerico(
    produto.saldoEstoque.quantidadeDisponivel,
  );
  const minimo = converterValorNumerico(
    produto.saldoEstoque.estoqueMinimo,
  );

  // Estoque zero tem prioridade, inclusive quando o mínimo também é zero.
  if (disponivel <= 0) {
    return {
      codigo: "SEM_ESTOQUE",
      rotulo: "Sem estoque",
      detalhe: "Não há unidades disponíveis para venda ou uso.",
      estilo: {
        color: "#991b1b",
        backgroundColor: "#fef2f2",
        border: "1px solid #fecaca",
      },
    };
  }

  // O ponto crítico é inclusivo: saldo igual ao mínimo já gera alerta.
  if (minimo > 0 && disponivel <= minimo) {
    return {
      codigo: "CRITICO",
      rotulo: "Estoque crítico",
      detalhe: `Disponível: ${formatadorQuantidade.format(disponivel)}. Mínimo: ${formatadorQuantidade.format(minimo)}.`,
      estilo: {
        color: "#92400e",
        backgroundColor: "#fffbeb",
        border: "1px solid #fde68a",
      },
    };
  }

  return {
    codigo: "NORMAL",
    rotulo: "Normal",
    detalhe: minimo > 0
      ? `Saldo acima do mínimo de ${formatadorQuantidade.format(minimo)}.`
      : "Não há um limite mínimo positivo configurado.",
    estilo: {
      color: "#166534",
      backgroundColor: "#f0fdf4",
      border: "1px solid #bbf7d0",
    },
  };
}

/** Traduz os valores técnicos da API para rótulos mais amigáveis. */
function rotuloMovimentacao(tipo: string): string {
  switch (tipo) {
    case "ENTRADA":
      return "Entrada";
    case "SAIDA":
      return "Saída";
    case "AJUSTE":
      return "Ajuste";
    case "RESERVA":
      return "Reserva";
    case "LIBERACAO":
      return "Liberação";
    default:
      return tipo;
  }
}

/** Componente principal da página de produtos e estoque. */
export default function ProdutosPage() {
  const router = useRouter();

  // Dados, pesquisa e paginação da listagem de produtos.
  const [produtos, setProdutos] = useState<ProdutoApi[]>([]);
  const [total, setTotal] = useState(0);
  // Indicadores independentes da pesquisa e da paginação.
  const [resumoGeral, setResumoGeral] = useState<ResumoGeralProdutos | null>(null);
  const [carregandoResumo, setCarregandoResumo] = useState(true);
  const [erroResumo, setErroResumo] = useState("");
  const [pagina, setPagina] = useState(1);
  const [totalPaginas, setTotalPaginas] = useState(1);
  const [pesquisa, setPesquisa] = useState("");

  // Filtros da listagem, independentes do formulário de cadastro.
  const [categoriaSelecionada, setCategoriaSelecionada] = useState("");
  const [situacaoSelecionada, setSituacaoSelecionada] = useState("TODOS");

  // Estado do estoque selecionado na listagem.
  // TODOS preserva o comportamento original da consulta.
  const [estadoEstoqueSelecionado, setEstadoEstoqueSelecionado] =
    useState("TODOS");
  const [carregando, setCarregando] = useState(true);
  const [erroCarregamento, setErroCarregamento] = useState("");
  
  // Estado do formulário original de cadastro de produto.
  const [formularioAberto, setFormularioAberto] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [formulario, setFormulario] = useState<FormularioProduto>({
    ...formularioVazio,
  });
  const [erroFormulario, setErroFormulario] = useState("");
  const [categoriasCadastro, setCategoriasCadastro] = useState<CategoriaCadastro[]>([]);

  // Categorias utilizadas exclusivamente pelo filtro da listagem.
  const [categoriasFiltro, setCategoriasFiltro] = useState<CategoriaCadastro[]>([]);
  const [carregandoCategoriasFiltro, setCarregandoCategoriasFiltro] = useState(true);
  const [erroCategoriasFiltro, setErroCategoriasFiltro] = useState("");
  const [unidadesCadastro, setUnidadesCadastro] = useState<UnidadeCadastro[]>([]);
  const [carregandoCadastros, setCarregandoCadastros] = useState(false);
  const [erroCadastros, setErroCadastros] = useState("");

  /*
   * Carrega as categorias da empresa autenticada para o filtro.
   *
   * Não depende da abertura do formulário de cadastro e não
   * consulta unidades desnecessariamente.
   */
  useEffect(() => {
    let ativo = true;
    const controlador = new AbortController();

    async function carregarCategoriasFiltro() {
      const token = sessionStorage.getItem("gestao.accessToken");

      if (!token) {
        if (ativo) {
          setCarregandoCategoriasFiltro(false);
          setErroCategoriasFiltro("Sessão não encontrada.");
        }
        return;
      }

      try {
        const resposta = await fetch(`${API_URL}/categorias`, {
          method: "GET",
          headers: {
            Accept: "application/json",
            Authorization: `Bearer ${token}`,
          },
          cache: "no-store",
          signal: controlador.signal,
        });

        if (!resposta.ok) {
          throw new Error(
            `Não foi possível carregar as categorias (HTTP ${resposta.status}).`,
          );
        }

        const dados = extrairCadastros<CategoriaCadastro>(
          (await resposta.json()) as RespostaCadastros<CategoriaCadastro>,
        );

        if (ativo) {
          setCategoriasFiltro(dados);
          setErroCategoriasFiltro("");
        }
      } catch (erro) {
        if (erro instanceof Error && erro.name === "AbortError") return;

        if (ativo) {
          setCategoriasFiltro([]);
          setErroCategoriasFiltro(
            erro instanceof Error
              ? erro.message
              : "Não foi possível carregar as categorias.",
          );
        }
      } finally {
        if (ativo) setCarregandoCategoriasFiltro(false);
      }
    }

    void carregarCategoriasFiltro();

    return () => {
      ativo = false;
      controlador.abort();
    };
  }, []);

  // Carrega as opções apenas quando o cadastro de produto é aberto.
  // Pesquisa e paginação de produtos não provocam novas consultas auxiliares.
  useEffect(() => {
    if (!formularioAberto) return;
    const token = sessionStorage.getItem("gestao.accessToken");
    if (!token) return;
    let ativo = true;
    const controlador = new AbortController();
    setCarregandoCadastros(true);
    setErroCadastros("");

    async function obterLista<T>(rota: string): Promise<T[]> {
      const resposta = await fetch(`${API_URL}/${rota}`, {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
        cache: "no-store",
        signal: controlador.signal,
      });
      if (!resposta.ok) throw new Error(`Falha ao consultar ${rota} (HTTP ${resposta.status}).`);
      return extrairCadastros<T>((await resposta.json()) as RespostaCadastros<T>);
    }

    Promise.all([
      obterLista<CategoriaCadastro>("categorias"),
      obterLista<UnidadeCadastro>("unidades"),
    ])
      .then(([categorias, unidades]) => {
        if (!ativo) return;
        setCategoriasCadastro(categorias);
        setUnidadesCadastro(unidades);
      })
      .catch((erro: unknown) => {
        if (!ativo || (erro instanceof Error && erro.name === "AbortError")) return;
        setCategoriasCadastro([]);
        setUnidadesCadastro([]);
        setErroCadastros(erro instanceof Error ? erro.message : "Falha ao obter categorias e unidades.");
      })
      .finally(() => { if (ativo) setCarregandoCadastros(false); });

    return () => { ativo = false; controlador.abort(); };
  }, [formularioAberto]);

  // Atualiza a listagem depois de cadastrar ou movimentar estoque.
  const [atualizacao, setAtualizacao] = useState(0);
  // Solicita novo resumo após movimentar estoque sem alterar a busca atual.
  const [atualizacaoResumo, setAtualizacaoResumo] = useState(0);
  const [mensagemSucesso, setMensagemSucesso] = useState("");

  // Estado do modal de movimentação de estoque.
  const [modalMovimentacaoAberto, setModalMovimentacaoAberto] =
    useState(false);
  const [produtoMovimentacao, setProdutoMovimentacao] =
    useState<ProdutoApi | null>(null);
  const [tipoMovimentacao, setTipoMovimentacao] =
    useState<TipoMovimentacao>("ENTRADA");
  const [quantidadeMovimentacao, setQuantidadeMovimentacao] =
    useState("1");
  const [motivoMovimentacao, setMotivoMovimentacao] = useState("");
  const [referenciaMovimentacao, setReferenciaMovimentacao] =
    useState("");
  const [enviandoMovimentacao, setEnviandoMovimentacao] =
    useState(false);
  const [erroMovimentacao, setErroMovimentacao] = useState("");

  // Estado do modal e da paginação do histórico de movimentações.
  const [historicoAberto, setHistoricoAberto] = useState(false);
  const [produtoHistorico, setProdutoHistorico] =
    useState<ProdutoApi | null>(null);
  const [movimentacoes, setMovimentacoes] = useState<MovimentacaoApi[]>([]);
  const [paginaHistorico, setPaginaHistorico] = useState(1);
  const [totalHistorico, setTotalHistorico] = useState(0);
  const [totalPaginasHistorico, setTotalPaginasHistorico] = useState(1);
  const [carregandoHistorico, setCarregandoHistorico] = useState(false);
  const [erroHistorico, setErroHistorico] = useState("");
  const [atualizacaoHistorico, setAtualizacaoHistorico] = useState(0);
  const [nomeEmpresa, setNomeEmpresa] = useState("Empresa autenticada");
  const [perfilUsuario, setPerfilUsuario] = useState<string | null>(null);

  // Somente administradores e gerentes acessam os recursos gerenciais.
  const acessoGerencial =
    perfilUsuario === "ADMINISTRADOR" || perfilUsuario === "GERENTE";

  /** Limpa a sessão local e redireciona o usuário para o login. */
  function encerrarSessaoLocal() {
    sessionStorage.removeItem("gestao.accessToken");
    sessionStorage.removeItem("gestao.usuario");
    router.replace("/");
  }

  // Recupera o nome da empresa salva durante o login.
useEffect(() => {
  try {
    const usuarioSalvo = sessionStorage.getItem("gestao.usuario");

    if (!usuarioSalvo) return;

    const usuario = JSON.parse(usuarioSalvo) as {
      empresaNome?: unknown;
      perfil?: unknown;
    };

    if (
      typeof usuario.empresaNome === "string" &&
      usuario.empresaNome.trim()
    ) {
      setNomeEmpresa(usuario.empresaNome.trim());
    }

    if (typeof usuario.perfil === "string") {
      setPerfilUsuario(usuario.perfil);
    }
  } catch {
    setNomeEmpresa("Empresa autenticada");
    setPerfilUsuario(null);
  }
  }, []);
  /**
   * Consulta os indicadores do catálogo inteiro, isolados pelo token.
   * Não depende de pesquisa nem de página: digitar na busca não gera
   * consultas adicionais à API de resumo.
   */
  useEffect(() => {
    let ativo = true;
    const controlador = new AbortController();

    async function carregarResumoGeral() {
      const token = sessionStorage.getItem("gestao.accessToken");
      if (!token) {
        if (ativo) {
          setCarregandoResumo(false);
          setResumoGeral(null);
        }
        return;
      }

      setCarregandoResumo(true);
      setErroResumo("");
      try {
        const resposta = await fetch(`${API_URL}/produtos/resumo-estoque`, {
          method: "GET",
          headers: {
            Accept: "application/json",
            Authorization: `Bearer ${token}`,
          },
          signal: controlador.signal,
        });
        const dados = await lerRespostaJson<ResumoGeralProdutos & RespostaApi>(resposta);

        if (resposta.status === 401 || resposta.status === 403) {
          sessionStorage.removeItem("gestao.accessToken");
          sessionStorage.removeItem("gestao.usuario");
          router.replace("/");
          return;
        }
        if (!resposta.ok) {
          throw new Error(obterMensagemErro(dados, "Não foi possível consultar os indicadores gerais."));
        }
        // Não exibe totais inventados quando a API falha ou muda o contrato.
        const campos: (keyof ResumoGeralProdutos)[] = [
          "totalProdutos", "produtosAtivos", "produtosInativos",
          "estoqueCritico", "semEstoque",
        ];
        if (campos.some((campo) =>
          !Number.isInteger(dados[campo]) || dados[campo] < 0
        ) || dados.totalProdutos !== dados.produtosAtivos + dados.produtosInativos) {
          throw new Error("A API retornou indicadores gerais inválidos.");
        }
        if (ativo) {
          setResumoGeral({
            totalProdutos: dados.totalProdutos,
            produtosAtivos: dados.produtosAtivos,
            produtosInativos: dados.produtosInativos,
            estoqueCritico: dados.estoqueCritico,
            semEstoque: dados.semEstoque,
            semSaldo: dados.semSaldo,
          });
        }
      } catch (erro) {
        if (erro instanceof Error && erro.name === "AbortError") return;
        if (ativo) {
          setResumoGeral(null);
          setErroResumo(erro instanceof Error ? erro.message : "Falha ao consultar indicadores gerais.");
        }
      } finally {
        if (ativo) setCarregandoResumo(false);
      }
    }

    void carregarResumoGeral();
    return () => {
      ativo = false;
      controlador.abort();
    };
  }, [atualizacao, atualizacaoResumo, router]);

  /**
   * Carrega a página de produtos autenticada.
   * A empresa é definida pelo backend com base no token enviado.
   */
  useEffect(() => {
    let componenteAtivo = true;
    const controlador = new AbortController();

    const temporizador = window.setTimeout(async () => {
      setCarregando(true);
      setErroCarregamento("");

      const token = sessionStorage.getItem("gestao.accessToken");

      if (!token) {
        router.replace("/");
        if (componenteAtivo) setCarregando(false);
        return;
      }

      try {
        const parametros = new URLSearchParams({
          pagina: String(pagina),
          limite: String(LIMITE_POR_PAGINA),
        });

        const termo = pesquisa.trim();
        if (termo) parametros.set("busca", termo);

        // A API valida a categoria dentro da empresa autenticada.
        if (categoriaSelecionada) {
          parametros.set("categoriaId", categoriaSelecionada);
        }

        // A ausência do parâmetro ativo representa todos os produtos.
        if (situacaoSelecionada === "ATIVOS") {
          parametros.set("ativo", "true");
        } else if (situacaoSelecionada === "INATIVOS") {
          parametros.set("ativo", "false");
        }

        // Envia o estado somente quando houver um filtro específico.
        // A empresa continua sendo identificada pelo token no backend.
        if (estadoEstoqueSelecionado !== "TODOS") {
          parametros.set("estadoEstoque", estadoEstoqueSelecionado);
        }

        const resposta = await fetch(
          `${API_URL}/produtos?${parametros.toString()}`,
          {
            method: "GET",
            headers: {
              Accept: "application/json",
              Authorization: `Bearer ${token}`,
            },
            signal: controlador.signal,
          },
        );

        const dados = await lerRespostaJson<RespostaApi>(resposta);

        if (resposta.status === 401 || resposta.status === 403) {
          encerrarSessaoLocal();
		            return;
        }

        if (!resposta.ok) {
          throw new Error(
            obterMensagemErro(
              dados,
              "Não foi possível carregar os produtos.",
            ),
          );
        }

        if (!Array.isArray(dados.dados)) {
          throw new Error(
            "A API retornou um formato inesperado para a listagem.",
          );
        }

        if (!componenteAtivo) return;

        setProdutos(dados.dados);
        setTotal(Number(dados.total ?? 0));
        setTotalPaginas(
          Math.max(1, Number(dados.totalPaginas ?? 1)),
        );
      } catch (erro) {
        if (erro instanceof Error && erro.name === "AbortError") {
          return;
        }

        if (componenteAtivo) {
          setErroCarregamento(
            erro instanceof Error
              ? erro.message
              : "Ocorreu um erro ao carregar os produtos.",
          );
        }
      } finally {
        if (componenteAtivo) setCarregando(false);
      }
    }, pesquisa.trim() ? 300 : 0);

    return () => {
      componenteAtivo = false;
      window.clearTimeout(temporizador);
      controlador.abort();
    };
  }, [
    pesquisa,
    categoriaSelecionada,
    situacaoSelecionada,
    estadoEstoqueSelecionado,
    pagina,
    atualizacao,
    router,
  ]);

    /**
   * Atualiza os saldos quando uma venda acontece em outra aba
   * ou quando o usuário retorna à tela de Produtos e Estoque.
   */
  useEffect(() => {
    let ultimaAtualizacao = 0;

    // Evita duas recargas quando foco e visibilidade mudam juntos.
    function atualizarListagem() {
      const agora = Date.now();

      if (agora - ultimaAtualizacao < 500) {
        return;
      }

      ultimaAtualizacao = agora;

      // O efeito de listagem existente detectará essa mudança
      // e consultará novamente os produtos com os filtros atuais.
      setAtualizacao((valor) => valor + 1);
    }

    // Recebe o aviso enviado por outra aba após uma venda.
    function receberAvisoDeVenda(evento: StorageEvent) {
      if (evento.key === "gestao.estoque.atualizado") {
        atualizarListagem();
      }
    }

    // Atualiza ao voltar para a aba de Produtos.
    function aoMudarVisibilidade() {
      if (document.visibilityState === "visible") {
        atualizarListagem();
      }
    }

    window.addEventListener("storage", receberAvisoDeVenda);
    window.addEventListener("focus", atualizarListagem);
    document.addEventListener(
      "visibilitychange",
      aoMudarVisibilidade,
    );

    return () => {
      window.removeEventListener("storage", receberAvisoDeVenda);
      window.removeEventListener("focus", atualizarListagem);
      document.removeEventListener(
        "visibilitychange",
        aoMudarVisibilidade,
      );
    };
  }, []);

  /** Carrega o histórico apenas enquanto o modal estiver aberto. */
  useEffect(() => {
    if (!historicoAberto || !produtoHistorico) {
      return;
    }

    // Copia o ID após a validação para preservar o tipo string
    // dentro da função assíncrona, onde o TypeScript perde o narrowing.
    const produtoId = produtoHistorico.id;

    let componenteAtivo = true;
    const controlador = new AbortController();

    async function carregarHistorico() {
      setCarregandoHistorico(true);
      setErroHistorico("");

      const token = sessionStorage.getItem("gestao.accessToken");
      if (!token) {
        router.replace("/");
        if (componenteAtivo) setCarregandoHistorico(false);
        return;
      }

      try {
        const parametros = new URLSearchParams({
          pagina: String(paginaHistorico),
          limite: String(LIMITE_HISTORICO),
        });

        const resposta = await fetch(
          `${API_URL}/produtos/${encodeURIComponent(
            produtoId,
          )}/movimentacoes?${parametros.toString()}`,
          {
            method: "GET",
            headers: {
              Accept: "application/json",
              Authorization: `Bearer ${token}`,
            },
            signal: controlador.signal,
          },
        );

        const dados = await lerRespostaJson<RespostaHistorico>(resposta);

        if (resposta.status === 401 || resposta.status === 403) {
          encerrarSessaoLocal();
          return;
        }

        if (!resposta.ok) {
          throw new Error(
            obterMensagemErro(
              dados,
              "Não foi possível consultar o histórico de estoque.",
            ),
          );
        }

        if (!Array.isArray(dados.dados)) {
          throw new Error(
            "A API retornou um formato inesperado para o histórico.",
          );
        }

        if (!componenteAtivo) return;

        setMovimentacoes(dados.dados);
        setTotalHistorico(Number(dados.total ?? 0));
        setTotalPaginasHistorico(
          Math.max(1, Number(dados.totalPaginas ?? 1)),
        );
      } catch (erro) {
        if (erro instanceof Error && erro.name === "AbortError") {
          return;
        }

        if (componenteAtivo) {
          setErroHistorico(
            erro instanceof Error
              ? erro.message
              : "Ocorreu um erro ao consultar o histórico.",
          );
        }
      } finally {
        if (componenteAtivo) setCarregandoHistorico(false);
      }
    }

    void carregarHistorico();

    return () => {
      componenteAtivo = false;
      controlador.abort();
    };
  }, [
    historicoAberto,
    produtoHistorico,
    paginaHistorico,
    atualizacaoHistorico,
    router,
  ]);

  /** Totais da empresa obtidos pelo backend, não pela página filtrada. */
  const indicadores = useMemo(() => ({
    total: resumoGeral?.totalProdutos ?? null,
    exibidos: produtos.length,
    ativos: resumoGeral?.produtosAtivos ?? null,
    inativos: resumoGeral?.produtosInativos ?? null,
    estoqueCritico: resumoGeral?.estoqueCritico ?? null,
    semEstoque: resumoGeral?.semEstoque ?? null,
    semSaldo: resumoGeral?.semSaldo ?? null,
  }), [produtos.length, resumoGeral]);

  // Produtos que precisam de atenção, limitados à página carregada.
  const produtosComAlertaEstoque = useMemo(
    () =>
      produtos.filter((produto) => {
        const estado = obterEstadoEstoque(produto).codigo;
        return estado === "CRITICO" || estado === "SEM_ESTOQUE";
      }),
    [produtos],
  );

  /** Atualiza um campo do formulário de cadastro. */
  function atualizarCampo<K extends keyof FormularioProduto>(
    campo: K,
    valor: FormularioProduto[K],
  ) {
    setFormulario((atual) => ({ ...atual, [campo]: valor }));
    setErroFormulario("");
  }

  /** Abre o cadastro com os valores iniciais. */
  function abrirFormulario() {
    setFormulario({ ...formularioVazio });
    setErroFormulario("");
    setFormularioAberto(true);
  }

  /** Fecha o cadastro sem enviar os dados. */
  function fecharFormulario() {
    if (enviando) return;
    setFormularioAberto(false);
    setErroFormulario("");
  }

  /** Cadastra produto e estoque inicial no backend. */
  async function cadastrarProduto(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    setErroFormulario("");

    const nome = formulario.nome.trim();
    const sku = formulario.sku.trim().toUpperCase();
    const descricao = formulario.descricao.trim();
    const codigoBarras = formulario.codigoBarras.trim();
    const preco = Number(formulario.preco);
    const custo = Number(formulario.custo);

    if (!nome || !sku) {
      setErroFormulario("Informe o nome e o SKU do produto.");
      return;
    }

    if (
      formulario.preco.trim() === "" ||
      formulario.custo.trim() === "" ||
      !Number.isFinite(preco) ||
      !Number.isFinite(custo) ||
      preco < 0 ||
      custo < 0
    ) {
      setErroFormulario(
        "Informe valores válidos e não negativos para preço e custo.",
      );
      return;
    }

    if (
      formulario.quantidadeInicial.trim() === "" ||
      formulario.estoqueMinimo.trim() === ""
    ) {
      setErroFormulario(
        "Informe a quantidade inicial e o estoque mínimo. Utilize zero quando aplicável.",
      );
      return;
    }

    const quantidadeInicial = Number(formulario.quantidadeInicial);
    const estoqueMinimo = Number(formulario.estoqueMinimo);

    if (
      !Number.isFinite(quantidadeInicial) ||
      !Number.isFinite(estoqueMinimo) ||
      quantidadeInicial < 0 ||
      estoqueMinimo < 0 ||
      (formulario.quantidadeInicial.split(".")[1]?.length ?? 0) > 3 ||
      (formulario.estoqueMinimo.split(".")[1]?.length ?? 0) > 3
    ) {
      setErroFormulario(
        "As quantidades devem ser não negativas e possuir no máximo três casas decimais.",
      );
      return;
    }

    const token = sessionStorage.getItem("gestao.accessToken");
    if (!token) {
      router.replace("/");
      return;
    }

    setEnviando(true);

    try {
      const corpo = {
        nome,
        sku,
        ...(descricao ? { descricao } : {}),
        ...(codigoBarras ? { codigoBarras } : {}),
        ...(formulario.categoriaId ? { categoriaId: formulario.categoriaId } : {}),
        ...(formulario.unidadeId ? { unidadeId: formulario.unidadeId } : {}),
        preco,
        custo,
        quantidadeInicial,
        estoqueMinimo,
      };

      const resposta = await fetch(`${API_URL}/produtos`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(corpo),
      });

      const dados = await lerRespostaJson<RespostaApi>(resposta);

      if (resposta.status === 401 || resposta.status === 403) {
        encerrarSessaoLocal();
        return;
      }

      if (!resposta.ok) {
        throw new Error(
          obterMensagemErro(dados, "Não foi possível cadastrar o produto."),
        );
      }

      setFormulario({ ...formularioVazio });
      setFormularioAberto(false);
      setPesquisa("");
      setPagina(1);
      setMensagemSucesso("Produto cadastrado com sucesso.");
      setAtualizacao((valor) => valor + 1);
    } catch (erro) {
      setErroFormulario(
        erro instanceof Error
          ? erro.message
          : "Ocorreu um erro ao cadastrar o produto.",
      );
    } finally {
      setEnviando(false);
    }
  }

  /** Abre o modal para registrar movimento no produto selecionado. */
  function abrirModalMovimentacao(produto: ProdutoApi) {
    setProdutoMovimentacao(produto);
    setTipoMovimentacao("ENTRADA");
    setQuantidadeMovimentacao("1");
    setMotivoMovimentacao("");
    setReferenciaMovimentacao("");
    setErroMovimentacao("");
    setModalMovimentacaoAberto(true);
  }

  /** Fecha o modal de movimentação se não houver envio em andamento. */
  function fecharModalMovimentacao() {
    if (enviandoMovimentacao) return;
    setModalMovimentacaoAberto(false);
    setErroMovimentacao("");
  }

  /**
   * Registra entrada, saída ou ajuste na API.
   * Entradas e saídas exigem quantidade positiva; ajustes aceitam sinal.
   */
  async function registrarMovimentacao(
    evento: FormEvent<HTMLFormElement>,
  ) {
    evento.preventDefault();
    setErroMovimentacao("");

    if (!produtoMovimentacao) {
      setErroMovimentacao("Selecione um produto para movimentar.");
      return;
    }

    const quantidadeTexto = quantidadeMovimentacao.trim();
    const quantidade = Number(quantidadeTexto);
    const motivo = motivoMovimentacao.trim();
    const referenciaId = referenciaMovimentacao.trim();
    const casasDecimais = quantidadeTexto.split(".")[1]?.length ?? 0;

    if (
      quantidadeTexto === "" ||
      !Number.isFinite(quantidade) ||
      casasDecimais > 3
    ) {
      setErroMovimentacao(
        "Informe uma quantidade válida com no máximo três casas decimais.",
      );
      return;
    }

    if (tipoMovimentacao === "AJUSTE" && quantidade === 0) {
      setErroMovimentacao("A quantidade do ajuste não pode ser zero.");
      return;
    }

    if (
      (tipoMovimentacao === "ENTRADA" || tipoMovimentacao === "SAIDA") &&
      quantidade <= 0
    ) {
      setErroMovimentacao(
        "Para entradas e saídas, a quantidade deve ser maior que zero.",
      );
      return;
    }

    if (!motivo) {
	      setErroMovimentacao("Informe o motivo da movimentação.");
      return;
    }

    if (motivo.length > 250) {
      setErroMovimentacao("O motivo deve ter no máximo 250 caracteres.");
      return;
    }

    if (referenciaId.length > 100) {
      setErroMovimentacao(
        "A referência deve ter no máximo 100 caracteres.",
      );
      return;
    }

    const token = sessionStorage.getItem("gestao.accessToken");
    if (!token) {
      router.replace("/");
      return;
    }

    const nomeProduto = produtoMovimentacao.nome;
    setEnviandoMovimentacao(true);

    try {
      const corpo = {
        tipo: tipoMovimentacao,
        quantidade,
        motivo,
        ...(referenciaId ? { referenciaId } : {}),
      };

      const resposta = await fetch(
        `${API_URL}/produtos/${encodeURIComponent(
          produtoMovimentacao.id,
        )}/movimentacoes`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(corpo),
        },
      );

      const dados = await lerRespostaJson<RespostaApi>(resposta);

      if (resposta.status === 401 || resposta.status === 403) {
        encerrarSessaoLocal();
        return;
      }

      if (!resposta.ok) {
        throw new Error(
          obterMensagemErro(
            dados,
            "Não foi possível registrar a movimentação de estoque.",
          ),
        );
      }

      const respostaMovimentacao = dados as RespostaApi & {
        saldoEstoque?: ProdutoApi["saldoEstoque"];
      };
      const saldoAtualizado = respostaMovimentacao.saldoEstoque;

      setModalMovimentacaoAberto(false);
      setMensagemSucesso(
        `${rotuloMovimentacao(tipoMovimentacao)} registrada com sucesso para ${nomeProduto}.`,
      );

      if (saldoAtualizado) {
        // Atualiza somente o produto movimentado, usando o saldo confirmado pela API.
        setAtualizacaoResumo((valor) => valor + 1);
        setProdutos((produtosAtuais) =>
          produtosAtuais.map((produto) =>
            produto.id === produtoMovimentacao.id
              ? { ...produto, saldoEstoque: saldoAtualizado }
              : produto,
          ),
        );
      } else {
        // Mantém uma alternativa segura caso a API não retorne o saldo esperado.
        setAtualizacao((valor) => valor + 1);
      }

      // Atualiza também o histórico se ele estiver aberto.
      setAtualizacaoHistorico((valor) => valor + 1);
    } catch (erro) {
      setErroMovimentacao(
        erro instanceof Error
          ? erro.message
          : "Ocorreu um erro ao registrar a movimentação.",
      );
    } finally {
      setEnviandoMovimentacao(false);
    }
  }

  /** Abre o histórico do produto e inicia pela primeira página. */
  function abrirHistorico(produto: ProdutoApi) {
    setProdutoHistorico(produto);
    setMovimentacoes([]);
    setPaginaHistorico(1);
    setTotalHistorico(0);
    setTotalPaginasHistorico(1);
    setErroHistorico("");
    setHistoricoAberto(true);
  }

  /** Fecha a consulta do histórico. */
  function fecharHistorico() {
    setHistoricoAberto(false);
    setProdutoHistorico(null);
    setErroHistorico("");
  }

  return (
    <ProtecaoSessao>
      <div className={styles.pagina}>
        <MenuLateral nomeEmpresa={nomeEmpresa} />

        <main className={styles.conteudoPrincipal}>
          <header className={styles.cabecalho}>
            <span>Gestão Comercial / Produtos e estoque</span>
            <span className={styles.seloDemo}>CATÁLOGO INTEGRADO À API</span>
          </header>

          <div className={styles.conteudo}>
            <section className={styles.introducao}>
              <div>
                <span className={styles.identificadorSecao}>CATÁLOGO</span>
                <h1>Produtos e estoque</h1>
                <p>
                  Consulte produtos, registre movimentações e acompanhe o
                  histórico de estoque da empresa autenticada.
                </p>
              </div>

              {acessoGerencial && (
                <button
                  type="button"
                  className={styles.botaoPrincipal}
                  onClick={abrirFormulario}
                >
                  <span aria-hidden="true">+</span>
                  Novo produto
                </button>
              )}
            </section>

            {/* Feedback visível após cadastro ou movimentação bem-sucedida. */}
            {mensagemSucesso && (
              <p
                role="status"
                style={{
                  padding: "12px 16px",
                  border: "1px solid #bbdfc5",
                  borderRadius: "8px",
                  background: "#f0faf2",
                  color: "#205b30",
                  marginBottom: "16px",
                }}
              >
                {mensagemSucesso}
                <button
                  type="button"
                  onClick={() => setMensagemSucesso("")}
                  aria-label="Dispensar mensagem"
                  style={{
                    float: "right",
                    border: 0,
                    background: "transparent",
                    color: "inherit",
                    cursor: "pointer",
                    fontSize: "18px",
                    lineHeight: 1,
                  }}
                >
                  ×
                </button>
              </p>
            )}

            {erroResumo && (
              <p role="alert" style={{ color: "#991b1b", marginBottom: "12px" }}>
                Indicadores gerais indisponíveis: {erroResumo}
              </p>
            )}
            {carregandoResumo && (
              <p role="status" style={{ marginBottom: "12px" }}>
                Carregando indicadores gerais da empresa...
              </p>
            )}
            <section
              className={styles.resumo}
              aria-label="Resumo do catálogo e do estoque"
              style={{
                gridTemplateColumns: "repeat(auto-fit, minmax(175px, 1fr))",
                gap: "12px",
              }}
            >
              <article className={styles.cardResumo}>
                <span>Total cadastrado</span>
                <strong>{indicadores.total ?? "—"}</strong>
                <small>Todos os produtos da empresa</small>
              </article>
              <article className={styles.cardResumo}>
                <span>Resultados da pesquisa</span>
                <strong>{total}</strong>
                <small>{indicadores.exibidos} exibido(s) nesta página</small>
              </article>
              <article className={styles.cardResumo}>
                <span>Ativos na empresa</span>
                <strong>{indicadores.ativos ?? "—"}</strong>
                <small>Produtos habilitados no catálogo</small>
              </article>
              <article className={styles.cardResumo}>
                <span>Inativos na empresa</span>
                <strong className={styles.valorAlerta}>
                  {indicadores.inativos ?? "—"}
                </strong>
                <small>Produtos desativados</small>
              </article>
              <article
                className={styles.cardResumo}
                style={{ borderLeft: "4px solid #d97706" }}
              >
                <span>Estoque crítico na empresa</span>
                <strong style={{ color: "#92400e" }}>
                  {indicadores.estoqueCritico ?? "—"}
                </strong>
                <small>Saldo positivo igual ou abaixo do mínimo</small>
              </article>
              <article
                className={styles.cardResumo}
                style={{ borderLeft: "4px solid #dc2626" }}
              >
                <span>Sem estoque na empresa</span>
                <strong style={{ color: "#991b1b" }}>
                  {indicadores.semEstoque ?? "—"}
                </strong>
                <small>Produtos com saldo disponível igual a zero</small>
              </article>
            </section>

            {/* Aviso imediato dos produtos que precisam de reposição. */}
            {!carregando && produtosComAlertaEstoque.length > 0 && (
              <section
                aria-labelledby="titulo-alerta-estoque"
                role="status"
                style={{
                  margin: "0 0 20px",
                  padding: "16px 18px",
                  borderRadius: "10px",
                  border: "1px solid #fcd34d",
                  background: "#fffbeb",
                  color: "#78350f",
                }}
              >
                <h2
                  id="titulo-alerta-estoque"
                  style={{ margin: "0 0 8px", fontSize: "16px", fontWeight: 700 }}
                >
                  Atenção: {produtosComAlertaEstoque.length} produto(s) precisam de atenção
                </h2>
                <ul style={{ margin: 0, paddingLeft: "20px" }}>
                  {produtosComAlertaEstoque.slice(0, 5).map((produto) => {
                    const estado = obterEstadoEstoque(produto);
                    const disponivel = converterValorNumerico(
                      produto.saldoEstoque?.quantidadeDisponivel,
                    );
                    const minimo = converterValorNumerico(
                      produto.saldoEstoque?.estoqueMinimo,
                    );

                    return (
                      <li key={produto.id}>
                        <strong>{produto.nome}</strong>: {estado.rotulo} — disponível {formatadorQuantidade.format(disponivel)}, mínimo {formatadorQuantidade.format(minimo)}.
                      </li>
                    );
                  })}
                </ul>
                {produtosComAlertaEstoque.length > 5 && (
                  <p style={{ margin: "8px 0 0" }}>
                    E mais {produtosComAlertaEstoque.length - 5} produto(s) nesta página.
                  </p>
                )}
                <small style={{ display: "block", marginTop: "8px" }}>
                  Os alertas consideram os produtos da página atual. O resumo geral de toda a empresa será integrado ao Dashboard em uma etapa própria.
                </small>
              </section>
            )}

            {(indicadores.semSaldo ?? 0) > 0 && !carregando && (
              <p
                role="note"
                style={{
                  margin: "0 0 16px",
                  padding: "10px 14px",
                  borderRadius: "8px",
                  background: "#f8fafc",
                  color: "#475569",
                  border: "1px solid #e2e8f0",
                }}
              >
                {indicadores.semSaldo ?? '—'} produto(s) na empresa ainda não possuem saldo inicializado. Eles foram mantidos separados dos alertas de falta de estoque para evitar classificações incorretas.
              </p>
            )}

            <section className={styles.painelTabela}>
              <div className={styles.tituloTabela}>
                <div>
                  <h2>Lista de produtos</h2>
                  <p>
                    {carregando
                      ? "Carregando produtos..."
                      : `${total} produto(s) encontrado(s)`}
                  </p>
                </div>
              </div>

              <div className={styles.filtros}>
                <label className={styles.campoPesquisa}>
                  <span aria-hidden="true">⌕</span>
                  <span className={styles.visualmenteOculto}>
                    Pesquisar produto por nome, SKU ou código de barras
                  </span>
                  <input
                    type="search"
                    placeholder="Pesquisar por nome, SKU ou código de barras..."
                    value={pesquisa}
                    onChange={(evento) => {
                      setPesquisa(evento.target.value);
                      setPagina(1);
                    }}
                  />
                </label>

                {/* Filtra somente categorias da empresa autenticada. */}
                <label className={styles.campoFiltro}>
                  <span>Categoria</span>
                  <select
                    value={categoriaSelecionada}
                    disabled={carregandoCategoriasFiltro}
                    onChange={(evento) => {
                      setCategoriaSelecionada(evento.target.value);
                      setPagina(1);
                    }}
                  >
                    <option value="">
                      {carregandoCategoriasFiltro
                        ? "Carregando categorias..."
                        : "Todas as categorias"}
                    </option>
                    {categoriasFiltro.map((categoria) => (
                      <option key={categoria.id} value={categoria.id}>
                        {categoria.nome}
                      </option>
                    ))}
                  </select>
                </label>

                {/* Mantém todos os produtos visíveis por padrão. */}
                <label className={styles.campoFiltro}>
                  <span>Situação</span>
                  <select
                    value={situacaoSelecionada}
                    onChange={(evento) => {
                      setSituacaoSelecionada(evento.target.value);
                      setPagina(1);
                    }}
                  >
                    <option value="TODOS">Todos</option>
                    <option value="ATIVOS">Ativos</option>
                    <option value="INATIVOS">Inativos</option>
                  </select>
                </label>

                {/* Filtra pelo saldo real, com classificação feita no backend. */}
                <label className={styles.campoFiltro}>
                  <span>Estado do estoque</span>
                  <select
                    value={estadoEstoqueSelecionado}
                    onChange={(evento) => {
                      setEstadoEstoqueSelecionado(evento.target.value);
                      setPagina(1);
                    }}
                  >
                    <option value="TODOS">Todos os estados</option>
                    <option value="NORMAL">Normal</option>
                    <option value="CRITICO">Crítico</option>
                    <option value="SEM_ESTOQUE">Sem estoque</option>
                    <option value="SEM_SALDO">Sem saldo cadastrado</option>
                  </select>
                </label>

                <button
                  type="button"
                  className={styles.botaoLimpar}
                  onClick={() => {
                    setPesquisa("");
                    setCategoriaSelecionada("");
                    setSituacaoSelecionada("TODOS");
                    setEstadoEstoqueSelecionado("TODOS");
                    setPagina(1);
                    setErroCarregamento("");
                  }}
                >
                  Limpar filtros
                </button>
              </div>

              {erroCategoriasFiltro && (
                <p className={styles.erroFormulario} role="alert">
                  {erroCategoriasFiltro}
                </p>
              )}

              {erroCarregamento && (
                <p className={styles.erroFormulario} role="alert">
                  {erroCarregamento}
                </p>
              )}

              <div className={styles.tabelaResponsiva}>
                <table className={styles.tabelaProdutos}>
                  <thead>
                    <tr>
                      <th>Produto</th>
                      <th>SKU</th>
                      <th>Preço de venda</th>
                      {acessoGerencial && <th>Custo</th>}
                      {acessoGerencial && <th>Lucro bruto unitário</th>}
                      {acessoGerencial && <th>Margem bruta</th>}
                      <th>Estoque disponível</th>
                      <th>Estoque mínimo</th>
                      <th>Estado do estoque</th>
                      <th>Situação do produto</th>
                      <th>Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {produtos.map((produto) => {
                      const estadoEstoque = obterEstadoEstoque(produto);
                      const possuiSaldo = produto.saldoEstoque != null;
                                          
                      // Valores atuais cadastrados no produto.
                      const precoVenda = converterValorNumerico(produto.preco);
                      const custoProduto = converterValorNumerico(produto.custo ?? 0);
                                          
                      // Lucro bruto estimado por unidade.
                      const lucroBrutoUnitario = precoVenda - custoProduto;
                                          
                      // Margem bruta sobre o preço de venda.
                      const margemBrutaPercentual =
                        precoVenda > 0
                          ? (lucroBrutoUnitario / precoVenda) * 100
                          : null;
                        return (
                        <tr
                          key={produto.id}
                          style={
                            estadoEstoque.codigo === "SEM_ESTOQUE"
                              ? { backgroundColor: "#fff7f7" }
                              : estadoEstoque.codigo === "CRITICO"
                                ? { backgroundColor: "#fffdf5" }
                                : undefined
                          }
                        >
                          <td>
                            <div className={styles.identificacaoProduto}>
                              <span className={styles.iconeProduto}>▤</span>
                              <span>
                                <strong>{produto.nome}</strong>
                                <small>
                                    { produto.descricao?.trim() &&
                                      produto.descricao.trim().toLocaleLowerCase("pt-BR") !==
                                      produto.nome.trim().toLocaleLowerCase("pt-BR")
                                    ? produto.descricao
                                    : produto.codigoBarras
                                      ? `Código de barras: ${produto.codigoBarras}`
                                      : `ID: ${produto.id}`}
                                </small>
                              </span>
                            </div>
                          </td>
                          <td className={styles.sku}>{produto.sku}</td>
                          <td className={styles.preco}>
                            {formatadorMoeda.format(
                              converterValorNumerico(produto.preco),
                            )}
                          </td>
                          {acessoGerencial && (
                            <td>
                              {formatadorMoeda.format(
                                converterValorNumerico(produto.custo ?? 0),
                              )}
                            </td>
                          )}
                          {acessoGerencial && (
                            <>
                              {/* Lucro bruto estimado por unidade. */}
                              <td
                                className={
                                  lucroBrutoUnitario < 0
                                    ? styles.resultadoNegativo
                                    : lucroBrutoUnitario > 0
                                      ? styles.resultadoPositivo
                                      : styles.resultadoNeutro
                                }
                              >
                                <strong>
                                  {formatadorMoeda.format(lucroBrutoUnitario)}
                                </strong>
                                <small>por unidade</small>
                              </td>
                            </>
                          )}

                          {acessoGerencial && (
                            <>
                              {/* Margem bruta calculada sobre o preço de venda. */}
                              <td>
                                {margemBrutaPercentual === null ? (
                                  <span
                                    className={styles.margemIndisponivel}
                                    title="Não é possível calcular a margem quando o preço de venda é zero."
                                  >
                                    Não calculável
                                  </span>
                                ) : (
                                  <span
                                    className={`${styles.margemBadge} ${
                                      margemBrutaPercentual < 0
                                        ? styles.margemNegativa
                                        : styles.margemPositiva
                                    }`}
                                    title="Margem bruta estimada sobre o preço de venda cadastrado."
                                  >
                                    {formatadorPercentual.format(margemBrutaPercentual)}%
                                  </span>
                                )}
                              </td>
                            </>
                          )}
                          <td>
                            {possuiSaldo
                              ? formatadorQuantidade.format(
                                  converterValorNumerico(
                                    produto.saldoEstoque?.quantidadeDisponivel,
                                  ),
                                )
                              : "—"}
                          </td>
                          <td>
                            {possuiSaldo
                              ? formatadorQuantidade.format(
                                  converterValorNumerico(
                                    produto.saldoEstoque?.estoqueMinimo,
                                  ),
                                )
                              : "—"}
                          </td>
                          <td>
                            <span
                              className={styles.status}
                              style={estadoEstoque.estilo}
                              title={estadoEstoque.detalhe}
                            >
                              {estadoEstoque.rotulo}
                            </span>
                          </td>
                          <td>
                            <span
                              className={`${styles.status} ${
                                produto.ativo
                                  ? styles.statusAdequado
                                  : styles.statusZerado
                              }`}
                            >
                              {produto.ativo ? "Ativo" : "Inativo"}
                            </span>
                          </td>
                          <td>
                            {/* Ações vinculadas ao produto da linha atual. */}
                            <div
                              style={{
                                display: "flex",
                                flexWrap: "wrap",
                                alignItems: "center",
                                gap: "8px",
                                minWidth: "180px",
                              }}
                            >
                              {acessoGerencial && (
                                <button
                                  type="button"
                                  className={styles.botaoSecundario}
                                  onClick={() => router.push(`/produtos/editar/${produto.id}`)}
                                  title="Editar somente os dados cadastrais do produto"
                                >
                                  Editar
                                </button>
                              )}
                              <button
                                type="button"
                                className={styles.botaoSecundario}
                                onClick={() => abrirModalMovimentacao(produto)}
                                disabled={!produto.ativo}
                                title={
                                  produto.ativo
                                    ? "Registrar uma movimentação de estoque"
                                    : "Ative o produto para registrar movimentações"
                                }
                              >
                                Movimentar
                              </button>
                              <button
                                type="button"
                                className={styles.botaoSecundario}
                                onClick={() => abrirHistorico(produto)}
                              >
                                Histórico
                              </button>
                            </div>
                          </td>
                        </tr>
                        );
                      })}

                    {!carregando &&
                      !erroCarregamento &&
                      produtos.length === 0 && (
                        <tr>
                          <td colSpan={acessoGerencial ? 11 : 8} className={styles.semResultados}>
                            {pesquisa.trim()
                              ? "Nenhum produto encontrado para esta pesquisa."
                              : "Nenhum produto cadastrado nesta empresa."}
                          </td>
                        </tr>
                      )}

                    {carregando && (
                      <tr>
                        <td colSpan={acessoGerencial ? 11 : 8} className={styles.semResultados}>
                          Carregando produtos da API...
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div className={styles.acoesFormulario}>
                <button
                  type="button"
                  className={styles.botaoSecundario}
                  disabled={carregando || pagina <= 1}
                  onClick={() => setPagina((atual) => Math.max(1, atual - 1))}
                >
                  Página anterior
                </button>
                <span>
                  Página {pagina} de {totalPaginas}
                </span>
                <button
                  type="button"
                  className={styles.botaoSecundario}
                  disabled={carregando || pagina >= totalPaginas}
                  onClick={() =>
                    setPagina((atual) => Math.min(totalPaginas, atual + 1))
                  }
                >
                  Próxima página
                </button>
              </div>

              <div className={styles.avisoDemonstracao}>
                <strong>Estoque integrado:</strong> registre entradas, saídas e
                ajustes pelo botão <strong>Movimentar</strong>. O botão{" "}
                <strong>Histórico</strong> exibe as movimentações registradas
                para cada produto.
              </div>
            </section>
          </div>
        </main>

        {/* Modal original de cadastro de produto, preservado. */}
        {acessoGerencial && formularioAberto && (
          <div
            className={styles.fundoModal}
            role="presentation"
            onMouseDown={(evento) => {
              if (
                evento.target === evento.currentTarget &&
                !enviando
              ) {
                fecharFormulario();
              }
            }}
          >
            <section
              className={styles.modal}
              role="dialog"
              aria-modal="true"
              aria-labelledby="titulo-modal-produto"
            >
              <div className={styles.cabecalhoModal}>
                <div>
                  <h2 id="titulo-modal-produto">Novo produto</h2>
                  <p>Cadastre o produto e configure seu estoque inicial.</p>
                </div>
                <button
                  type="button"
                  className={styles.botaoFechar}
                  aria-label="Fechar formulário"
                  onClick={fecharFormulario}
                  disabled={enviando}
                >
                  ×
                </button>
              </div>

              <form onSubmit={cadastrarProduto}>
                <div className={styles.camposFormulario}>
                  <label className={styles.campoCompleto}>
                    Nome do produto *
                    <input
                      autoFocus
                      required
                      maxLength={150}
                      value={formulario.nome}
                      onChange={(evento) =>
                        atualizarCampo("nome", evento.target.value)
                      }
                      placeholder="Ex.: Café torrado — 500 g"
                      disabled={enviando}
                    />
                  </label>

                  <label className={styles.campoCompleto}>
                    SKU / Código *
                    <input
                      required
                      maxLength={100}
                      value={formulario.sku}
                      onChange={(evento) =>
                        atualizarCampo("sku", evento.target.value)
                      }
                      placeholder="Ex.: MER-0009"
                      disabled={enviando}
                    />
                  </label>

                  <label className={styles.campoCompleto}>
                    Descrição
                    <input
                      maxLength={1000}
                      value={formulario.descricao}
                      onChange={(evento) =>
                        atualizarCampo("descricao", evento.target.value)
                      }
                      placeholder="Informações adicionais sobre o produto"
                      disabled={enviando}
                    />
                  </label>

                  <label className={styles.campoCompleto}>
                    Código de barras
                    <input
                      maxLength={100}
                      value={formulario.codigoBarras}
                      onChange={(evento) =>
                        atualizarCampo("codigoBarras", evento.target.value)
                      }
                      placeholder="Código de barras, se houver"
                      disabled={enviando}
                    />
                  </label>

                  {/* Listas auxiliares usam IDs validados no backend pelo tenant autenticado. */}
                  <label>
                    Categoria (opcional)
                    <select
                      value={formulario.categoriaId}
                      onChange={(evento) => atualizarCampo("categoriaId", evento.target.value)}
                      disabled={enviando || carregandoCadastros || Boolean(erroCadastros)}
                    >
                      <option value="">Sem categoria</option>
                      {categoriasCadastro.map((categoria) => {
                        const pai = categoriasCadastro.find((item) => item.id === categoria.categoriaPaiId);
                        return (
                          <option key={categoria.id} value={categoria.id}>
                            {pai ? `${pai.nome} / ${categoria.nome}` : categoria.nome}
                          </option>
                        );
                      })}
                    </select>
                  </label>
                  <label>
                    Unidade de medida (opcional)
                    <select
                      value={formulario.unidadeId}
                      onChange={(evento) => atualizarCampo("unidadeId", evento.target.value)}
                      disabled={enviando || carregandoCadastros || Boolean(erroCadastros)}
                    >
                      <option value="">Sem unidade definida</option>
                      {unidadesCadastro.map((unidade) => (
                        <option key={unidade.id} value={unidade.id}>
                          {unidade.codigo} — {unidade.nome}
                        </option>
                      ))}
                    </select>
                  </label>
                  {carregandoCadastros && (
                    <p className={styles.campoCompleto} role="status">Carregando categorias e unidades...</p>
                  )}
                  {erroCadastros && (
                    <p className={styles.campoCompleto} role="alert">
                      Não foi possível carregar categorias e unidades: {erroCadastros}.
                      O produto ainda pode ser cadastrado sem esses vínculos.
                    </p>
                  )}

                  <label>
                    Preço de venda (R$) *
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      required
                      value={formulario.preco}
                      onChange={(evento) =>
                        atualizarCampo("preco", evento.target.value)
                      }
                      placeholder="0,00"
                      disabled={enviando}
                    />
                  </label>

                  <label>
                    Custo (R$) *
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      required
                      value={formulario.custo}
                      onChange={(evento) =>
                        atualizarCampo("custo", evento.target.value)
                      }
                      placeholder="0,00"
                      disabled={enviando}
                    />
                  </label>

                  <label>
                    Estoque inicial
                    <input
                      type="number"
                      min="0"
                      step="0.001"
                      required
                      value={formulario.quantidadeInicial}
                      onChange={(evento) =>
                        atualizarCampo(
                          "quantidadeInicial",
                          evento.target.value,
                        )
                      }
                      placeholder="0"
                      disabled={enviando}
                    />
                    <small>Quantidade disponível no início.</small>
                  </label>

                  <label>
                    Estoque mínimo
                    <input
                      type="number"
                      min="0"
                      step="0.001"
                      required
                      value={formulario.estoqueMinimo}
                      onChange={(evento) =>
                        atualizarCampo("estoqueMinimo", evento.target.value)
                      }
                      placeholder="0"
                      disabled={enviando}
                    />
                    <small>Quantidade mínima desejada antes de repor.</small>
                  </label>
                </div>

                {erroFormulario && (
                  <p className={styles.erroFormulario} role="alert">
                    {erroFormulario}
                  </p>
                )}

                <div className={styles.acoesFormulario}>
                  <button
                    type="button"
                    className={styles.botaoSecundario}
                    onClick={fecharFormulario}
                    disabled={enviando}
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    className={styles.botaoPrincipal}
                    disabled={enviando}
                  >
                    {enviando ? "Salvando..." : "Cadastrar produto"}
                  </button>
                </div>

                <p className={styles.notaFormulario}>
                  O produto será vinculado à empresa autenticada. O estoque
                  inicial e o estoque mínimo serão enviados junto com o cadastro.
                </p>
              </form>
            </section>
          </div>
        )}

        {/* Modal para registrar entradas, saídas ou ajustes de estoque. */}
        {modalMovimentacaoAberto && produtoMovimentacao && (
          <div
            className={styles.fundoModal}
            role="presentation"
            onMouseDown={(evento) => {
              if (
                evento.target === evento.currentTarget &&
                !enviandoMovimentacao
              ) {
                fecharModalMovimentacao();
              }
            }}
          >
            <section
              className={styles.modal}
              role="dialog"
              aria-modal="true"
              aria-labelledby="titulo-modal-movimentacao"
            >
			              <div className={styles.cabecalhoModal}>
                <div>
                  <h2 id="titulo-modal-movimentacao">
                    Movimentar estoque
                  </h2>
                  <p>
                    Produto: <strong>{produtoMovimentacao.nome}</strong> · SKU{" "}
                    {produtoMovimentacao.sku}
                  </p>
                  <p>
                    Saldo disponível atual: <strong>
                      {formatadorQuantidade.format(
                        converterValorNumerico(
                          produtoMovimentacao.saldoEstoque
                            ?.quantidadeDisponivel,
                        ),
                      )}
                    </strong>
                  </p>
                </div>
                <button
                  type="button"
                  className={styles.botaoFechar}
                  aria-label="Fechar movimentação"
                  onClick={fecharModalMovimentacao}
                  disabled={enviandoMovimentacao}
                >
                  ×
                </button>
              </div>

              <form onSubmit={registrarMovimentacao}>
                <div className={styles.camposFormulario}>
                  <label className={styles.campoCompleto}>
                    Tipo de movimentação *
                    <select
                      required
                      value={tipoMovimentacao}
                      onChange={(evento) => {
                        setTipoMovimentacao(
                          evento.target.value as TipoMovimentacao,
                        );
                        setErroMovimentacao("");
                      }}
                      disabled={enviandoMovimentacao}
                    >
                      <option value="ENTRADA">Entrada — acrescentar estoque</option>
                      <option value="SAIDA">Saída — retirar estoque</option>
                      <option value="AJUSTE">Ajuste — corrigir saldo</option>
                    </select>
                  </label>

                  <label className={styles.campoCompleto}>
                    Quantidade *
                    <input
                      type="number"
                      required
                      step="0.001"
                      min={tipoMovimentacao === "AJUSTE" ? undefined : "0.001"}
                      value={quantidadeMovimentacao}
                      onChange={(evento) =>
                        setQuantidadeMovimentacao(evento.target.value)
                      }
                      placeholder={tipoMovimentacao === "AJUSTE" ? "Ex.: -2 ou 2" : "Ex.: 5"}
                      disabled={enviandoMovimentacao}
                    />
                    <small>
                      {tipoMovimentacao === "AJUSTE"
                        ? "Use um valor positivo para aumentar ou negativo para reduzir o saldo."
                        : "Informe uma quantidade positiva, com até três casas decimais."}
                    </small>
                  </label>

                  <label className={styles.campoCompleto}>
                    Motivo da movimentação *
                    <input
                      required
                      maxLength={250}
                      value={motivoMovimentacao}
                      onChange={(evento) =>
                        setMotivoMovimentacao(evento.target.value)
                      }
                      placeholder="Ex.: compra de fornecedor, venda, perda ou inventário"
                      disabled={enviandoMovimentacao}
                    />
                    <small>{motivoMovimentacao.length}/250 caracteres</small>
                  </label>

                  <label className={styles.campoCompleto}>
                    Referência (opcional)
                    <input
                      maxLength={100}
                      value={referenciaMovimentacao}
                      onChange={(evento) =>
                        setReferenciaMovimentacao(evento.target.value)
                      }
                      placeholder="Ex.: número da nota, pedido ou documento"
                      disabled={enviandoMovimentacao}
                    />
                  </label>
                </div>

                {erroMovimentacao && (
                  <p className={styles.erroFormulario} role="alert">
                    {erroMovimentacao}
                  </p>
                )}

                <div className={styles.acoesFormulario}>
                  <button
                    type="button"
                    className={styles.botaoSecundario}
                    onClick={fecharModalMovimentacao}
                    disabled={enviandoMovimentacao}
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    className={styles.botaoPrincipal}
                    disabled={enviandoMovimentacao}
                  >
                    {enviandoMovimentacao
                      ? "Registrando..."
                      : "Registrar movimentação"}
                  </button>
                </div>

                <p className={styles.notaFormulario}>
                  O sistema registra o movimento e atualiza o saldo na mesma
                  transação. Não é permitido deixar o estoque disponível negativo.
                </p>
              </form>
            </section>
          </div>
        )}

        {/* Modal para consultar o histórico de estoque de um produto. */}
        {historicoAberto && produtoHistorico && (
          <div
            className={styles.fundoModal}
            role="presentation"
            onMouseDown={(evento) => {
              if (evento.target === evento.currentTarget) fecharHistorico();
            }}
          >
            <section
              className={styles.modal}
              role="dialog"
              aria-modal="true"
              aria-labelledby="titulo-modal-historico"
              style={{ width: "min(1100px, 96vw)", maxWidth: "1100px" }}
            >
              <div className={styles.cabecalhoModal}>
                <div>
                  <h2 id="titulo-modal-historico">Histórico de estoque</h2>
                  <p>
                    <strong>{produtoHistorico.nome}</strong> · SKU{" "}
                    {produtoHistorico.sku}
                  </p>
                  <p>
                    {totalHistorico} movimentação(ões) registrada(s)
                  </p>
                </div>
                <button
                  type="button"
                  className={styles.botaoFechar}
                  aria-label="Fechar histórico"
                  onClick={fecharHistorico}
                >
                  ×
                </button>
              </div>

              {erroHistorico && (
                <p className={styles.erroFormulario} role="alert">
                  {erroHistorico}
                </p>
              )}

              <div className={styles.tabelaResponsiva}>
                <table className={styles.tabelaProdutos}>
                  <thead>
                    <tr>
                      <th>Data e hora</th>
                      <th>Tipo</th>
                      <th>Quantidade</th>
                      <th>Saldo após</th>
                      <th>Motivo</th>
                      <th>Referência</th>
                    </tr>
                  </thead>
                  <tbody>
                    {!carregandoHistorico &&
                      !erroHistorico &&
                      movimentacoes.map((movimentacao) => (
                        <tr key={movimentacao.id}>
                          <td>{formatarDataHora(movimentacao.criadoEm)}</td>
                          <td>
                            <span
                              className={`${styles.status} ${
                                movimentacao.tipo === "SAIDA"
                                  ? styles.statusZerado
                                  : styles.statusAdequado
                              }`}
                            >
                              {rotuloMovimentacao(movimentacao.tipo)}
                            </span>
                          </td>
                          <td>
                            {formatadorQuantidade.format(
                              converterValorNumerico(movimentacao.quantidade),
                            )}
                          </td>
                          <td>
                            {formatadorQuantidade.format(
                              converterValorNumerico(movimentacao.saldoApos),
                            )}
                          </td>
                          <td>{movimentacao.motivo || "—"}</td>
                          <td>{movimentacao.referenciaId || "—"}</td>
                        </tr>
                      ))}

                    {!carregandoHistorico &&
                      !erroHistorico &&
                      movimentacoes.length === 0 && (
                        <tr>
                          <td colSpan={6} className={styles.semResultados}>
                            Nenhuma movimentação encontrada para este produto.
                          </td>
                        </tr>
                      )}

                    {carregandoHistorico && (
                      <tr>
                        <td colSpan={6} className={styles.semResultados}>
                          Carregando histórico de movimentações...
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div className={styles.acoesFormulario}>
                <button
                  type="button"
                  className={styles.botaoSecundario}
                  disabled={carregandoHistorico || paginaHistorico <= 1}
                  onClick={() =>
                    setPaginaHistorico((atual) => Math.max(1, atual - 1))
                  }
                >
                  Página anterior
                </button>
                <span>
                  Página {paginaHistorico} de {totalPaginasHistorico}
                </span>
                <button
                  type="button"
                  className={styles.botaoSecundario}
                  disabled={
                    carregandoHistorico ||
                    paginaHistorico >= totalPaginasHistorico
                  }
                  onClick={() =>
                    setPaginaHistorico((atual) =>
                      Math.min(totalPaginasHistorico, atual + 1),
                    )
                  }
                >
                  Próxima página
                </button>
              </div>

              <div className={styles.acoesFormulario}>
                <button
                  type="button"
                  className={styles.botaoSecundario}
                  disabled={carregandoHistorico}
                  onClick={() => setAtualizacaoHistorico((valor) => valor + 1)}
                >
                  Atualizar histórico
                </button>
                <button
                  type="button"
                  className={styles.botaoPrincipal}
                  onClick={fecharHistorico}
                >
                  Fechar
                </button>
              </div>
              <p className={styles.notaFormulario}>
                O histórico é exibido do registro mais recente para o mais antigo.
              </p>
            </section>
          </div>
        )}
      </div>
    </ProtecaoSessao>
  );
}