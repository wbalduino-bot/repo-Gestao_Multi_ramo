"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";

import styles from "./vendas.module.css";
import { EstornosVendaPainel } from "./estornos-venda-painel";
import { imprimirCupomIsolado } from "./impressao-cupom";
import {
  consultarPaginaCatalogo, consultarProdutosDoCarrinho, atualizarProdutosSelecionados,
  ErroCatalogo, type ProdutoCatalogo,
} from "./catalogo-venda";
import {
  identidadeVenda, chaveCacheVenda, lerOperacaoVenda, prepararEnvioVenda,
  repetirEnvioVenda, rejeitarEnvioVenda, concluirEnvioVenda,
  exigeSenhaParaDesconto,
  type IdentidadeVenda, type OperacaoPendente, type PedidoVenda,
} from "./operacao-venda";
import { ProtecaoSessao } from "../componentes/protecao-sessao";
import { MenuLateral } from "../componentes/menu-lateral";

const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

type ProdutoApi = ProdutoCatalogo;

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
  subtotalOriginal?: number | string;
  percentualDesconto?: number | string;
  valorDesconto?: number | string;
  valorRecebido?: number | string | null;
  troco?: number | string | null;
};

/** Operacao de estorno preservada como evento separado da venda original. */
type EstornoResumoApi = {
  id: string;
  criadoEm: string;
  justificativa: string;
  valorEstornado: number;
  usuario: { id: string; nome: string };
  itens: Array<{
    itemVendaId: string;
    nomeProduto: string;
    quantidade: number;
    valorEstornado: number;
  }>;
  reembolsoFinanceiro: "NAO_REGISTRADO";
};

/** Venda resumida recebida na listagem do backend. */
type VendaResumoApi = {
  id: string;
  formaPagamento: FormaPagamento;
  total: number | string;
  totalLiquido: number;
  valorEstornado: number;
  estornos: EstornoResumoApi[];
  subtotalOriginal?: number | string;
  percentualDesconto?: number | string;
  valorDesconto?: number | string;

  // Dados de pagamento opcionais para vendas anteriores à migração.
  valorRecebido?: number | string | null;
  troco?: number | string | null;

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
  totalLiquido: number;
  valorEstornado: number;
  estornos: EstornoResumoApi[];
  subtotalOriginal?: number | string;
  percentualDesconto?: number | string;
  valorDesconto?: number | string;

  // Dados de pagamento opcionais para vendas anteriores à migração.
  valorRecebido?: number | string | null;
  troco?: number | string | null;

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

function codigoUnidadeVenda(produto: ProdutoApi): string | null {
  return typeof produto.unidadeCodigo === "string" && produto.unidadeCodigo.trim()
    ? produto.unidadeCodigo.trim().toUpperCase() : null;
}

function limiteQuantidadeVenda(produto: ProdutoApi): number {
  const saldo = obterDisponivel(produto);
  return codigoUnidadeVenda(produto) === "UN" ? Math.floor(saldo) : saldo;
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

/** Conteúdo único da prévia e da impressão; nunca inclui custos ou controles. */
function CupomVenda({
  detalheVenda,
  nomeEmpresa,
}: {
  detalheVenda: DetalheVendaApi;
  nomeEmpresa: string;
}) {
  return (
    <div id="cupom-impressao" data-venda-id={detalheVenda.id} className={styles.cupomVenda}>
      <header className={styles.cupomCabecalho}>
        <span className={styles.cupomMarca}>GC</span>
        <h4>{nomeEmpresa}</h4>
        <strong>COMPROVANTE DE VENDA</strong>
        <small>DOCUMENTO NÃO FISCAL</small>
      </header>

      <div className={styles.cupomMeta}>
        <div className={styles.cupomLinha}>
          <span>Venda</span>
          <strong>#{detalheVenda.id.slice(0, 8)}</strong>
        </div>
        <div className={styles.cupomLinha}>
          <span>Data e hora</span>
          <strong>
            {new Date(detalheVenda.criadoEm).toLocaleString(
              "pt-BR",
              {
                dateStyle: "short",
                timeStyle: "short",
              },
            )}
          </strong>
        </div>
        <div className={styles.cupomLinha}>
          <span>Responsável</span>
          <strong>{detalheVenda.usuario.nome}</strong>
        </div>
        <small className={styles.cupomIdentificador}>
          ID: {detalheVenda.id}
        </small>
      </div>

      <section className={styles.cupomItens}>
        <h5>ITENS DA VENDA</h5>

        {detalheVenda.itens.map((item) => (
          <div key={item.id} className={styles.cupomItem}>
            <strong>{item.produto.nome}</strong>
            <div className={styles.cupomLinha}>
              <span>
                {formatadorQuantidade.format(
                  numeroSeguro(item.quantidade),
                )}{" "}
                ×{" "}
                {formatadorMoeda.format(
                  numeroSeguro(item.precoUnitario),
                )}
              </span>
              <strong>
                {formatadorMoeda.format(
                  numeroSeguro(item.subtotal),
                )}
              </strong>
            </div>
          </div>
        ))}
      </section>

      <section className={styles.cupomPagamento}>
        <div className={styles.cupomLinha}>
          <span>Forma de pagamento</span>
          <strong>
            {formasPagamento.find(
              (forma) =>
                forma.valor === detalheVenda.formaPagamento,
            )?.rotulo ?? detalheVenda.formaPagamento}
          </strong>
        </div>

        {detalheVenda.valorRecebido != null && (
          <div className={styles.cupomLinha}>
            <span>Valor recebido</span>
            <strong>
              {formatadorMoeda.format(
                numeroSeguro(detalheVenda.valorRecebido),
              )}
            </strong>
          </div>
        )}

        {detalheVenda.troco != null && (
          <div className={styles.cupomLinha}>
            <span>Troco devolvido</span>
            <strong>
              {formatadorMoeda.format(
                numeroSeguro(detalheVenda.troco),
              )}
            </strong>
          </div>
        )}
      </section>

      {numeroSeguro(detalheVenda.percentualDesconto) > 0 && (
        <div className={styles.cupomPagamento}>
          <div className={styles.cupomLinha}>
            <span>Subtotal original</span>
            <strong>{formatadorMoeda.format(numeroSeguro(detalheVenda.subtotalOriginal))}</strong>
          </div>
          <div className={styles.cupomLinha}>
            <span>Desconto ({numeroSeguro(detalheVenda.percentualDesconto)}%)</span>
            <strong>− {formatadorMoeda.format(numeroSeguro(detalheVenda.valorDesconto))}</strong>
          </div>
        </div>
      )}
      <div className={styles.cupomTotal}>
        <span>{detalheVenda.valorEstornado > 0 ? "TOTAL ORIGINAL DA VENDA" : "TOTAL DA VENDA"}</span>
        <strong>{formatadorMoeda.format(numeroSeguro(detalheVenda.total))}</strong>
      </div>
      {detalheVenda.valorEstornado > 0 && (
        <div className={styles.cupomPagamento}>
          {detalheVenda.estornos.map((estorno) => (
            <div key={estorno.id} className={styles.cupomLinha}>
              <span>Estorno {new Date(estorno.criadoEm).toLocaleDateString("pt-BR")}</span>
              <strong>− {formatadorMoeda.format(estorno.valorEstornado)}</strong>
            </div>
          ))}
          <div className={styles.cupomLinha}>
            <strong>TOTAL LÍQUIDO</strong>
            <strong>{formatadorMoeda.format(detalheVenda.totalLiquido)}</strong>
          </div>
          <small>Valor líquido comercial. Reembolso financeiro ainda não registrado.</small>
        </div>
      )}

      <footer className={styles.cupomRodape}>
        <strong>Obrigado pela preferência!</strong>
        <small>Este comprovante não possui valor fiscal.</small>
      </footer>
    </div>
  );
}

export default function VendasPage() {
  const router = useRouter();

  const [produtos, setProdutos] = useState<ProdutoApi[]>([]);
  const [itensCarrinho, setItensCarrinho] = useState<ItemCarrinho[]>([]);
  const [busca, setBusca] = useState("");
  const [consultaCatalogo, setConsultaCatalogo] = useState({ busca: "", pagina: 1 });
  const [totalProdutosCatalogo, setTotalProdutosCatalogo] = useState(0);
  const [totalPaginasCatalogo, setTotalPaginasCatalogo] = useState(1);
  const [produtosCarrinho, setProdutosCarrinho] = useState<Record<string, ProdutoApi>>({});
  const [carregandoCarrinho, setCarregandoCarrinho] = useState(false);
  const [erroCarrinho, setErroCarrinho] = useState("");
  const [tentativaCarrinho, setTentativaCarrinho] = useState(0);
  const ultimaAtualizacaoCarrinho = useRef(0);
  const chaveItensCarrinho = itensCarrinho.map(i => i.produtoId).sort().join(",");
  const buscaPendente = busca.trim() !== consultaCatalogo.busca;
  const [formaPagamento, setFormaPagamento] =
    useState<FormaPagamento>("PIX");

  // Valor digitado pelo operador para pagamentos em dinheiro.
  const [valorRecebido, setValorRecebido] = useState("");
  // Apenas percentual e e-mail integram a operacao pendente.
  // A senha nunca e gravada em sessionStorage ou localStorage.
  const [percentualDesconto, setPercentualDesconto] = useState("0");
  const [autorizadorEmail, setAutorizadorEmail] = useState("");
  const [senhaAutorizador, setSenhaAutorizador] = useState("");

  const [carregandoProdutos, setCarregandoProdutos] = useState(true);
  const [carregandoVenda, setCarregandoVenda] = useState(false);
  const envioVendaEmCurso = useRef(false);
  const identidadeOperacao = useRef<IdentidadeVenda | null>(null);
  const [operacaoPendente, setOperacaoPendente] = useState<OperacaoPendente | null>(null);
  const [carregandoOperacao, setCarregandoOperacao] = useState(true);
  const [erroOperacao, setErroOperacao] = useState("");
  const bloquearEdicaoVenda = carregandoVenda || carregandoOperacao || erroOperacao.length > 0 || operacaoPendente?.estado === "INCERTA";
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
  const [larguraCupomMm, setLarguraCupomMm] = useState<58 | 80>(80);
  const [cupomPopupAberto, setCupomPopupAberto] = useState(false);
  const popupCupomRef = useRef<HTMLDialogElement>(null);

  // A caixa de diálogo nativa impede interações com a venda ao fundo.
  useEffect(() => {
    if (cupomPopupAberto && popupCupomRef.current && !popupCupomRef.current.open) {
      popupCupomRef.current.showModal();
    }
  }, [cupomPopupAberto]);

  function imprimirVendaSelecionada() {
    const cupom = document.getElementById("cupom-impressao");
    if (!cupom || !detalheVenda || cupom.dataset.vendaId !== detalheVenda.id) {
      setErroDetalhe("Comprovante não disponível para esta venda.");
      return;
    }
    try {
      imprimirCupomIsolado(cupom, larguraCupomMm, {
        cabecalho: styles.cupomCabecalho,
        marca: styles.cupomMarca,
        meta: styles.cupomMeta,
        linha: styles.cupomLinha,
        identificador: styles.cupomIdentificador,
        itens: styles.cupomItens,
        item: styles.cupomItem,
        pagamento: styles.cupomPagamento,
        total: styles.cupomTotal,
        rodape: styles.cupomRodape,
      });
    } catch (erro) {
      setErroDetalhe(erro instanceof Error ? erro.message : "Falha ao preparar impressão.");
    }
  }

  // Nome da empresa salvo na sessão durante o login.
  const [nomeEmpresa, setNomeEmpresa] = useState("Empresa autenticada");

  // O acesso gerencial é liberado somente para os perfis autorizados.
  const [perfilUsuario, setPerfilUsuario] = useState<string | null>(null);
  const acessoGerencial =
    perfilUsuario === "ADMINISTRADOR" || perfilUsuario === "GERENTE";

  useEffect(() => {
    try {
      const token = sessionStorage.getItem("gestao.accessToken");
      if (!token) { router.replace("/"); return; }
      const identidade = identidadeVenda(token);
      identidadeOperacao.current = identidade;
      const pendente = lerOperacaoVenda(sessionStorage, identidade);
      setOperacaoPendente(pendente);
      if (pendente) {
        setItensCarrinho(pendente.pedido.itens);
        setFormaPagamento(pendente.pedido.formaPagamento);
        setValorRecebido(pendente.pedido.valorRecebido === undefined ? "" : pendente.pedido.valorRecebido.toFixed(2));
        setPercentualDesconto(String(pendente.pedido.percentualDesconto ?? 0));
        setAutorizadorEmail(pendente.pedido.autorizadorEmail ?? "");
      }
    } catch (falha) {
      setErroOperacao(falha instanceof Error ? falha.message : "Nao foi possivel recuperar a tentativa de venda.");
    } finally {
      setCarregandoOperacao(false);
    }
  }, [router]);

  /**
 * Recupera o nome da empresa armazenado durante o login.
 */
useEffect(() => {
  try {
    const usuarioSalvo = sessionStorage.getItem("gestao.usuario");

    if (!usuarioSalvo) return;

    const usuario = JSON.parse(usuarioSalvo) as {
      empresaNome?: unknown;
      perfil?: unknown;
    };

    if (typeof usuario.perfil === "string") {
      setPerfilUsuario(usuario.perfil);
    }

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
  // Pesquisa no servidor e reinicia a pagina ao mudar o termo.
  useEffect(() => {
    const temporizador = setTimeout(() => {
      const termo = busca.trim();
      setConsultaCatalogo(atual => atual.busca === termo ? atual : { busca: termo, pagina: 1 });
    }, 250);
    return () => clearTimeout(temporizador);
  }, [busca]);

  useEffect(() => {
    let ativo = true;
    const controlador = new AbortController();
    async function carregarProdutos() {
      setCarregandoProdutos(true);
      setErroProdutos("");
      const token = sessionStorage.getItem("gestao.accessToken");
      if (!token) { router.replace("/"); setCarregandoProdutos(false); return; }
      try {
        const pagina = await consultarPaginaCatalogo(API_URL, token, consultaCatalogo.busca, consultaCatalogo.pagina, controlador.signal);
        if (!ativo || controlador.signal.aborted) return;
        setProdutos(pagina.dados);
        setTotalProdutosCatalogo(pagina.total);
        setTotalPaginasCatalogo(Math.max(1, pagina.totalPaginas));
        setProdutosCarrinho(atuais => atualizarProdutosSelecionados(atuais, pagina.dados));
      } catch (falha) {
        if (!ativo || controlador.signal.aborted) return;
        if (falha instanceof ErroCatalogo && falha.status === 401) {
          sessionStorage.removeItem("gestao.accessToken");
          sessionStorage.removeItem("gestao.usuario");
          router.replace("/");
          return;
        }
        setProdutos([]);
        setErroProdutos(falha instanceof Error ? falha.message : "Nao foi possivel consultar o catalogo.");
      } finally { if (ativo) setCarregandoProdutos(false); }
    }
    void carregarProdutos();
    return () => { ativo = false; controlador.abort(); };
  }, [router, tentativaCarga, consultaCatalogo]);

  // Ao recuperar uma tentativa, consulta por ID os produtos fora da pagina atual.
  useEffect(() => {
    const ids = chaveItensCarrinho ? chaveItensCarrinho.split(",") : [];
    const forcar = ultimaAtualizacaoCarrinho.current !== tentativaCarrinho;
    if (!ids.length) {
      ultimaAtualizacaoCarrinho.current = tentativaCarrinho;
      setCarregandoCarrinho(false);
      setErroCarrinho("");
      return;
    }
    const faltantes = forcar ? ids : ids.filter(id => !produtosCarrinho[id]);
    if (!faltantes.length) { setCarregandoCarrinho(false); setErroCarrinho(""); return; }
    const controlador = new AbortController();
    async function carregarCarrinho() {
      setCarregandoCarrinho(true);
      setErroCarrinho("");
      try {
        const token = sessionStorage.getItem("gestao.accessToken");
        if (!token) { router.replace("/"); return; }
        const dados = await consultarProdutosDoCarrinho(API_URL, token, faltantes, controlador.signal);
        if (controlador.signal.aborted) return;
        ultimaAtualizacaoCarrinho.current = tentativaCarrinho;
        setProdutosCarrinho(atuais => {
          const copia = { ...atuais };
          for (const p of dados) copia[p.id] = p;
          return copia;
        });
      } catch (falha) {
        if (controlador.signal.aborted) return;
        if (falha instanceof ErroCatalogo && falha.status === 401) {
          sessionStorage.removeItem("gestao.accessToken");
          sessionStorage.removeItem("gestao.usuario");
          router.replace("/");
          return;
        }
        setErroCarrinho(falha instanceof Error ? falha.message : "Nao foi possivel recuperar os produtos do carrinho.");
      } finally { if (!controlador.signal.aborted) setCarregandoCarrinho(false); }
    }
    void carregarCarrinho();
    return () => controlador.abort();
  }, [chaveItensCarrinho, produtosCarrinho, tentativaCarrinho, router]);

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
          typeof resultado.totalPaginas !== "number" ||
          !resultado.dados.every((venda) =>
            Number.isFinite(venda.totalLiquido) &&
            Number.isFinite(venda.valorEstornado) &&
            Array.isArray(venda.estornos),
          )
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
          !Array.isArray(resultado.itens) ||
          !Number.isFinite(resultado.totalLiquido) ||
          !Number.isFinite(resultado.valorEstornado) ||
          !Array.isArray(resultado.estornos)
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
  }, [router, vendaDetalheId, tentativaHistorico]);

  // O filtro e aplicado na API antes da paginacao, inclusive para codigo de barras.
  const produtosFiltrados = produtos;
  const itensSemDados = itensCarrinho.filter(i => !produtosCarrinho[i.produtoId]);

  const linhasCarrinho = useMemo(() => {
    return itensCarrinho.flatMap((item) => {
      const produto = produtosCarrinho[item.produtoId];

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
  }, [itensCarrinho, produtosCarrinho]);

  const dadosCarrinhoIncompletos = carregandoCarrinho || !!erroCarrinho || linhasCarrinho.length !== itensCarrinho.length;

  const totalPrevisto = linhasCarrinho.reduce(
    (total, item) => total + item.subtotal,
    0,
  );

  /**
   * Aceita valores simples como 100,00 ou 100.00.
   * A prévia usa centavos para evitar erros de ponto flutuante.
   * O backend continua responsável pelo cálculo definitivo.
   */
  const recebimentoInformado = valorRecebido.trim();
  const recebimentoValido =
    /^\d+(?:[,.]\d{1,2})?$/.test(recebimentoInformado);

  const recebimentoNumero = recebimentoValido
    ? Number(recebimentoInformado.replace(",", "."))
    : NaN;

  const recebimentoCentavos = Number.isFinite(recebimentoNumero)
    ? Math.round(recebimentoNumero * 100)
    : NaN;

  const totalCentavos = Math.round(totalPrevisto * 100);
  const descontoNumero = Number(percentualDesconto.replace(",", "."));
  const descontoValido = /^\d(?:[,.]\d{1,2})?$/.test(percentualDesconto.trim()) &&
    Number.isFinite(descontoNumero) && descontoNumero >= 0 && descontoNumero <= 5;
  const descontoCentavos = descontoValido
    ? Math.round(totalCentavos * descontoNumero / 100)
    : 0;
  const totalFinalCentavos = totalCentavos - descontoCentavos;
  const temDesconto = descontoValido && descontoNumero > 0;
  const exigirAutorizacaoExtra = temDesconto && exigeSenhaParaDesconto(perfilUsuario);

  const dinheiroSuficiente =
    !dadosCarrinhoIncompletos && recebimentoValido &&
    Number.isSafeInteger(recebimentoCentavos) &&
    recebimentoCentavos >= totalFinalCentavos;

  const trocoPrevisto = dinheiroSuficiente
    ? (recebimentoCentavos - totalFinalCentavos) / 100
    : null;

  function adicionarProduto(produto: ProdutoApi) {
    if (envioVendaEmCurso.current || bloquearEdicaoVenda) return;
    const disponivel = limiteQuantidadeVenda(produto);

    if (disponivel <= 0) {
      setErroVenda(
        `${produto.nome} não possui saldo disponível para venda.`,
      );
      return;
    }

    setErroVenda("");
    setSucessoVenda(null);

    setProdutosCarrinho(atuais => ({ ...atuais, [produto.id]: produto }));
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
    if (envioVendaEmCurso.current || bloquearEdicaoVenda) return;
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
    if (envioVendaEmCurso.current || bloquearEdicaoVenda) return;
    setProdutosCarrinho(atuais => { const copia = { ...atuais }; delete copia[produtoId]; return copia; });
    setItensCarrinho((atuais) =>
      atuais.filter((item) => item.produtoId !== produtoId),
    );
    setErroVenda("");
    setSucessoVenda(null);
  }

  function sessaoDaOperacao() {
    const token = sessionStorage.getItem("gestao.accessToken");
    if (!token) { router.replace("/"); throw new Error("Entre novamente para consultar a operacao pendente."); }
    const identidade = identidadeVenda(token);
    if (!identidadeOperacao.current || chaveCacheVenda(identidade) !== chaveCacheVenda(identidadeOperacao.current)) {
      throw new Error("A sessao mudou. Recarregue a pagina antes de continuar.");
    }
    return { token, identidade };
  }

  function concluirOperacaoConfirmada(venda: VendaApi, operacao: OperacaoPendente, identidade: IdentidadeVenda) {
    if (!venda || typeof venda.id !== "string" || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(venda.id) ||
        (typeof venda.total !== "number" && typeof venda.total !== "string") ||
        (typeof venda.total === "string" && !/^\d{1,12}(?:\.\d{1,2})?$/.test(venda.total)) ||
        !Number.isFinite(Number(venda.total)) || Number(venda.total) < 0 || Number(venda.total) > 999999999999.99) {
      throw new Error("Resposta inesperada. Consulte o resultado antes de reenviar.");
    }
    concluirEnvioVenda(sessionStorage, identidade, operacao);
    setOperacaoPendente(null);
    setSucessoVenda(venda);
    setProdutosCarrinho({});
    setItensCarrinho([]);
    setValorRecebido("");
    setPercentualDesconto("0");
    setAutorizadorEmail("");
    setSenhaAutorizador("");
    setPaginaHistorico(1);
    setTentativaHistorico(tentativa => tentativa + 1);
    try { localStorage.setItem("gestao.estoque.atualizado", String(Date.now())); } catch { /* Aviso complementar. */ }
    setTentativaCarga(tentativa => tentativa + 1);
  }

  async function enviarOperacaoVenda(operacao: OperacaoPendente, repeticao: boolean) {
    if (envioVendaEmCurso.current) return;
    envioVendaEmCurso.current = true;
    setCarregandoVenda(true);
    setErroVenda("");
    try {
      const { token, identidade } = sessaoDaOperacao();
      const envio = repeticao ? repetirEnvioVenda(sessionStorage, identidade, operacao) : operacao;
      // Uma tentativa concluida mas sem resposta deve ser consultada por chave.
      // Para um novo POST com desconto, solicitar novamente a senha se necessario.
      if (envio.pedido.percentualDesconto && exigeSenhaParaDesconto(perfilUsuario) && !senhaAutorizador) {
        throw new Error("Informe a senha do administrador para confirmar ou repetir esta venda com desconto.");
      }
      setOperacaoPendente(envio);
      const resposta = await fetch(`${API_URL}/vendas`, {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ ...envio.pedido, chaveOperacao: envio.chaveOperacao,
          ...(envio.pedido.percentualDesconto && exigeSenhaParaDesconto(perfilUsuario) ? { senhaAutorizador } : {}),
        }),
      });
      const dados = await lerJson(resposta);
      if (resposta.status === 401) {
        sessionStorage.removeItem("gestao.accessToken");
        sessionStorage.removeItem("gestao.usuario");
        router.replace("/");
        return;
      }
      if (!resposta.ok) {
        if ([400, 403, 404, 422].includes(resposta.status)) {
          // Mesmo ao corrigir um erro de validacao, a chave e mantida.
          setOperacaoPendente(rejeitarEnvioVenda(sessionStorage, identidade, envio));
        }
        throw new Error(obterMensagemErro(dados, "Nao foi possivel confirmar. Consulte o resultado antes de tentar novamente."));
      }
      concluirOperacaoConfirmada(dados as VendaApi, envio, identidade);
    } catch (falha) {
      setErroVenda(falha instanceof TypeError
        ? "A resposta nao chegou. Consulte o resultado ou repita a mesma confirmacao; nao inicie outra venda para esta compra."
        : falha instanceof Error ? falha.message : "Nao foi possivel confirmar a operacao.");
    } finally {
      setSenhaAutorizador(""); // nao preservar credenciais apos envio
      envioVendaEmCurso.current = false;
      setCarregandoVenda(false);
    }
  }

  async function consultarResultadoOperacao() {
    if (!operacaoPendente || envioVendaEmCurso.current) return;
    const operacao = operacaoPendente;
    envioVendaEmCurso.current = true;
    setCarregandoVenda(true);
    setErroVenda("");
    try {
      const { token, identidade } = sessaoDaOperacao();
      const resposta = await fetch(`${API_URL}/vendas/operacoes/${encodeURIComponent(operacao.chaveOperacao)}`, {
        headers: { Accept: "application/json", Authorization: `Bearer ${token}` }, cache: "no-store",
      });
      const dados = await lerJson(resposta);
      if (resposta.status === 401) {
        sessionStorage.removeItem("gestao.accessToken");
        sessionStorage.removeItem("gestao.usuario");
        router.replace("/");
        return;
      }
      if (!resposta.ok) throw new Error(obterMensagemErro(dados, "Nao foi possivel consultar esta operacao."));
      if (dados && typeof dados === "object" && "situacao" in dados && dados.situacao === "NAO_LOCALIZADA") {
        setErroVenda("Ainda nao foi localizada uma venda concluida para esta operacao. Ela pode estar em andamento; repita a mesma confirmacao, sem gerar outra chave.");
        return;
      }
      if (!dados || typeof dados !== "object" || !("situacao" in dados) || dados.situacao !== "CONCLUIDA" || !("venda" in dados)) {
        throw new Error("Resposta de consulta inesperada. A tentativa foi preservada.");
      }
      concluirOperacaoConfirmada(dados.venda as VendaApi, operacao, identidade);
    } catch (falha) {
      setErroVenda(falha instanceof Error ? falha.message : "Falha ao consultar. A tentativa foi preservada.");
    } finally {
      envioVendaEmCurso.current = false;
      setCarregandoVenda(false);
    }
  }

  async function finalizarVenda(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    if (envioVendaEmCurso.current || bloquearEdicaoVenda) return;
    setErroVenda("");
    setSucessoVenda(null);
    if (dadosCarrinhoIncompletos) {
      setErroVenda("Aguarde ou atualize os produtos do carrinho antes de finalizar. Nenhum item pode ser omitido.");
      return;
    }
    if (!descontoValido) {
      setErroVenda("O desconto deve estar entre 0 e 5%, com ate duas casas decimais.");
      return;
    }
    if (exigirAutorizacaoExtra && (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(autorizadorEmail.trim()) || !senhaAutorizador)) {
      setErroVenda("Informe o e-mail e a senha de um administrador da empresa para autorizar o desconto.");
      return;
    }
    if (formaPagamento === "DINHEIRO" && !dinheiroSuficiente) {
      setErroVenda("Informe um valor recebido valido e suficiente para a compra.");
      return;
    }
    if (linhasCarrinho.length === 0 || linhasCarrinho.length !== itensCarrinho.length) {
      setErroVenda("Confira os produtos do carrinho. Alguns podem nao estar disponiveis no catalogo carregado.");
      return;
    }
    for (const item of linhasCarrinho) {
      if (!item.produto.ativo) { setErroVenda(`O produto ${item.produto.nome} esta inativo. Remova-o antes de finalizar.`); return; }
      if (!Number.isFinite(item.quantidade) || item.quantidade <= 0 ||
          !/^\d{1,11}(?:\.\d{1,3})?$/.test(String(item.quantidade)) ||
          (codigoUnidadeVenda(item.produto) === "UN" && !Number.isInteger(item.quantidade))) {
        setErroVenda(`Confira a quantidade de ${item.produto.nome}. UN exige inteiro; peso admite ate tres casas decimais.`);
        return;
      }
      if (item.quantidade > item.disponivel) {
        setErroVenda(`Estoque insuficiente para ${item.produto.nome}. Disponivel: ${formatadorQuantidade.format(item.disponivel)}.`);
        return;
      }
    }
    try {
      const { identidade } = sessaoDaOperacao();
      const pedido: PedidoVenda = { formaPagamento,
        ...(temDesconto ? { percentualDesconto: descontoNumero } : {}),
        ...(exigirAutorizacaoExtra ? { autorizadorEmail: autorizadorEmail.trim().toLowerCase() } : {}),
        ...(formaPagamento === "DINHEIRO" ? { valorRecebido: recebimentoCentavos / 100 } : {}),
        itens: linhasCarrinho.map(item => ({ produtoId: item.produto.id, quantidade: item.quantidade })),
      };
      // Grava a tentativa antes do primeiro POST. Falha de armazenamento impede o envio.
      const operacao = prepararEnvioVenda(sessionStorage, identidade, pedido);
      setOperacaoPendente(operacao);
      await enviarOperacaoVenda(operacao, false);
    } catch (falha) {
      setErroVenda(falha instanceof Error ? falha.message : "Nao foi possivel preservar a operacao. Venda nao enviada.");
    }
  }

  return (
    <ProtecaoSessao>
      <div className={styles.pagina}>
        <MenuLateral nomeEmpresa={nomeEmpresa} />

        <main className={styles.conteudo}>
          <header className={styles.cabecalho}>
            <div>
              <p className={styles.sobretitulo}>OPERAÇÃO COMERCIAL</p>
              <h1>Nova venda</h1>
              <p className={styles.descricao}>
                Selecione os produtos, confira o total e finalize a venda.
              </p>
            </div>

            <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
              {acessoGerencial && (
                <Link href="/caixa" className={styles.linkSecundario}>
                  Fechamento de caixa
                </Link>
              )}
              <Link href="/produtos" className={styles.linkSecundario}>
                Consultar estoque
              </Link>
            </div>
          </header>

          {erroOperacao && <section className={styles.erro} role="alert">{erroOperacao}</section>}
          {operacaoPendente && (
            <section className={styles.painel} role="status" aria-label="Resultado da operacao de venda">
              <h2>{operacaoPendente.estado === "INCERTA" ? "Confirmação pendente" : "Confira os dados da compra"}</h2>
              <p>{operacaoPendente.estado === "INCERTA"
                ? "A venda pode ter sido registrada. Consulte o resultado ou repita a mesma confirmação antes de iniciar outra compra."
                : "A tentativa foi recusada. Corrija os dados e finalize novamente; a identificação da compra será mantida."}</p>
              <ul>{operacaoPendente.pedido.itens.map(item => (
                <li key={item.produtoId}>{produtosCarrinho[item.produtoId]?.nome ?? "Produto do pedido anterior"}: {formatadorQuantidade.format(item.quantidade)}</li>
              ))}</ul>
              <button type="button" disabled={carregandoVenda || carregandoOperacao || !!erroOperacao}
                onClick={() => void consultarResultadoOperacao()}>Consultar resultado</button>
              <button type="button" disabled={carregandoVenda || carregandoOperacao || !!erroOperacao}
                onClick={() => void enviarOperacaoVenda(operacaoPendente, true)}>
                {operacaoPendente.estado === "INCERTA" ? "Repetir confirmação" : "Repetir pedido anterior"}
              </button>
            </section>
          )}
          {sucessoVenda && (
            <section className={styles.sucesso} role="status">
              <strong>Venda concluída com sucesso!</strong>
              <span>
                Venda {sucessoVenda.id} · Total confirmado:{" "}
                {formatadorMoeda.format(
                  numeroSeguro(sucessoVenda.total),
                )}
              </span>
              {sucessoVenda.troco !== null &&
                sucessoVenda.troco !== undefined && (
                  <span>
                    Troco a devolver:{" "}
                    {formatadorMoeda.format(
                      numeroSeguro(sucessoVenda.troco),
                    )}
                  </span>
                )}
              <button type="button" className={styles.botaoDetalhes} onClick={() => {
                setVendaDetalheId(sucessoVenda.id);
                setCupomPopupAberto(true);
              }}>Abrir comprovante para impressão</button>
            </section>
          )}

          <div className={styles.grade}>
            <section className={styles.painel}>
              <div className={styles.painelCabecalho}>
                <div>
                  <h2>Produtos disponíveis</h2>
                  <p>Pesquise e adicione produtos à compra</p>
                </div>
                <span className={styles.contador}>
                  {totalProdutosCatalogo} produto(s) encontrado(s)
                </span>
              </div>

              <label className={styles.buscaLabel} htmlFor="busca-produtos">
                Buscar produto por nome, SKU ou código de barras
              </label>
              <input
                id="busca-produtos"
                maxLength={100}
                className={styles.busca}
                type="search"
                placeholder="Nome, SKU ou código de barras"
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

              {carregandoProdutos || buscaPendente ? (
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
                            {formatadorQuantidade.format(disponivel)} {codigoUnidadeVenda(produto) ?? "(unidade não informada)"}
                          </small>
                        </div>

                        <div className={styles.produtoAcao}>
                          <strong>{formatadorMoeda.format(preco)}{codigoUnidadeVenda(produto) ? `/${codigoUnidadeVenda(produto)}` : ""}</strong>
                          <button
                            type="button"
                            className={styles.botaoAdicionar}
                            disabled={bloquearEdicaoVenda || limiteQuantidadeVenda(produto) <= 0}
                            onClick={() => adicionarProduto(produto)}
                          >
                            {limiteQuantidadeVenda(produto) <= 0
                              ? "Sem estoque"
                              : "Adicionar"}
                          </button>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
              <nav className={styles.paginacaoHistorico} aria-label="Páginas do catálogo de produtos">
                <span>Página {consultaCatalogo.pagina} de {totalPaginasCatalogo} · {produtos.length} de {totalProdutosCatalogo} produto(s)</span>
                <div>
                  <button type="button" disabled={carregandoProdutos || buscaPendente || !!erroProdutos || consultaCatalogo.pagina <= 1}
                    onClick={() => setConsultaCatalogo(atual => ({ ...atual, pagina: Math.max(1, atual.pagina - 1) }))}>Anterior</button>
                  <button type="button" disabled={carregandoProdutos || buscaPendente || !!erroProdutos || consultaCatalogo.pagina >= totalPaginasCatalogo}
                    onClick={() => setConsultaCatalogo(atual => ({ ...atual, pagina: atual.pagina + 1 }))}>Próxima</button>
                  <button type="button" disabled={carregandoProdutos || buscaPendente}
                    onClick={() => setTentativaCarga(atual => atual + 1)}>Atualizar catálogo</button>
                </div>
              </nav>
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

              <button type="button" disabled={bloquearEdicaoVenda || carregandoCarrinho || itensCarrinho.length === 0}
                onClick={() => setTentativaCarrinho(atual => atual + 1)}>Atualizar produtos do carrinho</button>
              {carregandoCarrinho && <p role="status">Recuperando produtos e saldos do carrinho…</p>}
              {erroCarrinho && <p className={styles.erro} role="alert">{erroCarrinho}</p>}
              {!!itensSemDados.length && <div role="status">
                <p>Há produtos aguardando consulta. O total não será finalizado com itens ausentes.</p>
                <ul>{itensSemDados.map(item => <li key={item.produtoId}>
                  Produto pendente · {formatadorQuantidade.format(item.quantidade)}
                  <button type="button" disabled={bloquearEdicaoVenda} onClick={() => removerProduto(item.produtoId)}>Remover item pendente</button>
                </li>)}</ul>
              </div>}
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
                              {formatadorMoeda.format(item.preco)}{codigoUnidadeVenda(item.produto) ? ` por ${codigoUnidadeVenda(item.produto)}` : " (unidade não informada)"}
                            </small>
                          </div>

                          <button
                            type="button"
                            className={styles.botaoRemover}
                            disabled={bloquearEdicaoVenda}
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
                            {codigoUnidadeVenda(item.produto) === "KG" ? "Peso (KG)"
                              : codigoUnidadeVenda(item.produto) ? `Quantidade (${codigoUnidadeVenda(item.produto)})` : "Quantidade"}
                          </label>

                          <input
                            id={`quantidade-${item.produto.id}`}
                            type="number"
                            min={codigoUnidadeVenda(item.produto) === "UN" ? "1" : "0.001"}
                            max={limiteQuantidadeVenda(item.produto)}
                            step={codigoUnidadeVenda(item.produto) === "UN" ? "1" : "0.001"}
                            inputMode="decimal"
                            disabled={bloquearEdicaoVenda}
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
                            {formatadorQuantidade.format(item.disponivel)} {codigoUnidadeVenda(item.produto) ?? ""}
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
                  <label htmlFor="percentual-desconto">Desconto na venda (%) — maximo 5%</label>
                  <input
                    id="percentual-desconto"
                    type="number"
                    inputMode="decimal"
                    min="0"
                    max="5"
                    step="0.01"
                    value={percentualDesconto}
                    onChange={e => setPercentualDesconto(e.target.value)}
                    disabled={bloquearEdicaoVenda}
                    aria-invalid={!descontoValido}
                  />
                  {!descontoValido && <p role="alert">Informe um percentual entre 0 e 5, com ate duas casas.</p>}
                  {temDesconto && acessoGerencial && (
                    <p>Desconto liberado pelo seu perfil gerencial. A autorizacao sera registrada na venda.</p>
                  )}
                  {exigirAutorizacaoExtra && (
                    <fieldset style={{ border: "1px solid #999", borderRadius: 8, padding: 12, marginTop: 8 }}>
                      <legend>Autorizacao do administrador</legend>
                      <p>A senha sera validada pela API e nao ficara salva no navegador.</p>
                      <label htmlFor="autorizador-email">E-mail do administrador</label>
                      <input id="autorizador-email" type="email" autoComplete="off"
                        disabled={bloquearEdicaoVenda} value={autorizadorEmail}
                        onChange={e => setAutorizadorEmail(e.target.value)} required />
                      <label htmlFor="autorizador-senha">Senha de autorizacao</label>
                      <input id="autorizador-senha" type="password" autoComplete="off"
                        disabled={carregandoVenda || carregandoOperacao} value={senhaAutorizador}
                        onChange={e => setSenhaAutorizador(e.target.value)} required />
                    </fieldset>
                  )}
                </div>

                <div className={styles.pagamento}>
                  <label htmlFor="forma-pagamento">
                    Forma de pagamento
                  </label>
                  <select
                    id="forma-pagamento"
                    disabled={bloquearEdicaoVenda}
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

                {formaPagamento === "DINHEIRO" && (
                  <div className={styles.pagamento}>
                    <label htmlFor="valor-recebido">
                      Valor recebido em dinheiro (R$)
                    </label>
                    <input
                      id="valor-recebido"
                      type="text"
                      inputMode="decimal"
                      value={valorRecebido}
                      onChange={(evento) =>
                        setValorRecebido(evento.target.value)
                      }
                      placeholder="Ex.: 100,00"
                      autoComplete="off"
                      disabled={bloquearEdicaoVenda}
                      aria-invalid={
                        recebimentoInformado.length > 0 &&
                        !dinheiroSuficiente
                      }
                    />

                    {trocoPrevisto !== null ? (
                      <p>
                        Troco previsto:{" "}
                        <strong>
                          {formatadorMoeda.format(trocoPrevisto)}
                        </strong>
                      </p>
                    ) : (
                      recebimentoInformado.length > 0 && (
                        <p role="alert">
                          Informe um valor válido, igual ou superior
                          ao total da compra.
                        </p>
                      )
                    )}
                  </div>
                )}

                <div className={styles.total}>
                  <span>{dadosCarrinhoIncompletos ? "Total aguardando produtos" : "Subtotal"}</span>
                  <strong>{dadosCarrinhoIncompletos ? "—" : formatadorMoeda.format(totalPrevisto)}</strong>
                </div>
                {temDesconto && !dadosCarrinhoIncompletos && (
                  <div className={styles.total}>
                    <span>Desconto solicitado ({descontoNumero}%)</span>
                    <strong>− {formatadorMoeda.format(descontoCentavos / 100)}</strong>
                  </div>
                )}
                <div className={styles.total}>
                  <span>Total previsto com desconto</span>
                  <strong>{dadosCarrinhoIncompletos ? "—" : formatadorMoeda.format(totalFinalCentavos / 100)}</strong>
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
                    bloquearEdicaoVenda ||
                    dadosCarrinhoIncompletos ||
                    carregandoProdutos ||
                    !descontoValido ||
                    (exigirAutorizacaoExtra && (!autorizadorEmail.trim() || !senhaAutorizador)) ||
                    linhasCarrinho.length === 0 ||
                    (formaPagamento === "DINHEIRO" &&
                      !dinheiroSuficiente)
                  }
                >
                  {carregandoVenda
                    ? "Registrando venda..."
                    : "Finalizar venda"}
                </button>

                <p className={styles.observacao}>
                  Confira os itens e o total antes de finalizar.
                  Se a resposta não chegar, consulte ou repita a confirmação pendente.
                </p>
              </form>
            </section>

          <section className={`${styles.painel} ${styles.historico}`}>
            <div className={styles.painelCabecalho}>
              <div>
                <h2>Histórico de vendas</h2>
                <p>
                  Venda original, estornos e total líquido — sem confundir estorno com reembolso.
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
                      <th>Total líquido</th>
                       <th>Troco</th>
                      {acessoGerencial && <th>Lucro bruto</th>}
                      {acessoGerencial && <th>Margem bruta</th>}
                      <th>Detalhes</th>
                  </tr>
                  </thead>

                  <tbody>
                    {vendasHistorico.map((venda) => (
                      <Fragment key={venda.id}>
                      <tr>
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
                          <strong>{formatadorMoeda.format(numeroSeguro(venda.totalLiquido))}</strong>
                          {venda.valorEstornado > 0 && (
                            <small style={{ display: "block", color: "#64748b", fontWeight: 400 }}>
                              Original: {formatadorMoeda.format(numeroSeguro(venda.total))}
                            </small>
                          )}
                        </td>
                        {/* Troco é informação operacional, não receita. */}
                        <td className={styles.valorHistorico}>
                          {venda.troco === null ||
                          venda.troco === undefined
                            ? "—"
                            : formatadorMoeda.format(
                                numeroSeguro(venda.troco),
                              )}
                        </td>
                        {acessoGerencial && (
                          <>
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

                          </>
                        )}

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
                      {venda.estornos.map((estorno) => (
                        <tr key={estorno.id} style={{ backgroundColor: "#fff7ed" }}>
                          <td>
                            <strong>ESTORNO</strong>
                            <small className={styles.idVenda}>#{estorno.id.slice(0, 8)} · Venda #{venda.id.slice(0, 8)}</small>
                          </td>
                          <td>{new Date(estorno.criadoEm).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}</td>
                          <td>—</td>
                          <td>
                            {estorno.itens.map((item) => `${formatadorQuantidade.format(item.quantidade)} de ${item.nomeProduto}`).join(", ")}
                          </td>
                          <td className={styles.valorHistorico}>
                            <strong style={{ color: "#b45309" }}>− {formatadorMoeda.format(estorno.valorEstornado)}</strong>
                          </td>
                          <td>—</td>
                          {acessoGerencial && <td colSpan={2}>Movimentação registrada · Não comprova reembolso</td>}
                          <td>
                            <small title={estorno.justificativa}>Por {estorno.usuario.nome}</small>
                          </td>
                        </tr>
                      ))}
                      </Fragment>
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

            {vendaDetalheId && !cupomPopupAberto && (
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
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 12, margin: "12px 0", flexWrap: "wrap" }}>
                      <label htmlFor="largura-cupom" style={{ fontSize: 13 }}>
                        Papel térmico:
                      </label>
                      <select
                        id="largura-cupom"
                        value={larguraCupomMm}
                        onChange={(evento) => setLarguraCupomMm(evento.target.value === "58" ? 58 : 80)}
                        aria-label="Largura do cupom de impressão"
                        style={{ minHeight: 36, padding: "4px 8px" }}
                      >
                        <option value={80}>80 mm</option>
                        <option value={58}>58 mm</option>
                      </select>
                      <button
                        type="button"
                        className={styles.botaoDetalhes}
                        onClick={imprimirVendaSelecionada}
                        aria-label="Imprimir somente o comprovante desta venda"
                      >
                        Imprimir somente esta venda
                      </button>
                      <button
                        type="button"
                        className={styles.botaoDetalhes}
                        onClick={() => setCupomPopupAberto(true)}
                      >
                        Visualizar cupom em pop-up
                      </button>
                    </div>
                    <CupomVenda detalheVenda={detalheVenda} nomeEmpresa={nomeEmpresa} />

                    {acessoGerencial && (
                      <EstornosVendaPainel
                        key={detalheVenda.id}
                        vendaId={detalheVenda.id}
                        itens={detalheVenda.itens}
                        onConcluido={() => setTentativaHistorico((t) => t + 1)}
                      />
                    )}

                    {/*
                      Informações internas não fazem parte do cupom.
                      Somente administradores e gerentes podem vê-las.
                    */}
                    {acessoGerencial && (
                      <section className={styles.painelGerencial}>
                        <h4>Resumo gerencial da venda — valores líquidos</h4>
                        <p>
                          Custos e margem consolidados consideram as quantidades estornadas.
                          O registro do reembolso financeiro é independente.
                        </p>

                        <div className={styles.gerencialGrade}>
                          <div>
                            <span>Custo total dos produtos</span>
                            <strong>
                              {detalheVenda.custoHistoricoDisponivel &&
                              detalheVenda.custoTotal !== null
                                ? formatadorMoeda.format(
                                    detalheVenda.custoTotal,
                                  )
                                : "Indisponível"}
                            </strong>
                          </div>

                          <div>
                            <span>Lucro bruto total</span>
                            <strong>
                              {detalheVenda.custoHistoricoDisponivel &&
                              detalheVenda.lucroBrutoTotal !== null
                                ? formatadorMoeda.format(
                                    detalheVenda.lucroBrutoTotal,
                                  )
                                : "Indisponível"}
                            </strong>
                          </div>

                          <div>
                            <span>Margem bruta</span>
                            <strong>
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
                            </strong>
                          </div>
                        </div>

                        <h5>Custos e resultados originais por produto</h5>
                        {detalheVenda.itens.map((item) => (
                          <div key={item.id} className={styles.gerencialItem}>
                            <strong>{item.produto.nome}</strong>
                            <span>
                              Custo unitário:{" "}
                              {item.custoHistoricoDisponivel &&
                              item.custoUnitario !== null
                                ? formatadorMoeda.format(item.custoUnitario)
                                : "Indisponível"}
                            </span>
                            <span>
                              Lucro bruto:{" "}
                              {item.custoHistoricoDisponivel &&
                              item.lucroBruto !== null
                                ? formatadorMoeda.format(item.lucroBruto)
                                : "Indisponível"}
                            </span>
                            <span>
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
                            </span>
                          </div>
                        ))}
                      </section>
                    )}
                  </>
                ) : null}
              </div>
            )}
          </section>

          </div>
        </main>
      </div>
      {cupomPopupAberto && (
        <dialog
          ref={popupCupomRef}
          className={styles.popupCupom}
          aria-labelledby="titulo-popup-cupom"
          onClose={() => {
            setCupomPopupAberto(false);
            setVendaDetalheId(null);
          }}
        >
          <div className={styles.popupCabecalho}>
            <div>
              <h3 id="titulo-popup-cupom">Pré-visualização do comprovante</h3>
              <p>Confira a venda antes de imprimir. Documento não fiscal.</p>
            </div>
            <button
              type="button"
              className={styles.botaoDetalhes}
              onClick={() => popupCupomRef.current?.close()}
              aria-label="Fechar pré-visualização do comprovante"
            >
              Fechar
            </button>
          </div>
          {carregandoDetalhe ? (
            <p role="status">Carregando comprovante...</p>
          ) : erroDetalhe ? (
            <div className={styles.erro} role="alert">{erroDetalhe}</div>
          ) : detalheVenda && detalheVenda.id === vendaDetalheId ? (
            <>
              <div className={styles.popupControles}>
                <label htmlFor="papel-popup-cupom">Papel térmico</label>
                <select
                  id="papel-popup-cupom"
                  value={larguraCupomMm}
                  onChange={(evento) => setLarguraCupomMm(evento.target.value === "58" ? 58 : 80)}
                >
                  <option value={80}>80 mm</option>
                  <option value={58}>58 mm</option>
                </select>
                <button type="button" className={styles.botaoDetalhes} onClick={imprimirVendaSelecionada}>
                  Imprimir comprovante
                </button>
              </div>
              <div className={styles.popupVisualizacao}>
                <div className={larguraCupomMm === 58 ? styles.previa58mm : styles.previa80mm}>
                  <CupomVenda detalheVenda={detalheVenda} nomeEmpresa={nomeEmpresa} />
                </div>
              </div>
              <p className={styles.popupNota}>
                Para salvar em PDF, selecione essa opção na janela de impressão.
                O comprovante não substitui a nota fiscal.
              </p>
            </>
          ) : (
            <div className={styles.erro} role="alert">Não foi possível carregar o comprovante desta venda.</div>
          )}
        </dialog>
      )}
    </ProtecaoSessao>
  );
}