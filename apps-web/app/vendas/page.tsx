"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";

import styles from "./vendas.module.css";
import { ProtecaoSessao } from "../componentes/protecao-sessao";

const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5433";

type ProdutoApi = {
  id: string;
  nome: string;
  sku: string;
  preco: number | string;
  ativo: boolean;
  saldoEstoque?: {
    quantidadeDisponivel: number | string;
    quantidadeReservada: number | string;
    estoqueMinimo: number | string;
  } | null;
};

type RespostaProdutos = {
  dados?: ProdutoApi[];
  message?: string | string[];
};

type ItemCarrinho = {
  produtoId: string;
  quantidade: number;
};

type FormaPagamento =
  | "DINHEIRO"
  | "PIX"
  | "CARTAO_DEBITO"
  | "CARTAO_CREDITO"
  | "OUTRO";

type VendaApi = {
  id: string;
  total: number | string;
  criadoEm: string;
};

/** Venda resumida recebida na listagem do backend. */
type VendaResumoApi = {
  id: string;
  formaPagamento: FormaPagamento;
  total: number | string;
  criadoEm: string;
  usuario: {
    id: string;
    nome: string;
  };
  quantidadeItens: number;

  // Indicadores calculados com base no custo histórico.
  custoHistoricoDisponivel: boolean;
  custoTotal: number | null;
  lucroBrutoTotal: number | null;
  margemBrutaPercentual: number | null;
};

/** Item histórico retornado nos detalhes de uma venda. */
type ItemDetalheVendaApi = {
  id: string;
  produto: {
    id: string;
    nome: string;
    sku: string;
  };
  quantidade: number | string;
  precoUnitario: number | string;
  subtotal: number | string;

  // Indicadores calculados com base no custo histórico.
  custoHistoricoDisponivel: boolean;
  custoUnitario: number | null;
  custoTotal: number | null;
  lucroBruto: number | null;
  margemBrutaPercentual: number | null;
};

/** Detalhes completos de uma venda. */
type DetalheVendaApi = {
  id: string;
  formaPagamento: FormaPagamento;
  total: number | string;
  criadoEm: string;
  usuario: {
    id: string;
    nome: string;
  };
  itens: ItemDetalheVendaApi[];

  // Resumo financeiro da venda.
  custoHistoricoDisponivel: boolean;
  custoTotal: number | null;
  lucroBrutoTotal: number | null;
  margemBrutaPercentual: number | null;
};

/** Resposta paginada do endpoint GET /vendas. */
type RespostaListagemVendas = {
  dados?: VendaResumoApi[];
  total?: number;
  pagina?: number;
  limite?: number;
  totalPaginas?: number;
};

type RespostaErro = {
  message?: string | string[];
};

const formasPagamento: Array<{
  valor: FormaPagamento;
  rotulo: string;
}> = [
  { valor: "DINHEIRO", rotulo: "Dinheiro" },
  { valor: "PIX", rotulo: "PIX" },
  { valor: "CARTAO_DEBITO", rotulo: "Cartão de débito" },
  { valor: "CARTAO_CREDITO", rotulo: "Cartão de crédito" },
  { valor: "OUTRO", rotulo: "Outro" },
];

const formatadorMoeda = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

const formatadorQuantidade = new Intl.NumberFormat("pt-BR", {
  maximumFractionDigits: 3,
});

function numeroSeguro(valor: number | string | null | undefined): number {
  if (valor === null || valor === undefined) {
    return 0;
  }

  const numero = Number(valor);
  return Number.isFinite(numero) ? numero : 0;
}

function obterDisponivel(produto: ProdutoApi): number {
  return numeroSeguro(produto.saldoEstoque?.quantidadeDisponivel);
}

function obterMensagemErro(
  dados: unknown,
  padrao: string,
): string {
  if (!dados || typeof dados !== "object") {
    return padrao;
  }

  const mensagem = (dados as RespostaErro).message;

  if (Array.isArray(mensagem)) {
    return mensagem.join(", ");
  }

  if (typeof mensagem === "string") {
    return mensagem;
  }

  return padrao;
}

async function lerJson(resposta: Response): Promise<unknown> {
  try {
    return await resposta.json();
  } catch {
    return null;
  }
}

export default function VendasPage() {
  const router = useRouter();

  const [produtos, setProdutos] = useState<ProdutoApi[]>([]);
  const [itensCarrinho, setItensCarrinho] = useState<ItemCarrinho[]>([]);
  const [busca, setBusca] = useState("");
  const [formaPagamento, setFormaPagamento] =
    useState<FormaPagamento>("PIX");

  const [carregandoProdutos, setCarregandoProdutos] = useState(true);
  const [carregandoVenda, setCarregandoVenda] = useState(false);
  const [erroProdutos, setErroProdutos] = useState("");
  const [erroVenda, setErroVenda] = useState("");
  const [sucessoVenda, setSucessoVenda] = useState<VendaApi | null>(null);
  const [tentativaCarga, setTentativaCarga] = useState(0);
  // Estado da listagem de vendas.
  const [vendasHistorico, setVendasHistorico] = useState<VendaResumoApi[]>([]);
  const [carregandoHistorico, setCarregandoHistorico] = useState(true);
  const [erroHistorico, setErroHistorico] = useState("");
  const [paginaHistorico, setPaginaHistorico] = useState(1);
  const [totalVendasHistorico, setTotalVendasHistorico] = useState(0);
  const [totalPaginasHistorico, setTotalPaginasHistorico] = useState(1);
  const [filtroHistorico, setFiltroHistorico] =
    useState<"TODAS" | FormaPagamento>("TODAS");
  const [tentativaHistorico, setTentativaHistorico] = useState(0);

  // Estado da consulta individual de uma venda.
  const [vendaDetalheId, setVendaDetalheId] = useState<string | null>(null);
  const [detalheVenda, setDetalheVenda] =
    useState<DetalheVendaApi | null>(null);
  const [carregandoDetalhe, setCarregandoDetalhe] = useState(false);
  const [erroDetalhe, setErroDetalhe] = useState("");

  // Nome da empresa salvo na sessão durante o login.
  const [nomeEmpresa, setNomeEmpresa] = useState("Empresa autenticada");
  
  /**
 * Recupera o nome da empresa armazenado durante o login.
 */
useEffect(() => {
  try {
    const usuarioSalvo = sessionStorage.getItem("gestao.usuario");

    if (!usuarioSalvo) return;

    const usuario = JSON.parse(usuarioSalvo) as {
      empresaNome?: unknown;
    };

    if (
      typeof usuario.empresaNome === "string" &&
      usuario.empresaNome.trim().length > 0
    ) {
      setNomeEmpresa(usuario.empresaNome.trim());
    }
  } catch {
    setNomeEmpresa("Empresa autenticada");
  }
  }, []);
  /**
   * Carrega o catálogo pela API.
   * Os produtos ativos e seus saldos vêm do backend.
   */
  useEffect(() => {
    let ativo = true;
    const controlador = new AbortController();

    async function carregarProdutos() {
      setCarregandoProdutos(true);
      setErroProdutos("");

      const token = sessionStorage.getItem("gestao.accessToken");

      if (!token) {
        router.replace("/");
        setCarregandoProdutos(false);
        return;
      }

      try {
        const parametros = new URLSearchParams({
          pagina: "1",
          limite: "100",
        });

        const resposta = await fetch(
          `${API_URL}/produtos?${parametros.toString()}`,
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

        const dados = await lerJson(resposta);

        if (resposta.status === 401 || resposta.status === 403) {
          sessionStorage.removeItem("gestao.accessToken");
          sessionStorage.removeItem("gestao.usuario");
          router.replace("/");
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

        const listagem = dados as RespostaProdutos;

        if (!Array.isArray(listagem?.dados)) {
          throw new Error(
            "A API retornou uma lista de produtos em formato inesperado.",
          );
        }

        if (ativo) {
          setProdutos(
            listagem.dados.filter((produto) => produto.ativo),
          );
        }
      } catch (erro) {
        if (controlador.signal.aborted) {
          return;
        }

        if (ativo) {
          setErroProdutos(
            erro instanceof Error
              ? erro.message
              : "Erro ao carregar os produtos.",
          );
        }
      } finally {
        if (ativo) {
          setCarregandoProdutos(false);
        }
      }
    }

    void carregarProdutos();

    return () => {
      ativo = false;
      controlador.abort();
    };
  }, [router, tentativaCarga]);

    /**
   * Consulta o histórico de vendas da empresa autenticada.
   * Cada alteração de página ou filtro dispara uma nova consulta.
   */
  useEffect(() => {
    let ativo = true;
    const controlador = new AbortController();

    async function carregarHistorico() {
      setCarregandoHistorico(true);
      setErroHistorico("");

      const token = sessionStorage.getItem("gestao.accessToken");

      if (!token) {
        router.replace("/");
        if (ativo) setCarregandoHistorico(false);
        return;
      }

      try {
        const parametros = new URLSearchParams({
          pagina: String(paginaHistorico),
          limite: "10",
        });

        if (filtroHistorico !== "TODAS") {
          parametros.set("formaPagamento", filtroHistorico);
        }

        const resposta = await fetch(
          `${API_URL}/vendas?${parametros.toString()}`,
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

        const dados = await lerJson(resposta);

        if (resposta.status === 401 || resposta.status === 403) {
          sessionStorage.removeItem("gestao.accessToken");
          sessionStorage.removeItem("gestao.usuario");
          router.replace("/");
          return;
        }

        if (!resposta.ok) {
          throw new Error(
            obterMensagemErro(
              dados,
              "Não foi possível consultar o histórico de vendas.",
            ),
          );
        }

        const resultado = dados as RespostaListagemVendas;

        if (
          !Array.isArray(resultado.dados) ||
          typeof resultado.total !== "number" ||
          typeof resultado.totalPaginas !== "number"
        ) {
          throw new Error(
            "A API retornou um formato inesperado para o histórico.",
          );
        }

        if (ativo) {
          setVendasHistorico(resultado.dados);
          setTotalVendasHistorico(resultado.total);
          setTotalPaginasHistorico(
            Math.max(1, resultado.totalPaginas),
          );
        }
      } catch (erro) {
        if (controlador.signal.aborted) return;

        if (ativo) {
          setErroHistorico(
            erro instanceof Error
              ? erro.message
              : "Erro ao consultar o histórico de vendas.",
          );
        }
      } finally {
        if (ativo) setCarregandoHistorico(false);
      }
    }

    void carregarHistorico();

    return () => {
      ativo = false;
      controlador.abort();
    };
  }, [router, paginaHistorico, filtroHistorico, tentativaHistorico]);

    /**
   * Carrega os detalhes da venda selecionada.
   * O backend confere se a venda pertence à empresa autenticada.
   */
  useEffect(() => {
    if (!vendaDetalheId) {
      setDetalheVenda(null);
      setErroDetalhe("");
      setCarregandoDetalhe(false);
      return;
    }

    let ativo = true;
    const controlador = new AbortController();

    async function carregarDetalhe() {
      setCarregandoDetalhe(true);
      setErroDetalhe("");
      setDetalheVenda(null);

      const token = sessionStorage.getItem("gestao.accessToken");

      if (!token) {
        router.replace("/");
        if (ativo) setCarregandoDetalhe(false);
        return;
      }

      try {
        const resposta = await fetch(
          `${API_URL}/vendas/${encodeURIComponent(vendaDetalheId!)}`,
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

        const dados = await lerJson(resposta);

        if (resposta.status === 401 || resposta.status === 403) {
          sessionStorage.removeItem("gestao.accessToken");
          sessionStorage.removeItem("gestao.usuario");
          router.replace("/");
          return;
        }

        if (!resposta.ok) {
          throw new Error(
            obterMensagemErro(
              dados,
              "Não foi possível consultar os detalhes da venda.",
            ),
          );
        }

        const resultado = dados as DetalheVendaApi;

        if (
          typeof resultado.id !== "string" ||
          !Array.isArray(resultado.itens)
        ) {
          throw new Error(
            "A API retornou detalhes em formato inesperado.",
          );
        }

        if (ativo) setDetalheVenda(resultado);
      } catch (erro) {
        if (controlador.signal.aborted) return;

        if (ativo) {
          setErroDetalhe(
            erro instanceof Error
              ? erro.message
              : "Erro ao consultar os detalhes da venda.",
          );
        }
      } finally {
        if (ativo) setCarregandoDetalhe(false);
      }
    }

    void carregarDetalhe();

    return () => {
      ativo = false;
      controlador.abort();
    };
  }, [router, vendaDetalheId]);

  const produtosFiltrados = useMemo(() => {
    const termo = busca.trim().toLocaleLowerCase("pt-BR");

    if (!termo) {
      return produtos;
    }

    return produtos.filter((produto) =>
      `${produto.nome} ${produto.sku}`
        .toLocaleLowerCase("pt-BR")
        .includes(termo),
    );
  }, [produtos, busca]);

  const linhasCarrinho = useMemo(() => {
    return itensCarrinho.flatMap((item) => {
      const produto = produtos.find(
        (registro) => registro.id === item.produtoId,
      );

      if (!produto) {
        return [];
      }

      const preco = numeroSeguro(produto.preco);

      // Mantém a prévia de cada subtotal em centavos.
      const subtotal =
        Math.round(preco * item.quantidade * 100) / 100;

      return [
        {
          ...item,
          produto,
          preco,
          disponivel: obterDisponivel(produto),
          subtotal,
        },
      ];
    });
  }, [itensCarrinho, produtos]);

  const totalPrevisto = linhasCarrinho.reduce(
    (total, item) => total + item.subtotal,
    0,
  );

  function adicionarProduto(produto: ProdutoApi) {
    const disponivel = obterDisponivel(produto);

    if (disponivel <= 0) {
      setErroVenda(
        `${produto.nome} não possui saldo disponível para venda.`,
      );
      return;
    }

    setErroVenda("");
    setSucessoVenda(null);

    setItensCarrinho((atuais) => {
      const existente = atuais.find(
        (item) => item.produtoId === produto.id,
      );

      if (!existente) {
        return [
          ...atuais,
          {
            produtoId: produto.id,
            quantidade: Math.min(1, disponivel),
          },
        ];
      }

      return atuais.map((item) => {
        if (item.produtoId !== produto.id) {
          return item;
        }

        return {
          ...item,
          quantidade: Math.min(
            item.quantidade + 1,
            disponivel,
          ),
        };
      });
    });
  }

  function atualizarQuantidade(
    produtoId: string,
    quantidade: number,
  ) {
    setErroVenda("");
    setSucessoVenda(null);

    setItensCarrinho((atuais) =>
      atuais.map((item) =>
        item.produtoId === produtoId
          ? { ...item, quantidade }
          : item,
      ),
    );
  }

  function removerProduto(produtoId: string) {
    setItensCarrinho((atuais) =>
      atuais.filter((item) => item.produtoId !== produtoId),
    );
    setErroVenda("");
    setSucessoVenda(null);
  }

  async function finalizarVenda(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    setErroVenda("");
    setSucessoVenda(null);

    if (linhasCarrinho.length === 0) {
      setErroVenda("Adicione pelo menos um produto à venda.");
      return;
    }

    for (const item of linhasCarrinho) {
      if (
        !Number.isFinite(item.quantidade) ||
        item.quantidade <= 0
      ) {
        setErroVenda(
          `Informe uma quantidade válida para ${item.produto.nome}.`,
        );
        return;
      }

      if (item.quantidade > item.disponivel) {
        setErroVenda(
          `Estoque insuficiente para ${item.produto.nome}. ` +
            `Disponível: ${formatadorQuantidade.format(item.disponivel)}.`,
        );
        return;
      }
    }

    const token = sessionStorage.getItem("gestao.accessToken");

    if (!token) {
      router.replace("/");
      return;
    }

    setCarregandoVenda(true);

    try {
      // O frontend envia somente produto, quantidade e pagamento.
      // Preços e total são recalculados pelo backend.
      const resposta = await fetch(`${API_URL}/vendas`, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          formaPagamento,
          itens: linhasCarrinho.map((item) => ({
            produtoId: item.produto.id,
            quantidade: item.quantidade,
          })),
        }),
      });

      const dados = await lerJson(resposta);

      if (resposta.status === 401 || resposta.status === 403) {
        sessionStorage.removeItem("gestao.accessToken");
        sessionStorage.removeItem("gestao.usuario");
        router.replace("/");
        return;
      }

      if (!resposta.ok) {
        throw new Error(
          obterMensagemErro(
            dados,
            "Não foi possível concluir a venda.",
          ),
        );
      }

      const venda = dados as VendaApi;

      if (
        typeof venda?.id !== "string" ||
        venda.total === undefined
      ) {
        throw new Error(
          "A API confirmou a resposta em formato inesperado.",
        );
      }

      setSucessoVenda(venda);
      setItensCarrinho([]);
      
      // Atualiza o histórico após a confirmação da venda.
      setPaginaHistorico(1);
      setTentativaHistorico((tentativa) => tentativa + 1);

      // Avisa as outras abas que o estoque foi alterado.
      // A comunicação é complementar: não deve invalidar uma
      // venda que o backend já confirmou.
      try {
        localStorage.setItem(
          "gestao.estoque.atualizado",
          String(Date.now()),
        );
      } catch {
        // Se o armazenamento do navegador estiver indisponível,
        // a atualização ao retornar à aba continuará funcionando.
      }

      // Atualiza também o catálogo na própria tela de vendas.
      setTentativaCarga((tentativa) => tentativa + 1);

    } catch (erro) {
      // Mostra o erro sem limpar o carrinho da venda.
      setErroVenda(
        erro instanceof Error
          ? erro.message
          : "Ocorreu um erro ao finalizar a venda.",
      );

    } finally {
      // Libera o botão de finalização em qualquer resultado.
      setCarregandoVenda(false);
    }
  }

  return (
    <ProtecaoSessao>
      <div className={styles.pagina}>
        <aside className={styles.sidebar}>
          <Link href="/dashboard" className={styles.brand}>
            <span className={styles.brandIcon}>GC</span>
            <span className={styles.brandText}>
              <strong>GESTÃO</strong>
              <span>COMERCIAL</span>
            </span>
          </Link>

          <div className={styles.empresa}>
            <span className={styles.empresaIcon}>GC</span>       
              <span>
              <strong>{nomeEmpresa}</strong>
              <small>Empresa autenticada</small>
            </span>
          </div>
          <nav className={styles.navegacao} aria-label="Menu principal">
            <span className={styles.tituloMenu}>PRINCIPAL</span>

            <Link href="/dashboard" className={styles.itemMenu}>
              <span>▦</span>
              Visão geral
            </Link>

            <Link href="/produtos" className={styles.itemMenu}>
              <span>▤</span>
              Produtos e estoque
            </Link>

            <Link
              href="/vendas"
              className={`${styles.itemMenu} ${styles.itemAtivo}`}
              aria-current="page"
            >
              <span>↗</span>
              Vendas
            </Link>

            <span className={styles.tituloMenu}>GESTÃO</span>

            <span className={styles.itemDesabilitado}>
              <span>▣</span>
              Caixa
              <small>Em breve</small>
            </span>

            <span className={styles.itemDesabilitado}>
              <span>♧</span>
              Clientes
              <small>Em breve</small>
            </span>

            <span className={styles.itemDesabilitado}>
              <span>▥</span>
              Relatórios
              <small>Em breve</small>
            </span>
          </nav>

          <div className={styles.sidebarRodape}>
            Gestão Comercial Multi-Ramo
          </div>
        </aside>

        <main className={styles.conteudo}>
          <header className={styles.cabecalho}>
            <div>
              <p className={styles.sobretitulo}>OPERAÇÃO COMERCIAL</p>
              <h1>Nova venda</h1>
              <p className={styles.descricao}>
                Selecione os produtos, confira o total e finalize a venda.
              </p>
            </div>

            <Link href="/produtos" className={styles.linkSecundario}>
              Consultar estoque
            </Link>
          </header>

          {sucessoVenda && (
            <section className={styles.sucesso} role="status">
              <strong>Venda concluída com sucesso!</strong>
              <span>
                Venda {sucessoVenda.id} · Total confirmado:{" "}
                {formatadorMoeda.format(
                  numeroSeguro(sucessoVenda.total),
                )}
              </span>
            </section>
          )}

          <div className={styles.grade}>
            <section className={styles.painel}>
              <div className={styles.painelCabecalho}>
                <div>
                  <h2>Produtos disponíveis</h2>
                  <p>Preços e saldos consultados na API</p>
                </div>
                <span className={styles.contador}>
                  {produtosFiltrados.length} produto(s)
                </span>
              </div>

              <label className={styles.buscaLabel} htmlFor="busca-produtos">
                Buscar produto por nome ou SKU
              </label>
              <input
                id="busca-produtos"
                className={styles.busca}
                type="search"
                placeholder="Ex.: Coca Cola ou 0000000001"
                value={busca}
                onChange={(evento) => setBusca(evento.target.value)}
              />

              {erroProdutos && (
                <div className={styles.erro} role="alert">
                  <span>{erroProdutos}</span>
                  <button
                    type="button"
                    onClick={() =>
                      setTentativaCarga((tentativa) => tentativa + 1)
                    }
                  >
                    Tentar novamente
                  </button>
                </div>
              )}

              {carregandoProdutos ? (
                <div className={styles.estadoVazio}>
                  Carregando produtos e saldos...
                </div>
              ) : !erroProdutos && produtosFiltrados.length === 0 ? (
                <div className={styles.estadoVazio}>
                  Nenhum produto ativo encontrado para essa busca.
                </div>
              ) : (
                <div className={styles.listaProdutos}>
                  {produtosFiltrados.map((produto) => {
                    const disponivel = obterDisponivel(produto);
                    const preco = numeroSeguro(produto.preco);

                    return (
                      <article
                        key={produto.id}
                        className={styles.produto}
                      >
                        <div className={styles.produtoInfo}>
                          <strong>{produto.nome}</strong>
                          <span>SKU: {produto.sku}</span>
                          <small>
                            Disponível:{" "}
                            {formatadorQuantidade.format(disponivel)}
                          </small>
                        </div>

                        <div className={styles.produtoAcao}>
                          <strong>{formatadorMoeda.format(preco)}</strong>
                          <button
                            type="button"
                            className={styles.botaoAdicionar}
                            disabled={disponivel <= 0}
                            onClick={() => adicionarProduto(produto)}
                          >
                            {disponivel <= 0
                              ? "Sem estoque"
                              : "Adicionar"}
                          </button>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
              <p className={styles.observacao}>
                A listagem consulta até 100 produtos por vez.
              </p>
            </section>

            <section className={styles.painel}>
              <div className={styles.painelCabecalho}>
                <div>
                  <h2>Carrinho da venda</h2>
                  <p>Confira quantidades e valores</p>
                </div>
                <span className={styles.contador}>
                  {itensCarrinho.length} item(ns)
                </span>
              </div>

              <form onSubmit={finalizarVenda}>
                {linhasCarrinho.length === 0 ? (
                  <div className={styles.estadoVazio}>
                    O carrinho está vazio. Adicione produtos para começar.
                  </div>
                ) : (
                  <div className={styles.listaCarrinho}>
                    {linhasCarrinho.map((item) => (
                      <article
                        key={item.produto.id}
                        className={styles.itemCarrinho}
                      >
                        <div className={styles.itemCabecalho}>
                          <div>
                            <strong>{item.produto.nome}</strong>
                            <small>
                              {formatadorMoeda.format(item.preco)} por unidade
                            </small>
                          </div>

                          <button
                            type="button"
                            className={styles.botaoRemover}
                            aria-label={`Remover ${item.produto.nome}`}
                            onClick={() =>
                              removerProduto(item.produto.id)
                            }
                          >
                            Remover
                          </button>
                        </div>

                        <div className={styles.quantidadeLinha}>
                          <label
                            htmlFor={`quantidade-${item.produto.id}`}
                          >
                            Quantidade
                          </label>

                          <input
                            id={`quantidade-${item.produto.id}`}
                            type="number"
                            min="0.001"
                            max={item.disponivel}
                            step="0.001"
                            required
                            value={item.quantidade}
                            onChange={(evento) =>
                              atualizarQuantidade(
                                item.produto.id,
                                evento.target.value === ""
                                  ? 0
                                  : Number(evento.target.value),
                              )
                            }
                          />

                          <span>
                            Estoque:{" "}
                            {formatadorQuantidade.format(item.disponivel)}
                          </span>
                        </div>

                        <div className={styles.subtotalLinha}>
                          <span>Subtotal previsto</span>
                          <strong>
                            {formatadorMoeda.format(item.subtotal)}
                          </strong>
                        </div>
                      </article>
                    ))}
                  </div>
                )}

                <div className={styles.pagamento}>
                  <label htmlFor="forma-pagamento">
                    Forma de pagamento
                  </label>
                  <select
                    id="forma-pagamento"
                    value={formaPagamento}
                    onChange={(evento) =>
                      setFormaPagamento(
                        evento.target.value as FormaPagamento,
                      )
                    }
                  >
                    {formasPagamento.map((forma) => (
                      <option key={forma.valor} value={forma.valor}>
                        {forma.rotulo}
                      </option>
                    ))}
                  </select>
                </div>

                <div className={styles.total}>
                  <span>Total previsto</span>
                  <strong>
                    {formatadorMoeda.format(totalPrevisto)}
                  </strong>
                </div>

                {erroVenda && (
                  <div className={styles.erro} role="alert">
                    {erroVenda}
                  </div>
                )}

                <button
                  type="submit"
                  className={styles.botaoFinalizar}
                  disabled={
                    carregandoVenda ||
                    carregandoProdutos ||
                    linhasCarrinho.length === 0
                  }
                >
                  {carregandoVenda
                    ? "Registrando venda..."
                    : "Finalizar venda"}
                </button>

                <p className={styles.observacao}>
                  O preço definitivo, o total e o estoque são validados
                  pelo backend. O carrinho é mantido se a operação falhar.
                </p>
              </form>
            </section>

          <section className={`${styles.painel} ${styles.historico}`}>
            <div className={styles.painelCabecalho}>
              <div>
                <h2>Histórico de vendas</h2>
                <p>
                  Consulte as vendas realizadas e seus valores históricos.
                </p>
              </div>

              <span className={styles.contador}>
                {totalVendasHistorico} venda(s)
              </span>
            </div>

            <div className={styles.filtrosHistorico}>
              <label htmlFor="filtro-pagamento">
                Forma de pagamento
              </label>

              <select
                id="filtro-pagamento"
                value={filtroHistorico}
                onChange={(evento) => {
                  setPaginaHistorico(1);
                  setFiltroHistorico(
                    evento.target.value as "TODAS" | FormaPagamento,
                  );
                  setVendaDetalheId(null);
                }}
              >
                <option value="TODAS">Todas as formas</option>
                {formasPagamento.map((forma) => (
                  <option key={forma.valor} value={forma.valor}>
                    {forma.rotulo}
                  </option>
                ))}
              </select>

              <button
                type="button"
                className={styles.botaoAtualizarHistorico}
                disabled={carregandoHistorico}
                onClick={() =>
                  setTentativaHistorico((tentativa) => tentativa + 1)
                }
              >
                Atualizar
              </button>
            </div>

            {carregandoHistorico ? (
              <div className={styles.estadoVazio}>
                Carregando histórico de vendas...
              </div>
            ) : erroHistorico ? (
              <div className={styles.erro} role="alert">
                <span>{erroHistorico}</span>
                <button
                  type="button"
                  onClick={() =>
                    setTentativaHistorico((tentativa) => tentativa + 1)
                  }
                >
                  Tentar novamente
                </button>
              </div>
            ) : vendasHistorico.length === 0 ? (
              <div className={styles.estadoVazio}>
                Nenhuma venda encontrada para este filtro.
              </div>
            ) : (
              <div className={styles.tabelaHistoricoContainer}>
                <table className={styles.tabelaHistorico}>
                  <thead>
                    <tr>
                      <th>Venda</th>
                      <th>Data e hora</th>
                      <th>Pagamento</th>
                      <th>Itens</th>
                      <th>Total</th>
                      <th>Lucro bruto</th>
                      <th>Margem bruta</th>
                      <th>Detalhes</th>                   
                  </tr>
                  </thead>

                  <tbody>
                    {vendasHistorico.map((venda) => (
                      <tr key={venda.id}>
                        <td>
                          <strong>#{venda.id.slice(0, 8)}</strong>
                          <small className={styles.idVenda}>
                            {venda.id}
                          </small>
                        </td>

                        <td>
                          {new Date(venda.criadoEm).toLocaleString(
                            "pt-BR",
                            {
                              dateStyle: "short",
                              timeStyle: "short",
                            },
                          )}
                        </td>

                        <td>
                          {formasPagamento.find(
                            (forma) =>
                              forma.valor === venda.formaPagamento,
                          )?.rotulo ?? venda.formaPagamento}
                        </td>

                        <td>{venda.quantidadeItens}</td>

                        <td className={styles.valorHistorico}>
                          {formatadorMoeda.format(
                            numeroSeguro(venda.total),
                          )}
                        </td>
                        {/* Lucro bruto total da venda. */}
                        <td>
                          {!venda.custoHistoricoDisponivel ? (
                            <span className={styles.financeiroIndisponivel}>
                              Indisponível
                            </span>
                          ) : venda.lucroBrutoTotal === null ? (
                            "—"
                          ) : (
                            <strong
                              className={
                                venda.lucroBrutoTotal < 0
                                  ? styles.financeiroNegativo
                                  : styles.financeiroPositivo
                              }
                            >
                              {formatadorMoeda.format(venda.lucroBrutoTotal)}
                            </strong>
                          )}
                        </td>
                        
                        {/* Margem bruta percentual da venda. */}
                        <td>
                          {!venda.custoHistoricoDisponivel ? (
                            <span className={styles.financeiroIndisponivel}>
                              Indisponível
                            </span>
                          ) : venda.margemBrutaPercentual === null ? (
                            "—"
                          ) : (
                            <strong
                              className={
                                venda.margemBrutaPercentual < 0
                                  ? styles.financeiroNegativo
                                  : styles.financeiroPositivo
                              }
                            >
                              {venda.margemBrutaPercentual.toLocaleString("pt-BR", {
                                minimumFractionDigits: 1,
                                maximumFractionDigits: 2,
                              })}
                              %
                            </strong>
                          )}
                        </td>

                        <td>
                          <button
                            type="button"
                            className={styles.botaoDetalhes}
                            onClick={() =>
                              setVendaDetalheId((atual) =>
                                atual === venda.id ? null : venda.id,
                              )
                            }
                          >
                            {vendaDetalheId === venda.id
                              ? "Fechar"
                              : "Ver detalhes"}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {!carregandoHistorico &&
              !erroHistorico &&
              totalVendasHistorico > 0 && (
                <div className={styles.paginacaoHistorico}>
                  <span>
                    Página {paginaHistorico} de {totalPaginasHistorico}
                  </span>

                  <div>
                    <button
                      type="button"
                      disabled={paginaHistorico <= 1}
                      onClick={() => {
                        setPaginaHistorico((pagina) => pagina - 1);
                        setVendaDetalheId(null);
                      }}
                    >
                      Anterior
                    </button>

                    <button
                      type="button"
                      disabled={paginaHistorico >= totalPaginasHistorico}
                      onClick={() => {
                        setPaginaHistorico((pagina) => pagina + 1);
                        setVendaDetalheId(null);
                      }}
                    >
                      Próxima
                    </button>
                  </div>
                </div>
              )}

            {vendaDetalheId && (
              <div className={styles.detalheVenda}>
                <div className={styles.detalheCabecalho}>
                  <h3>Detalhes da venda</h3>
                  <button
                    type="button"
                    className={styles.botaoDetalhes}
                    onClick={() => setVendaDetalheId(null)}
                  >
                    Fechar detalhes
                  </button>
                </div>

                {carregandoDetalhe ? (
                  <p>Carregando detalhes...</p>
                ) : erroDetalhe ? (
                  <div className={styles.erro} role="alert">
                    {erroDetalhe}
                  </div>
                ) : detalheVenda ? (
                  <>
                    <div className={styles.resumoDetalhe}>
                      <span>
                        Venda: {detalheVenda.id}
                      </span>
                      <span>
                        Responsável: {detalheVenda.usuario.nome}
                      </span>
                      <span>
                        Pagamento:{" "}
                        {formasPagamento.find(
                          (forma) =>
                            forma.valor === detalheVenda.formaPagamento,
                        )?.rotulo ?? detalheVenda.formaPagamento}
                      </span>
                      <strong>
                        Total:{" "}
                        {formatadorMoeda.format(
                          numeroSeguro(detalheVenda.total),
                        )}
                        <span>
                          Custo total dos produtos:{" "}
                          {detalheVenda.custoHistoricoDisponivel &&
                          detalheVenda.custoTotal !== null
                            ? formatadorMoeda.format(detalheVenda.custoTotal)
                            : "Custo histórico indisponível"}
                        </span>
                          
                        <strong
                          className={
                            detalheVenda.lucroBrutoTotal === null
                              ? styles.financeiroIndisponivel
                              : detalheVenda.lucroBrutoTotal < 0
                                ? styles.financeiroNegativo
                                : styles.financeiroPositivo
                          }
                        >
                          Lucro bruto total:{" "}
                          {detalheVenda.custoHistoricoDisponivel &&
                          detalheVenda.lucroBrutoTotal !== null
                            ? formatadorMoeda.format(detalheVenda.lucroBrutoTotal)
                            : "Indisponível"}
                        </strong>
                          
                        <span>
                          Margem bruta:{" "}
                          {detalheVenda.custoHistoricoDisponivel &&
                          detalheVenda.margemBrutaPercentual !== null
                            ? `${detalheVenda.margemBrutaPercentual.toLocaleString(
                                "pt-BR",
                                {
                                  minimumFractionDigits: 1,
                                  maximumFractionDigits: 2,
                                },
                              )}%`
                            : "Indisponível"}
                        </span>
                      </strong>
                    </div>

                    <div className={styles.itensDetalhe}>
                      {detalheVenda.itens.map((item) => (
                        <article
                          key={item.id}
                          className={styles.itemDetalhe}
                        >
                          <div>
                            <strong>{item.produto.nome}</strong>
                            <small>SKU: {item.produto.sku}</small>
                            <small>
                              {formatadorQuantidade.format(
                                numeroSeguro(item.quantidade),
                              )}{" "}
                              ×{" "}
                              {formatadorMoeda.format(
                                numeroSeguro(item.precoUnitario),
                              )}
                            </small>
                          </div>

                          <div className={styles.financeiroItemDetalhe}>
                            <strong>
                              Subtotal:{" "}
                              {formatadorMoeda.format(numeroSeguro(item.subtotal))}
                            </strong>
                                                      
                            <small>
                              Custo unitário:{" "}
                              {item.custoHistoricoDisponivel &&
                              item.custoUnitario !== null
                                ? formatadorMoeda.format(item.custoUnitario)
                                : "Indisponível"}
                            </small>
                              
                            <small
                              className={
                                item.lucroBruto === null
                                  ? styles.financeiroIndisponivel
                                  : item.lucroBruto < 0
                                    ? styles.financeiroNegativo
                                    : styles.financeiroPositivo
                              }
                            >
                              Lucro bruto:{" "}
                              {item.custoHistoricoDisponivel &&
                              item.lucroBruto !== null
                                ? formatadorMoeda.format(item.lucroBruto)
                                : "Indisponível"}
                            </small>
                              
                            <small>
                              Margem bruta:{" "}
                              {item.custoHistoricoDisponivel &&
                              item.margemBrutaPercentual !== null
                                ? `${item.margemBrutaPercentual.toLocaleString(
                                    "pt-BR",
                                    {
                                      minimumFractionDigits: 1,
                                      maximumFractionDigits: 2,
                                    },
                                  )}%`
                                : "Indisponível"}
                            </small>
                          </div>
                        </article>
                      ))}
                    </div>
                  </>
                ) : null}
              </div>
            )}
          </section>

          </div>
        </main>
      </div>
    </ProtecaoSessao>
  );
}