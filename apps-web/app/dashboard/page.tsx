"use client";

/**
 * Dashboard operacional do Gestão Comercial Multi-Ramo.
 *
 * Integração atual:
 * - Indicadores financeiros e gráfico de vendas consultam a API.
 * - O resumo e os alertas de estoque vêm do backend.
 * - As atividades recentes reúnem vendas, produtos e estoque.
 *
 * Segurança:
 * - O token é lido do sessionStorage somente no navegador.
 * - As consultas utilizam o JWT e respeitam a empresa autenticada.
 */

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./dashboard.module.css";

// Componentes compartilhados de proteção da sessão e encerramento local.
import { ProtecaoSessao } from "../componentes/protecao-sessao";
import { MenuLateral } from "../componentes/menu-lateral";

// Mantém o endereço padrão utilizado também pela página de produtos.
const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5433";

/** Alerta de estoque enviado pelo endpoint do backend. */
type AlertaEstoqueDashboard = {
  id: string;
  nome: string;
  sku: string;
  ativo: boolean;
  estado: "SEM_ESTOQUE" | "CRITICO";
  quantidadeDisponivel: number;
  estoqueMinimo: number;
};

/** Resumo completo calculado pelo backend para a empresa autenticada. */
type ResumoEstoqueDashboard = {
  totalProdutos: number;
  produtosAtivos: number;
  produtosInativos: number;
  estoqueAdequado: number;
  estoqueCritico: number;
  semEstoque: number;
  semSaldo: number;
  totalAlertas: number;
  alertas: AlertaEstoqueDashboard[];
};

/** Indicadores financeiros de um mês. */
type IndicadoresMesDashboard = {
  faturamento: number;
  quantidadeVendas: number;
  ticketMedio: number;
};

/** Faturamento e quantidade de vendas de um dia. */
type DiaVendasDashboard = {
  data: string;
  dia: string;
  faturamento: number;
  quantidadeVendas: number;
};

/** Resposta da API de resumo comercial. */
type ResumoVendasDashboard = {
  mesAtual: IndicadoresMesDashboard;
  mesAnterior: IndicadoresMesDashboard;
  ultimosSeteDias: DiaVendasDashboard[];
};

/** Uma modalidade de pagamento consolidada pela API. */
type FormaPagamentoDashboard = {
  formaPagamento:
    | "DINHEIRO"
    | "PIX"
    | "CARTAO_DEBITO"
    | "CARTAO_CREDITO"
    | "OUTRO";
  nome: string;
  faturamento: number;
  quantidadeVendas: number;
  percentualFaturamento: number;
  percentualVendas: number;
};

/** Resultado agregado de vendas por produto. */
type ProdutoRankingDashboard = {
  produtoId: string;
  nome: string;
  sku: string;
  quantidadeVendida: number;
  faturamento: number;
};

/** Resposta do endpoint de análise comercial. */
type AnaliseDashboard = {
  periodo: {
    inicio: string;
    fim: string;
  };
  faturamentoTotal: number;
  quantidadeTotalVendas: number;
  formasPagamento: FormaPagamentoDashboard[];
  produtosPorQuantidade: ProdutoRankingDashboard[];
  produtosPorFaturamento: ProdutoRankingDashboard[];
};

/** Formata quantidades sem casas decimais desnecessárias. */
const formatadorQuantidadeDashboard = new Intl.NumberFormat("pt-BR", {
  maximumFractionDigits: 3,
});
/** Formata quantidades sem casas decimais desnecessárias. */
/** Formata valores monetários em reais. */
const formatadorMoedaDashboard = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

/** Formata os rótulos do eixo financeiro do gráfico. */
const formatadorMoedaCompactaDashboard = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  notation: "compact",
  maximumFractionDigits: 1,
});

/** Formato mínimo dos erros de resposta enviados pelo NestJS. */
type ErroApiDashboard = {
  message?: string | string[];
  error?: string;
};

/**
 * Atividade consolidada retornada pela API do dashboard.
 * Os campos opcionais variam conforme o tipo de evento.
 */
type AtividadeDashboard = {
  id: string;
  tipo:
    | "VENDA"
    | "PRODUTO_CADASTRADO"
    | "ENTRADA"
    | "SAIDA"
    | "AJUSTE"
    | "RESERVA"
    | "LIBERACAO";
  titulo: string;
  detalhe: string;
  referencia: string;
  criadoEm: string;
  valor?: number;
  responsavel?: string;
  quantidade?: number;
  saldoApos?: number;
};

/**
 * Indicadores de vendas e finanças.
 */
const indicadores = [
  {
    titulo: "Faturamento do mês",
    icone: "R$",
  },
  {
    titulo: "Vendas realizadas",
    icone: "↗",
  },
  {
    titulo: "Ticket médio",
    icone: "◉",
  },
  {
    titulo: "Faturamento de hoje",
    icone: "◷",
  },
  {
    titulo: "Produtos cadastrados",
    icone: "▤",
  },
];


/** Componente principal do Dashboard. */
export default function DashboardPage() {
    const router = useRouter();
  // Nome da empresa retornado pela API durante o login.
  const [nomeEmpresa, setNomeEmpresa] = useState("Empresa autenticada");
  const [perfilUsuario, setPerfilUsuario] = useState<string | null>(null);
  const [sessaoCarregada, setSessaoCarregada] = useState(false);
  const [resumoEstoque, setResumoEstoque] =
    useState<ResumoEstoqueDashboard | null>(null);
  const [carregandoResumo, setCarregandoResumo] = useState(true);
  const [erroResumo, setErroResumo] = useState("");
  const [tentativaResumo, setTentativaResumo] = useState(0);
  const [atividadesRecentes, setAtividadesRecentes] =  useState<AtividadeDashboard[]>([]);
  const [carregandoAtividades, setCarregandoAtividades] = useState(true);
  const [erroAtividades, setErroAtividades] = useState("");
  const [tentativaAtividades, setTentativaAtividades] = useState(0);

  // Indicadores comerciais consultados na API.
  const [resumoVendas, setResumoVendas] =
    useState<ResumoVendasDashboard | null>(null);

  const [carregandoVendas, setCarregandoVendas] = useState(true);
  const [erroVendas, setErroVendas] = useState("");
  const [tentativaVendas, setTentativaVendas] = useState(0);
  // Dados reais dos gráficos de pagamento e produtos vendidos.
  const [analiseDashboard, setAnaliseDashboard] = useState<AnaliseDashboard | null>(null);

const [carregandoAnalise, setCarregandoAnalise] = useState(true);
const [erroAnalise, setErroAnalise] = useState("");
const [tentativaAnalise, setTentativaAnalise] = useState(0);

// Permite alternar o ranking por quantidade ou faturamento.
const [criterioRanking, setCriterioRanking] =
  useState<"quantidade" | "faturamento">("quantidade");

  // Somente administradores e gerentes visualizam dados financeiros.
  const acessoGerencial =
    perfilUsuario === "ADMINISTRADOR" || perfilUsuario === "GERENTE";

  /**
 * Recupera o nome da empresa e o perfil salvos no login.
 * A leitura ocorre no navegador, após a montagem do componente.
 */
useEffect(() => {
  try {
    const usuarioSalvo = sessionStorage.getItem("gestao.usuario");

    if (usuarioSalvo) {
      const usuario = JSON.parse(usuarioSalvo) as {
        empresaNome?: unknown;
        perfil?: unknown;
      };

      if (
        typeof usuario.empresaNome === "string" &&
        usuario.empresaNome.trim().length > 0
      ) {
        setNomeEmpresa(usuario.empresaNome.trim());
      }

      if (typeof usuario.perfil === "string") {
        setPerfilUsuario(usuario.perfil);
      }
    }
  } catch {
    // Uma sessão inválida nunca habilita acesso gerencial.
    setNomeEmpresa("Empresa autenticada");
    setPerfilUsuario(null);
  } finally {
    setSessaoCarregada(true);
  }
}, []);

  /**
 * Consulta as análises de pagamento e produtos vendidos.
 * A API identifica a empresa por meio do token autenticado.
 */
useEffect(() => {
  // Aguarda a identificação do perfil antes de consultar a API.
  if (!sessaoCarregada) return;

  // Funcionários não consultam o endpoint financeiro.
  if (!acessoGerencial) {
    setAnaliseDashboard(null);
    setErroAnalise("");
    setCarregandoAnalise(false);
    return;
  }

  let componenteAtivo = true;
  const controlador = new AbortController();

  async function carregarAnaliseDashboard() {
    setCarregandoAnalise(true);
    setErroAnalise("");

    const token = sessionStorage.getItem("gestao.accessToken");

    if (!token) {
      router.replace("/");
      if (componenteAtivo) {
        setCarregandoAnalise(false);
      }
      return;
    }

    try {
      const resposta = await fetch(
        `${API_URL}/vendas/dashboard/analise`,
        {
          method: "GET",
          headers: {
            Accept: "application/json",
            Authorization: `Bearer ${token}`,
          },
          cache: "no-store",
          signal: controlador.signal,
        },
      );

      const dados: unknown = await resposta.json().catch(() => null);

      // Encerra a sessão local se a API rejeitar a autenticação.
      if (resposta.status === 401) {
        sessionStorage.removeItem("gestao.accessToken");
        sessionStorage.removeItem("gestao.usuario");
        router.replace("/");
        return;
      }

      if (!resposta.ok) {
        const erroApi =
          dados && typeof dados === "object"
            ? (dados as ErroApiDashboard)
            : {};

        const mensagem = Array.isArray(erroApi.message)
          ? erroApi.message.join(", ")
          : typeof erroApi.message === "string"
            ? erroApi.message
            : "Não foi possível consultar a análise comercial.";

        throw new Error(mensagem);
      }

      if (!dados || typeof dados !== "object") {
        throw new Error("A API retornou uma análise inválida.");
      }

      const analise = dados as Partial<AnaliseDashboard>;

      // Confere os números recebidos antes de utilizá-los nos gráficos.
      const numeroValido = (valor: unknown): valor is number =>
        typeof valor === "number" && Number.isFinite(valor);

      const formasValidas =
        Array.isArray(analise.formasPagamento) &&
        analise.formasPagamento.every(
          (item) =>
            item &&
            typeof item.nome === "string" &&
            numeroValido(item.faturamento) &&
            numeroValido(item.quantidadeVendas) &&
            numeroValido(item.percentualFaturamento) &&
            numeroValido(item.percentualVendas),
        );

      const rankingValido = (
        itens: unknown,
      ): itens is ProdutoRankingDashboard[] =>
        Array.isArray(itens) &&
        itens.every(
          (item) =>
            item &&
            typeof item.produtoId === "string" &&
            typeof item.nome === "string" &&
            typeof item.sku === "string" &&
            numeroValido(item.quantidadeVendida) &&
            numeroValido(item.faturamento),
        );

      if (
        !numeroValido(analise.faturamentoTotal) ||
        !numeroValido(analise.quantidadeTotalVendas) ||
        !formasValidas ||
        !rankingValido(analise.produtosPorQuantidade) ||
        !rankingValido(analise.produtosPorFaturamento)
      ) {
        throw new Error(
          "A API retornou dados em formato inesperado para os gráficos.",
        );
      }

      if (componenteAtivo) {
        setAnaliseDashboard(analise as AnaliseDashboard);
      }
    } catch (erro) {
      if (controlador.signal.aborted) return;

      if (componenteAtivo) {
        setErroAnalise(
          erro instanceof Error
            ? erro.message
            : "Erro ao consultar a análise comercial.",
        );
      }
    } finally {
      if (componenteAtivo) {
        setCarregandoAnalise(false);
      }
    }
  }

  void carregarAnaliseDashboard();

  return () => {
    componenteAtivo = false;
    controlador.abort();
  };
}, [router, tentativaAnalise, sessaoCarregada, acessoGerencial]);

  /**
   * Define os títulos e ícones dos indicadores do dashboard.
   * Os valores são preenchidos dinamicamente a partir das APIs.
   */
  useEffect(() => {
    // Aguarda a leitura do perfil antes de consultar indicadores.
    if (!sessaoCarregada) return;

    // Perfis operacionais não consultam o resumo financeiro.
    if (!acessoGerencial) {
      setResumoVendas(null);
      setErroVendas("");
      setCarregandoVendas(false);
      return;
    }

    let componenteAtivo = true;
    const controlador = new AbortController();

    async function carregarResumoVendas() {
      setCarregandoVendas(true);
      setErroVendas("");

      const token = sessionStorage.getItem("gestao.accessToken");

      if (!token) {
        router.replace("/");
        if (componenteAtivo) setCarregandoVendas(false);
        return;
      }

      try {
        const resposta = await fetch(
          `${API_URL}/vendas/dashboard/resumo`,
          {
            method: "GET",
            headers: {
              Accept: "application/json",
              Authorization: `Bearer ${token}`,
            },
            cache: "no-store",
            signal: controlador.signal,
          },
        );

        const dados: unknown = await resposta.json().catch(() => null);

        // Encerra a sessão local quando a autenticação não é aceita.
        if (resposta.status === 401) {
          sessionStorage.removeItem("gestao.accessToken");
          sessionStorage.removeItem("gestao.usuario");
          router.replace("/");
          return;
        }

        if (!resposta.ok) {
          const erroApi =
            dados && typeof dados === "object"
              ? (dados as ErroApiDashboard)
              : {};

          const mensagem = Array.isArray(erroApi.message)
            ? erroApi.message.join(", ")
            : typeof erroApi.message === "string"
              ? erroApi.message
              : "Não foi possível consultar os indicadores de vendas.";

          throw new Error(mensagem);
        }

        if (!dados || typeof dados !== "object") {
          throw new Error("A API retornou um resumo de vendas inválido.");
        }

        const resumo = dados as Partial<ResumoVendasDashboard>;

        // Valida os números antes de disponibilizá-los para a interface.
        function indicadorMensalValido(
          indicador: unknown,
        ): indicador is IndicadoresMesDashboard {
          if (!indicador || typeof indicador !== "object") {
            return false;
          }

          const valores = indicador as Record<string, unknown>;

          return [
            "faturamento",
            "quantidadeVendas",
            "ticketMedio",
          ].every(
            (campo) =>
              typeof valores[campo] === "number" &&
              Number.isFinite(valores[campo]),
          );
        }

        const diasValidos =
          Array.isArray(resumo.ultimosSeteDias) &&
          resumo.ultimosSeteDias.length === 7 &&
          resumo.ultimosSeteDias.every((dia) =>
            dia &&
            typeof dia.data === "string" &&
            typeof dia.dia === "string" &&
            typeof dia.faturamento === "number" &&
            Number.isFinite(dia.faturamento) &&
            typeof dia.quantidadeVendas === "number" &&
            Number.isFinite(dia.quantidadeVendas),
          );

        if (
          !indicadorMensalValido(resumo.mesAtual) ||
          !indicadorMensalValido(resumo.mesAnterior) ||
          !diasValidos
        ) {
          throw new Error(
            "A API retornou um formato inesperado para os indicadores de vendas.",
          );
        }

        if (componenteAtivo) {
          setResumoVendas(resumo as ResumoVendasDashboard);
        }
      } catch (erro) {
        if (controlador.signal.aborted) return;

        if (componenteAtivo) {
          setErroVendas(
            erro instanceof Error
              ? erro.message
              : "Erro ao consultar os indicadores de vendas.",
          );
        }
      } finally {
        if (componenteAtivo) {
          setCarregandoVendas(false);
        }
      }
    }

    void carregarResumoVendas();

    return () => {
      componenteAtivo = false;
      controlador.abort();
    };
  }, [router, tentativaVendas, sessaoCarregada, acessoGerencial]);


  /**
   * Consulta o resumo de estoque de toda a empresa autenticada.
   * O AbortController cancela a solicitação se a página for desmontada.
   */
    /**
   * Consulta as movimentações recentes da empresa autenticada.
   * O backend limita o retorno aos cinco registros mais recentes.
   */
  useEffect(() => {
    let componenteAtivo = true;
    const controlador = new AbortController();

    async function carregarAtividadesRecentes() {
      setCarregandoAtividades(true);
      setErroAtividades("");

      const token = sessionStorage.getItem("gestao.accessToken");

      if (!token) {
        router.replace("/");
        if (componenteAtivo) setCarregandoAtividades(false);
        return;
      }

      try {
        const resposta = await fetch(
          `${API_URL}/vendas/dashboard/atividades-recentes`,
          {
            method: "GET",
            headers: {
              Accept: "application/json",
              Authorization: `Bearer ${token}`,
            },
            cache: "no-store",
            signal: controlador.signal,
          },
        );

        const dados: unknown = await resposta.json().catch(() => null);

        if (resposta.status === 401) {
          sessionStorage.removeItem("gestao.accessToken");
          sessionStorage.removeItem("gestao.usuario");
          router.replace("/");
          return;
        }

        if (!resposta.ok) {
          const erroApi =
            dados && typeof dados === "object"
              ? (dados as ErroApiDashboard)
              : {};

          const mensagem = Array.isArray(erroApi.message)
            ? erroApi.message.join(", ")
            : typeof erroApi.message === "string"
              ? erroApi.message
              : "Não foi possível consultar as atividades recentes.";

          throw new Error(mensagem);
        }

        if (!Array.isArray(dados)) {
          throw new Error(
            "A API retornou um formato inesperado para as atividades recentes.",
          );
        }

        if (componenteAtivo) {
          setAtividadesRecentes(
            dados as AtividadeDashboard[],
          );
        }
      } catch (erro) {
        if (controlador.signal.aborted) return;
        if (componenteAtivo) {
          setErroAtividades(
            erro instanceof Error
              ? erro.message
              : "Erro ao consultar as atividades recentes.",
          );
        }
      } finally {
        if (componenteAtivo) {
          setCarregandoAtividades(false);
        }
      }
    }

    void carregarAtividadesRecentes();

    return () => {
      componenteAtivo = false;
      controlador.abort();
    };
  }, [router, tentativaAtividades]);

  useEffect(() => {
    let componenteAtivo = true;
    const controlador = new AbortController();

    async function carregarResumoEstoque() {
      setCarregandoResumo(true);
      setErroResumo("");

      const token = sessionStorage.getItem("gestao.accessToken");

      if (!token) {
        router.replace("/");
        if (componenteAtivo) setCarregandoResumo(false);
        return;
      }

      try {
        const resposta = await fetch(
          `${API_URL}/produtos/resumo-estoque`,
          {
            method: "GET",
            headers: {
              Accept: "application/json",
              Authorization: `Bearer ${token}`,
            },
            cache: "no-store",
            signal: controlador.signal,
          },
        );

        const dados = (await resposta.json().catch(() => ({}))) as
          Partial<ResumoEstoqueDashboard> & ErroApiDashboard;

        // Token expirado ou acesso negado: encerra a sessão local.
        if (resposta.status === 401) {
          sessionStorage.removeItem("gestao.accessToken");
          sessionStorage.removeItem("gestao.usuario");
          router.replace("/");
          return;
        }

        if (!resposta.ok) {
          const mensagem = Array.isArray(dados.message)
            ? dados.message.join(", ")
            : typeof dados.message === "string"
              ? dados.message
              : "Não foi possível consultar o estoque.";

          throw new Error(mensagem);
        }

        // Confere todos os indicadores numéricos antes de usar a resposta.
        const camposNumericos: Array<keyof ResumoEstoqueDashboard> = [
          "totalProdutos",
          "produtosAtivos",
          "produtosInativos",
          "estoqueAdequado",
          "estoqueCritico",
          "semEstoque",
          "semSaldo",
          "totalAlertas",
        ];

        const resumoValido = camposNumericos.every((campo) =>
          typeof dados[campo] === "number" &&
          Number.isFinite(dados[campo]),
        );

        if (!resumoValido || !Array.isArray(dados.alertas)) {
          throw new Error(
            "A API retornou um formato inesperado para o resumo de estoque.",
          );
        }

        if (componenteAtivo) {
          setResumoEstoque(dados as ResumoEstoqueDashboard);
        }
      } catch (erro) {
        // O cancelamento decorrente da desmontagem não é erro de tela.
        if (controlador.signal.aborted) return;

        if (componenteAtivo) {
          setErroResumo(
            erro instanceof Error
              ? erro.message
              : "Ocorreu um erro ao consultar o estoque.",
          );
        }
      } finally {
        if (componenteAtivo) setCarregandoResumo(false);
      }
    }

    void carregarResumoEstoque();

    return () => {
      componenteAtivo = false;
      controlador.abort();
    };
  }, [router, tentativaResumo]);

  /**
   * Compara um indicador mensal com o valor do mês anterior.
   * Quando o mês anterior não tem movimento, evita calcular
   * uma porcentagem enganosa.
   */
  function calcularVariacaoDashboard(
    atual: number,
    anterior: number,
  ): { texto: string; classe: string } {
    if (anterior <= 0) {
      return {
        texto: atual > 0 ? "Sem base anterior" : "Sem movimentação",
        classe: styles.neutralText,
      };
    }

    const percentual = ((atual - anterior) / anterior) * 100;
    const sinal = percentual > 0 ? "+" : "";

    return {
      texto:
        `${sinal}${percentual.toLocaleString("pt-BR", {
          maximumFractionDigits: 1,
        })}% vs. mês anterior`,
      classe:
        percentual < 0 ? styles.negativeText : styles.positive,
    };
  }

  // Atualiza os quatro cards sem alterar o layout existente.
  const indicadoresExibidos = indicadores.map((item, index) => {
    // O quarto card continua utilizando o resumo real do estoque.
    if (index === 4) {
      return {
        ...item,
        valor: resumoEstoque
          ? formatadorQuantidadeDashboard.format(
              resumoEstoque.totalProdutos,
            )
          : carregandoResumo
            ? "..."
            : "—",
        variacao: resumoEstoque
          ? `${formatadorQuantidadeDashboard.format(
              resumoEstoque.totalAlertas,
            )} alertas`
          : carregandoResumo
            ? "Consultando..."
            : "Indisponível",
        descricao: resumoEstoque
          ? "produtos com estoque crítico ou zerado"
          : "dados reais do estoque",
        variacaoClasse: styles.warningText,
      };
    }

    if (!resumoVendas) {
      const descricao = erroVendas
        ? "não foi possível carregar os dados"
        : "consultando os dados reais";

      return {
        ...item,
        valor: carregandoVendas ? "..." : "—",
        variacao: carregandoVendas ? "Consultando..." : "Indisponível",
        descricao,
        variacaoClasse: styles.neutralText,
      };
    }

    if (index === 3) {
      const dias = resumoVendas.ultimosSeteDias;
      const hoje = dias[dias.length - 1];
      const faturamentoHoje = hoje?.faturamento ?? 0;
      const quantidadeVendasHoje = hoje?.quantidadeVendas ?? 0;

      return {
        ...item,
        valor: formatadorMoedaDashboard.format(faturamentoHoje),
        variacao:
          formatadorQuantidadeDashboard.format(quantidadeVendasHoje) +
          (quantidadeVendasHoje === 1 ? " venda hoje" : " vendas hoje"),
        descricao: "faturamento registrado hoje",
        variacaoClasse: styles.neutralText,
      };
    }

    const valoresAtuais = [
      resumoVendas.mesAtual.faturamento,
      resumoVendas.mesAtual.quantidadeVendas,
      resumoVendas.mesAtual.ticketMedio,
    ];

    const valoresAnteriores = [
      resumoVendas.mesAnterior.faturamento,
      resumoVendas.mesAnterior.quantidadeVendas,
      resumoVendas.mesAnterior.ticketMedio,
    ];

    const valorAtual = valoresAtuais[index] ?? 0;
    const valorAnterior = valoresAnteriores[index] ?? 0;
    const variacao = calcularVariacaoDashboard(
      valorAtual,
      valorAnterior,
    );

    const valorFormatado =
      index === 1
        ? formatadorQuantidadeDashboard.format(valorAtual)
        : formatadorMoedaDashboard.format(valorAtual);

    const descricoes = [
      "faturamento do mês atual",
      "vendas registradas neste mês",
      "valor médio por venda no mês",
    ];

    return {
      ...item,
      valor: valorFormatado,
      variacao: variacao.texto,
      descricao: descricoes[index] ?? "",
      variacaoClasse: variacao.classe,
    };
  });

  const indicadoresVisiveis = acessoGerencial
    ? indicadoresExibidos
    : indicadoresExibidos.filter(
        (item) => item.titulo === "Produtos cadastrados",
      );

  // Valores reais para o gráfico dos últimos sete dias.
  const diasVendas = resumoVendas?.ultimosSeteDias ?? [];

  const faturamentoSeteDias = diasVendas.reduce(
    (total, dia) => total + dia.faturamento,
    0,
  );

  const maiorFaturamentoDia = Math.max(
    0,
    ...diasVendas.map((dia) => dia.faturamento),
  );

  const vendasSemanaExibidas = diasVendas.map((dia) => ({
    ...dia,
    altura:
      maiorFaturamentoDia > 0
        ? (dia.faturamento / maiorFaturamentoDia) * 100
        : 0,
  }));

  // Modalidades e cores utilizadas no gráfico de formas de pagamento.
  const coresFormasPagamento: Record<
    FormaPagamentoDashboard["formaPagamento"],
    string
  > = {
    PIX: "#16a085",
    DINHEIRO: "#3974df",
    CARTAO_DEBITO: "#9066d8",
    CARTAO_CREDITO: "#e6a23c",
    OUTRO: "#94a3b8",
  };

  const formasPagamentoDashboard =
    analiseDashboard?.formasPagamento ?? [];

  const quantidadeTotalAnalise =
    analiseDashboard?.quantidadeTotalVendas ?? 0;

  // Monta os segmentos da rosca conforme a quantidade de vendas.
  let percentualAcumuladoPagamento = 0;

  const segmentosPagamento = formasPagamentoDashboard
    .filter((item) => item.quantidadeVendas > 0)
    .map((item) => {
      const inicio = percentualAcumuladoPagamento;

      percentualAcumuladoPagamento +=
        quantidadeTotalAnalise > 0
          ? (item.quantidadeVendas / quantidadeTotalAnalise) * 100
          : 0;

      return `${coresFormasPagamento[item.formaPagamento]} ${inicio}% ${percentualAcumuladoPagamento}%`;
  });

const gradienteFormasPagamento =
  quantidadeTotalAnalise > 0 && segmentosPagamento.length > 0
    ? `conic-gradient(${segmentosPagamento.join(", ")})`
    : "#e9eef5";

// Escolhe o ranking de produtos conforme o botão selecionado.
const produtosRankingDashboard = analiseDashboard
  ? criterioRanking === "quantidade"
    ? analiseDashboard.produtosPorQuantidade
    : analiseDashboard.produtosPorFaturamento
  : [];

// Retorna o indicador usado para ordenar e dimensionar as barras.
function obterValorRankingProduto(
  produto: ProdutoRankingDashboard,
): number {
  return criterioRanking === "quantidade"
    ? produto.quantidadeVendida
    : produto.faturamento;
}

const maiorValorRankingProduto = Math.max(
  0,
  ...produtosRankingDashboard.map(obterValorRankingProduto),
);

  /** Calcula a porcentagem de uma categoria em relação ao catálogo completo. */
  function calcularPercentualEstoque(quantidade: number): number {
    const total = resumoEstoque?.totalProdutos ?? 0;

    if (!resumoEstoque || total <= 0) return 0;

    return Math.max(0, Math.min(100, (quantidade / total) * 100));
  }

  return (
    <ProtecaoSessao>
      <div className={styles.dashboard}>
        <MenuLateral nomeEmpresa={nomeEmpresa} />

        {/* =====================================================
            ÁREA PRINCIPAL
            ===================================================== */}
        <main className={styles.main}>
          <header className={styles.topbar}>
            <div>
              <span className={styles.breadcrumb}>
                Gestão Comercial / Visão geral
              </span>
            </div>

            <div className={styles.topbarRight}>
              <span className={styles.demoBadge}>
                INDICADORES REAIS
              </span>
              <div className={styles.avatar} aria-label="Usuário autenticado">
                GC
              </div>
            </div>
          </header>

          <div className={styles.content}>
            <section className={styles.welcome}>
              <div>
                <span className={styles.eyebrow}>PAINEL DE CONTROLE</span>
                <h1>Visão geral</h1>
                <p>
                  Acompanhe os indicadores de vendas e estoque da empresa 
                  com base nos registros do sistema.
                </p>
              </div>

              <div className={styles.dateBadge}>
                <span>◷</span> Painel operacional
              </div>
            </section>

            {/* Cards superiores com indicadores reais de vendas e estoque. */}
            <section className={styles.metrics} aria-label="Indicadores">
              {indicadoresVisiveis.map((item, index) => (
                <article className={styles.metricCard} key={item.titulo}>
                  <div className={styles.metricTop}>
                    <span className={styles.metricTitle}>{item.titulo}</span>
                    <span
                      className={`${styles.metricIcon} ${
                        styles[`metricIcon${index}`]
                      }`}
                    >
                      {item.icone}
                    </span>
                  </div>

                  <strong className={styles.metricValue}>{item.valor}</strong>

                  <div className={styles.metricFooter}>
                    <span className={item.variacaoClasse}>
                      {item.variacao}
                    </span>
                    <span className={styles.metricDescription}>
                      {item.descricao}
                    </span>
                  </div>
                </article>
              ))}
            </section>

            {/* =================================================
                   GRÁFICO DE VENDAS REAIS E RESUMO DE ESTOQUE
                ================================================= */}
            <section className={styles.primaryGrid}>
              {/* Gráfico financeiro restrito à gestão. */}
              {acessoGerencial && (
              <article className={styles.panel}>
                <div className={styles.panelHeader}>
                  <div>
                    <h2>Visão de vendas</h2>
                    <p>Faturamento diário dos últimos sete dias</p>
                  </div>
                  <span className={styles.periodBadge}>Últimos 7 dias</span>
                </div>

               <div className={styles.chartSummary}>
                  <strong>
                    {carregandoVendas
                      ? "Consultando..."
                      : erroVendas
                        ? "—"
                        : formatadorMoedaDashboard.format(faturamentoSeteDias)}
                  </strong>
                  <span>faturamento real dos últimos sete dias</span>
                </div>

                <div
                  className={styles.chart}
                  role="img"
                  aria-label="Gráfico de faturamento diário dos últimos sete dias"
                >
                <div className={styles.chartGrid}>
                  <span>
                    {formatadorMoedaCompactaDashboard.format(maiorFaturamentoDia)}
                  </span>
                  <span>
                    {formatadorMoedaCompactaDashboard.format(
                      maiorFaturamentoDia * (2 / 3),
                    )}
                  </span>
                  <span>
                    {formatadorMoedaCompactaDashboard.format(
                      maiorFaturamentoDia / 3,
                    )}
                  </span>
                  <span>R$ 0</span>
                </div>

                  <div className={styles.bars}>
                    {vendasSemanaExibidas.map((venda) => (
                      <div className={styles.barColumn} key={venda.dia}>
                        <div className={styles.barTrack}>
                          <div
                            className={styles.barFill}
                            style={{ height: `${venda.altura}%` }}
                            title={`${venda.dia}: ${formatadorMoedaDashboard.format(
                                      venda.faturamento,
                            )} · ${venda.quantidadeVendas} venda(s)`}
                          />
                        </div>
                        <span>{venda.dia}</span>
                      </div>
                    ))}
                  </div>
                </div>

                  <p className={styles.demoNote}>
                    {carregandoVendas
                      ? "Consultando as vendas registradas..."
                      : erroVendas
                        ? erroVendas
                        : "Valores calculados a partir das vendas registradas no sistema."}
                  </p>
                    
                  {erroVendas && (
                    <button
                      type="button"
                      className={styles.retryButton}
                      onClick={() => setTentativaVendas((atual) => atual + 1)}
                    >
                      Tentar novamente
                    </button>
                  )}
              </article>
              )}

              {/* Painel de estoque alimentado pelo resumo geral da API. */}
              <article className={styles.panel}>
                <div className={styles.panelHeader}>
                  <div>
                    <h2>Estoque</h2>
                    <p>
                      {carregandoResumo
                        ? "Consultando dados da empresa..."
                        : resumoEstoque
                          ? "Indicadores gerais da empresa"
                          : "Dados indisponíveis"}
                    </p>
                  </div>
                  <span className={styles.stockIcon}>▤</span>
                </div>

                <div className={styles.stockOverview}>
                  <span>Produtos cadastrados</span>
                  <strong>
                    {resumoEstoque
                      ? formatadorQuantidadeDashboard.format(
					                            resumoEstoque.totalProdutos,
                        )
                      : "—"}
                  </strong>
                </div>

                {/* Categoria normal: saldo acima do mínimo ou mínimo zero. */}
                <div className={styles.stockRow}>
                  <div className={styles.stockLabel}>
                    <span className={styles.stockDotGreen} />
                    Estoque adequado
                    <strong>
                      {resumoEstoque
                        ? formatadorQuantidadeDashboard.format(
                            resumoEstoque.estoqueAdequado,
                          )
                        : "—"}
                    </strong>
                  </div>
                  <div
                    className={styles.progressTrack}
                    role="progressbar"
                    aria-label="Proporção de produtos com estoque adequado"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={calcularPercentualEstoque(
                      resumoEstoque?.estoqueAdequado ?? 0,
                    )}
                  >
                    <div
                      className={styles.progressGreen}
                      style={{
                        width: `${calcularPercentualEstoque(
                          resumoEstoque?.estoqueAdequado ?? 0,
                        )}%`,
                      }}
                    />
                  </div>
                </div>

                {/* Categoria crítica: saldo positivo no limite ou abaixo do mínimo. */}
                <div className={styles.stockRow}>
                  <div className={styles.stockLabel}>
                    <span className={styles.stockDotYellow} />
                    Estoque crítico
                    <strong>
                      {resumoEstoque
                        ? formatadorQuantidadeDashboard.format(
                            resumoEstoque.estoqueCritico,
                          )
                        : "—"}
                    </strong>
                  </div>
                  <div
                    className={styles.progressTrack}
                    role="progressbar"
                    aria-label="Proporção de produtos com estoque crítico"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={calcularPercentualEstoque(
                      resumoEstoque?.estoqueCritico ?? 0,
                    )}
                  >
                    <div
                      className={styles.progressYellow}
                      style={{
                        width: `${calcularPercentualEstoque(
                          resumoEstoque?.estoqueCritico ?? 0,
                        )}%`,
                      }}
                    />
                  </div>
                </div>

                {/* Categoria zerada: saldo disponível menor ou igual a zero. */}
                <div className={styles.stockRow}>
                  <div className={styles.stockLabel}>
                    <span className={styles.stockDotRed} />
                    Sem estoque
                    <strong>
                      {resumoEstoque
                        ? formatadorQuantidadeDashboard.format(
                            resumoEstoque.semEstoque,
                          )
                        : "—"}
                    </strong>
                  </div>
                  <div
                    className={styles.progressTrack}
                    role="progressbar"
                    aria-label="Proporção de produtos sem estoque"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={calcularPercentualEstoque(
                      resumoEstoque?.semEstoque ?? 0,
                    )}
                  >
                    <div
                      className={styles.progressRed}
                      style={{
                        width: `${calcularPercentualEstoque(
                          resumoEstoque?.semEstoque ?? 0,
                        )}%`,
                      }}
                    />
                  </div>
                </div>

                {/* Saldo ausente é separado para evitar falsos alertas de zero. */}
                <div className={styles.stockRow}>
                  <div className={styles.stockLabel}>
                    <span
                      aria-hidden="true"
                      style={{
                        width: "8px",
                        height: "8px",
                        flexShrink: 0,
                        borderRadius: "50%",
                        background: "#94a3b8",
                      }}
                    />
                    Saldo não cadastrado
                    <strong>
                      {resumoEstoque
                        ? formatadorQuantidadeDashboard.format(
                            resumoEstoque.semSaldo,
                          )
                        : "—"}
                    </strong>
                  </div>
                  <div
                    className={styles.progressTrack}
                    role="progressbar"
                    aria-label="Proporção de produtos sem saldo cadastrado"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={calcularPercentualEstoque(
                      resumoEstoque?.semSaldo ?? 0,
                    )}
                  >
                    <div
                      style={{
                        width: `${calcularPercentualEstoque(
                          resumoEstoque?.semSaldo ?? 0,
                        )}%`,
                        height: "100%",
                        borderRadius: "inherit",
                        background: "#94a3b8",
                      }}
                    />
                  </div>
                </div>

                {/* Erro da API é explícito e pode ser repetido sem recarregar a página. */}
                {erroResumo && (
                  <div
                    className={styles.stockNotice}
                    role="alert"
                    style={{ background: "#fef2f2", color: "#991b1b" }}
                  >
                    <span aria-hidden="true">!</span>
                    <div>
                      <strong>Não foi possível carregar o estoque.</strong>
                      <p style={{ margin: "5px 0" }}>{erroResumo}</p>
                      <button
                        type="button"
                        onClick={() => setTentativaResumo((valor) => valor + 1)}
                        style={{
                          padding: 0,
                          border: 0,
                          background: "transparent",
                          color: "inherit",
                          textDecoration: "underline",
                          cursor: "pointer",
                          font: "inherit",
                        }}
                      >
                        Tentar novamente
                      </button>
                    </div>
                  </div>
                )}

                {!erroResumo && carregandoResumo && (
                  <div className={styles.stockNotice} role="status">
                    <span aria-hidden="true">…</span>
                    Consultando os indicadores gerais de estoque.
                  </div>
                )}

                {/* Mostra os até cinco alertas prioritários devolvidos pelo backend. */}
                {resumoEstoque && !erroResumo && (
                  <section
                    aria-label="Alertas de estoque"
                    style={{
                      marginTop: "18px",
                      paddingTop: "17px",
                      borderTop: "1px solid #edf0f5",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: "8px",
                        marginBottom: "10px",
                      }}
                    >
                      <h3
                        style={{
                          margin: 0,
                          color: "#1c2d42",
                          fontSize: "13px",
                        }}
                      >
                        Alertas de reposição
                      </h3>
                      <strong
                        style={{
                          color:
                            resumoEstoque.totalAlertas > 0
                              ? "#b45309"
                              : "#21895f",
                          fontSize: "12px",
                        }}
                      >
                        {formatadorQuantidadeDashboard.format(
                          resumoEstoque.totalAlertas,
                        )}
                      </strong>
                    </div>

                    {resumoEstoque.alertas.length === 0 ? (
                      <p
                        style={{
                          margin: 0,
                          color: "#64748b",
                          fontSize: "11px",
                          lineHeight: 1.6,
                        }}
                      >
                        Nenhum produto com estoque crítico ou zerado.
                      </p>
                    ) : (
                      <ul
                        style={{
                          display: "grid",
                          gap: "10px",
                          margin: 0,
                          padding: 0,
                          listStyle: "none",
                        }}
                      >
                        {resumoEstoque.alertas.map((alerta) => {
                          const semEstoque = alerta.estado === "SEM_ESTOQUE";

                          return (
                            <li
                              key={alerta.id}
                              style={{
                                padding: "10px",
                                border: "1px solid #edf0f5",
                                borderRadius: "8px",
                              }}
                            >
                              <div
                                style={{
                                  display: "flex",
                                  alignItems: "flex-start",
                                  justifyContent: "space-between",
                                  gap: "8px",
                                }}
                              >
                                <div style={{ minWidth: 0 }}>
                                  <strong
                                    style={{
                                      display: "block",
                                      color: "#334155",
                                      fontSize: "11px",
									                                        overflowWrap: "anywhere",
                                    }}
                                  >
                                    {alerta.nome}
                                  </strong>
                                  <small
                                    style={{
                                      display: "block",
                                      marginTop: "3px",
                                      color: "#94a3b8",
                                      fontSize: "10px",
                                    }}
                                  >
                                    SKU: {alerta.sku}
                                    {!alerta.ativo ? " · Produto inativo" : ""}
                                  </small>
                                </div>

                                <span
                                  style={{
                                    flexShrink: 0,
                                    padding: "4px 6px",
                                    borderRadius: "5px",
                                    background: semEstoque ? "#fef2f2" : "#fffbeb",
                                    color: semEstoque ? "#991b1b" : "#92400e",
                                    fontSize: "9px",
                                    fontWeight: 700,
                                  }}
                                >
                                  {semEstoque ? "Sem estoque" : "Estoque crítico"}
                                </span>
                              </div>

                              <p
                                style={{
                                  margin: "7px 0 0",
                                  color: "#64748b",
                                  fontSize: "10px",
                                }}
                              >
                                Disponível: {formatadorQuantidadeDashboard.format(
                                  alerta.quantidadeDisponivel,
                                )} · Mínimo: {formatadorQuantidadeDashboard.format(
                                  alerta.estoqueMinimo,
                                )}
                              </p>
                            </li>
                          );
                        })}
                      </ul>
                    )}

                    {resumoEstoque.totalAlertas > resumoEstoque.alertas.length && (
                      <p
                        style={{
                          margin: "9px 0 0",
                          color: "#64748b",
                          fontSize: "10px",
                        }}
                      >
                        Exibindo {resumoEstoque.alertas.length} dos {" "}
                        {formatadorQuantidadeDashboard.format(
                          resumoEstoque.totalAlertas,
                        )} alertas encontrados.
                      </p>
                    )}

                    <Link
                      href="/produtos"
                      style={{
                        display: "inline-block",
                        marginTop: "13px",
                        color: "#2864d8",
                        fontSize: "11px",
                        fontWeight: 700,
                        textDecoration: "none",
                      }}
                    >
                      Abrir produtos e estoque →
                    </Link>
                  </section>
                )}

                <p
                  style={{
                    margin: "13px 0 0",
                    color: "#94a3b8",
                    fontSize: "10px",
                    lineHeight: 1.6,
                  }}
                >
                  Os indicadores consideram todos os produtos da empresa
                  autenticada, não apenas os registros de uma página da listagem.
                </p>
              </article>
            </section>

           {/* =====================================================
                ANÁLISES COMERCIAIS: PAGAMENTOS E PRODUTOS
            ===================================================== */}
            {acessoGerencial && (
            <section
              className={styles.analyticsGrid}
              aria-label="Análises comerciais"
            >
              {/* Erro compartilhado pelos dois gráficos. */}
              {!carregandoAnalise && erroAnalise && (
                <div
                  className={`${styles.analyticsMessage} ${styles.analyticsError}`}
                  role="alert"
                >
                  <div>
                    <strong>Não foi possível carregar as análises.</strong>
                    <p>{erroAnalise}</p>
                  </div>
              
                  <button
                    type="button"
                    className={styles.analyticsRetry}
                    onClick={() =>
                      setTentativaAnalise((tentativa) => tentativa + 1)
                    }
                  >
                    Tentar novamente
                  </button>
                </div>
              )}

              {/* Gráfico de rosca: formas de pagamento. */}
              <article className={`${styles.panel} ${styles.analyticsPanel}`}>
                <div className={styles.panelHeader}>
                  <div>
                    <h2>Formas de pagamento</h2>
                    <p>Modalidades mais utilizadas no mês atual</p>
                  </div>
            
                  <span className={styles.periodBadge}>Mês atual</span>
                </div>
            
                {carregandoAnalise && (
                  <div className={styles.analyticsMessage} role="status">
                    Consultando as formas de pagamento...
                  </div>
                )}

                {!carregandoAnalise && !erroAnalise && quantidadeTotalAnalise === 0 && (
                  <div className={styles.analyticsMessage}>
                    Nenhuma venda registrada neste mês.
                  </div>
                )}

                {!carregandoAnalise &&
                  !erroAnalise &&
                  quantidadeTotalAnalise > 0 && (
                    <div className={styles.paymentLayout}>
                      <div
                        className={styles.paymentDonut}
                        style={{ background: gradienteFormasPagamento }}
                        role="img"
                        aria-label="Gráfico com a participação das formas de pagamento na quantidade de vendas"
                      >
                        <div className={styles.paymentDonutHole}>
                          <span>Vendas no mês</span>
                          <strong>
                            {formatadorQuantidadeDashboard.format(
                              quantidadeTotalAnalise,
                            )}
                          </strong>
                        </div>
                      </div>
                          
                      <div className={styles.paymentLegend}>
                        {formasPagamentoDashboard.map((pagamento) => (
                          <div
                            className={styles.paymentLegendItem}
                            key={pagamento.formaPagamento}
                          >
                            <span
                              className={styles.paymentDot}
                              style={{
                                backgroundColor:
                                  coresFormasPagamento[pagamento.formaPagamento],
                              }}
                              aria-hidden="true"
                            />

                            <div className={styles.paymentLegendInfo}>
                              <strong>{pagamento.nome}</strong>
                              <small>
                                {formatadorQuantidadeDashboard.format(
                                  pagamento.quantidadeVendas,
                                )}{" "}
                                {pagamento.quantidadeVendas === 1
                                  ? "venda"
                                  : "vendas"}{" "}
                                ·{" "}
                                {formatadorQuantidadeDashboard.format(
                                  pagamento.percentualVendas,
                                )}
                                %
                              </small>
                            </div>
                              
                            <div className={styles.paymentLegendValue}>
                              <strong>
                                {formatadorMoedaDashboard.format(
                                  pagamento.faturamento,
                                )}
                              </strong>
                              <small>faturamento</small>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
              </article>
                
              {/* Ranking dos produtos mais vendidos. */}
              <article className={`${styles.panel} ${styles.analyticsPanel}`}>
                <div className={styles.panelHeader}>
                  <div>
                    <h2>Produtos mais vendidos</h2>
                    <p>Ranking comercial do mês atual</p>
                  </div>
                
                  <span className={styles.periodBadge}>Top 8</span>
                </div>
                
                <div
                  className={styles.rankingControls}
                  role="group"
                  aria-label="Critério de classificação dos produtos"
                >
                  <button
                    type="button"
                    className={
                      criterioRanking === "quantidade"
                        ? `${styles.rankingButton} ${styles.rankingButtonActive}`
                        : styles.rankingButton
                    }
                    aria-pressed={criterioRanking === "quantidade"}
                    onClick={() => setCriterioRanking("quantidade")}
                  >
                    Quantidade
                  </button>
                  
                  <button
                    type="button"
                    className={
                      criterioRanking === "faturamento"
                        ? `${styles.rankingButton} ${styles.rankingButtonActive}`
                        : styles.rankingButton
                    }
                    aria-pressed={criterioRanking === "faturamento"}
                    onClick={() => setCriterioRanking("faturamento")}
                  >
                    Faturamento
                  </button>
                </div>
                  
                {carregandoAnalise && (
                  <div className={styles.analyticsMessage} role="status">
                    Consultando os produtos vendidos...
                  </div>
                )}

                {!carregandoAnalise && !erroAnalise &&
                  quantidadeTotalAnalise === 0 && (
                    <div className={styles.analyticsMessage}>
                      Os produtos vendidos aparecerão aqui após as primeiras vendas do mês.
                    </div>
                  )}

                {!carregandoAnalise &&
                  !erroAnalise &&
                  quantidadeTotalAnalise > 0 &&
                  produtosRankingDashboard.length === 0 && (
                    <div className={styles.analyticsMessage}>
                      Não há itens de venda disponíveis para montar o ranking.
                    </div>
                  )}

                {!carregandoAnalise &&
                  !erroAnalise &&
                  quantidadeTotalAnalise > 0 &&
                  produtosRankingDashboard.length > 0 && (
                    <ol className={styles.productRanking}>
                      {produtosRankingDashboard.map((produto, indice) => {
                        const valor = obterValorRankingProduto(produto);
                      
                        const percentualBarra =
                          maiorValorRankingProduto > 0
                            ? (valor / maiorValorRankingProduto) * 100
                            : 0;
                      
                        return (
                          <li
                            className={styles.productRankingItem}
                            key={produto.produtoId}
                          >
                            <div className={styles.productRankingHeader}>
                              <div className={styles.productRankingIdentity}>
                                <span className={styles.productRankingPosition}>
                                  {indice + 1}
                                </span>
                        
                                <div className={styles.productRankingName}>
                                  <strong>{produto.nome}</strong>
                                  <small>SKU: {produto.sku}</small>
                                </div>
                              </div>
                        
                              <strong className={styles.productRankingValue}>
                                {criterioRanking === "quantidade"
                                  ? formatadorQuantidadeDashboard.format(valor)
                                  : formatadorMoedaDashboard.format(valor)}
                              </strong>
                            </div>
                                
                            <div
                              className={styles.rankingTrack}
                              role="progressbar"
                              aria-label={`Posição relativa de ${produto.nome} no ranking`}
                              aria-valuemin={0}
                              aria-valuemax={100}
                              aria-valuenow={Math.round(percentualBarra)}
                            >
                              <div
                                className={styles.rankingBar}
                                style={{ width: `${percentualBarra}%` }}
                              />
                            </div>
                          </li>
                        );
                      })}
                    </ol>
                  )}

                {!carregandoAnalise && !erroAnalise &&
                  quantidadeTotalAnalise > 0 && (
                    <p className={styles.analyticsFootnote}>
                      {criterioRanking === "quantidade"
                        ? "Classificação pela quantidade total vendida."
                        : "Classificação pelo faturamento dos itens vendidos."}
                      {" "}Considera os valores históricos registrados nas vendas.
                    </p>
                  )}
              </article>
            </section>
            )}

            {/* Atividades reais de movimentação de estoque. */}
            <section className={styles.panel}>
              <div className={styles.panelHeader}>
                <div>
                  <h2>Atividades recentes</h2>
                  <p>Vendas, produtos cadastrados e movimentações de estoque</p>
                </div>
                <span className={styles.periodBadge}>Dados reais</span>
              </div>

              <div className={styles.tableWrapper}>
                <table className={styles.activityTable}>
                  <thead>
                    <tr>
                      <th>Atividade</th>
                      <th>Detalhe / referência</th>
                      <th>Data e hora</th>
                      <th>Valor / quantidade</th>
                    </tr>
                  </thead>

                <tbody>
                  {carregandoAtividades ? (
                    <tr>
                      <td colSpan={4}>Carregando atividades recentes...</td>
                    </tr>
                  ) : erroAtividades ? (
                    <tr>
                      <td colSpan={4}>
                        <span role="alert">{erroAtividades}</span>{" "}
                        <button
                          type="button"
                          onClick={() =>
                            setTentativaAtividades((tentativa) => tentativa + 1)
                          }
                        >
                          Tentar novamente
                        </button>
                      </td>
                    </tr>
                  ) : atividadesRecentes.length === 0 ? (
                    <tr>
                      <td colSpan={4}>
                        Nenhuma atividade registrada até o momento.
                      </td>
                    </tr>
                  ) : (
                    atividadesRecentes.map((atividade) => {
                      const horario = new Date(
                        atividade.criadoEm,
                      ).toLocaleString("pt-BR", {
                        day: "2-digit",
                        month: "2-digit",
                        year: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      });
                    
                      const classeIcone =
                        atividade.tipo === "VENDA"
                          ? styles.activityvenda
                          : atividade.tipo === "PRODUTO_CADASTRADO"
                            ? styles.activityproduto
                            : styles.activityestoque;
                    
                      let quantidadeExibida: string | null = null;
                    
                      if (typeof atividade.quantidade === "number") {
                        const quantidade = formatadorQuantidadeDashboard.format(
                          atividade.quantidade,
                        );
                      
                        quantidadeExibida =
                          atividade.tipo === "ENTRADA"
                            ? `+${quantidade}`
                            : atividade.tipo === "SAIDA"
                              ? `−${quantidade}`
                              : quantidade;
                      }
                    
                      return (
                        <tr key={atividade.id}>
                          <td>
                            <div className={styles.activityName}>
                              <span
                                className={`${styles.activityIcon} ${classeIcone}`}
                              >
                                {atividade.tipo === "VENDA"
                                  ? "↗"
                                  : atividade.tipo === "PRODUTO_CADASTRADO"
                                    ? "＋"
                                    : "▤"}
                              </span>
                                
                              <strong>{atividade.titulo}</strong>
                            </div>
                          </td>
                                
                          <td>
                            <strong>{atividade.detalhe}</strong>
                            <br />
                            <small>{atividade.referencia}</small>
                                
                            {atividade.responsavel && (
                              <>
                                <br />
                                <small>
                                  Responsável: {atividade.responsavel}
                                </small>
                              </>
                            )}
                          </td>
                          
                          <td>{horario}</td>
                          
                          <td>
                            {typeof atividade.valor === "number" ? (
                              <span className={styles.activityValue}>
                                {formatadorMoedaDashboard.format(atividade.valor)}
                              </span>
                            ) : quantidadeExibida !== null ? (
                              <>
                                <span className={styles.activityValue}>
                                  {quantidadeExibida}
                                </span>
                            
                                {typeof atividade.saldoApos === "number" && (
                                  <>
                                    <br />
                                    <small>
                                      Saldo após:{" "}
                                      {formatadorQuantidadeDashboard.format(
                                        atividade.saldoApos,
                                      )}
                                    </small>
                                  </>
                                )}
                              </>
                            ) : (
                              "—"
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
                </table>
              </div>

              <div className={styles.tableDisclaimer}>
                Exibindo as atividades mais recentes registradas pela empresa autenticada.
              </div>
            </section>

            <footer className={styles.footer}>
              <span>Gestão Comercial Multi-Ramo</span>
              <span>Estoque e vendas integrados · dados reais da empresa</span>
            </footer>
          </div>
        </main>
      </div>
    </ProtecaoSessao>
  );
}