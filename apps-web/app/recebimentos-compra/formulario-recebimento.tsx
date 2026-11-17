"use client";

import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import styles from "../configuracao-fiscal/configuracao-fiscal.module.css";

import { calcularQuantidadeNota, codigosUnidadeEstoqueDaNota } from "./calcular-quantidade-nota";
import { calcularPreviaPrecoNota } from "./calcular-previa-preco-nota";

type Produto = { id: string; nome: string; sku: string; unidadeId?: string | null };

export type VinculoNotaAgente = {
  indiceNota: number;
  produto: Produto;
};
export type UnidadeEstoque = { id: string; codigo: string; nome: string };
export type CategoriaPreco = { id: string; nome: string; percentualAcrescimo?: string | number | null };

type ProdutoNovo = {
  nome: string;
  categoriaId: string;
  usarPrecoDaNota: boolean;
  custo: string;
  preco: string;
};

function usaEmbalagem(unidade: string | null | undefined) {
  return ["PC", "CX"].includes(
    (unidade ?? "").trim().toUpperCase(),
  );
}

function sugerirFator(linha: LinhaNotaAgente) {
  if (!usaEmbalagem(linha.unidadeNota)) return "";
  const fatores = new Set(
    Array.from(
      linha.descricaoNota.matchAll(/\bC\s*\/\s*([1-9]\d*)(?![\d.,])/gi),
      (encontrado) => encontrado[1],
    ),
  );
  return fatores.size === 1 ? (fatores.values().next().value ?? "") : "";
}

function unidadeParaEntrada(
  item: Item,
  linha: LinhaNotaAgente,
  unidades: UnidadeEstoque[],
): { codigo: string; existente: boolean } | null {
  if (typeof linha.unidadeNota !== "string" ||
      !linha.unidadeNota.trim()) {
    return null;
  }

  if (item.produtoNovo) {
    const codigos = codigosUnidadeEstoqueDaNota(linha.unidadeNota);
    for (const codigo of codigos) {
      if (unidades.some((unidade) => unidade.codigo === codigo)) {
        return { codigo, existente: true };
      }
    }
    return { codigo: codigos[0], existente: false };
  }
  const unidade = unidades.find(({ id }) => id === item.produto?.unidadeId);
  return unidade ? { codigo: unidade.codigo, existente: true } : null;
}

const formatoMoeda = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});
const formatoPercentual = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 });

function preverPreco(
  produto: ProdutoNovo,
  linha: LinhaNotaAgente,
  quantidade: number,
  categorias: CategoriaPreco[],
) {
  const categoria = categorias.find(({ id }) => id === produto.categoriaId);
  return calcularPreviaPrecoNota(linha.valorTotalItemNota, quantidade, categoria?.percentualAcrescimo);
}

function montarItemAgente(
  item: Item, nota: NotaAgente, unidades: UnidadeEstoque[], categorias: CategoriaPreco[],
) {
  if (item.indiceNota === undefined) return null;
  const linha = nota.itens[item.indiceNota];
  if (!linha || typeof linha.unidadeNota !== "string" ||
      !linha.unidadeNota.trim()) return null;
  const unidade = unidadeParaEntrada(item, linha, unidades);
  if (!unidade) return null;
  const fatorEmbalagem = usaEmbalagem(linha.unidadeNota)
    ? Number(item.fatorEmbalagem)
    : undefined;
  const quantidadeRecebida = calcularQuantidadeNota(
    linha.quantidadeNota, linha.unidadeNota, unidade.codigo, fatorEmbalagem,
  );
  if (quantidadeRecebida === null) return null;

  const novo = item.produtoNovo;
  if (novo) {
    if (!novo.nome.trim()) return null;
    if (novo.usarPrecoDaNota) {
      if (!preverPreco(novo, linha, quantidadeRecebida, categorias)) return null;
    } else if (!novo.custo || !novo.preco) {
      return null;
    }
  }
  return {
    indiceNota: item.indiceNota,
    quantidadeRecebida,
    ...(fatorEmbalagem !== undefined ? { fatorEmbalagem } : {}),
    ...(novo
      ? {
          usarPrecoDaNota: novo.usarPrecoDaNota,
          produtoNovo: {
            nome: novo.nome.trim(),
            ...(novo.categoriaId ? { categoriaId: novo.categoriaId } : {}),
            ...(novo.usarPrecoDaNota ? {} : { custo: Number(novo.custo), preco: Number(novo.preco) }),
          },
        }
      : { produtoId: item.produto?.id }),
    ...(item.codigoLote.trim() ? { codigoLote: item.codigoLote.trim() } : {}),
    ...(item.validadeEm ? { validadeEm: item.validadeEm } : {}),
  };
}

type LinhaNotaAgente = {
  codigoFornecedor: string;
  descricaoNota: string;
  unidadeNota: string | null;
  quantidadeNota: string;
  valorUnitarioNota?: string;
  valorTotalItemNota?: string;
  valoresConferem?: boolean;
};

export type NotaAgente = {
  fornecedorNome: string;
  fornecedorCnpj: string;
  serieNota: string;
  numeroNota: string;
  emitidaEm: string | null;
  compradaEm?: string | null;
  itens: LinhaNotaAgente[];
  modoExtracao?: string;
  avisos?: string[];
  aptoParaConfirmacaoAutomatica?: boolean;
  revisaoFiscal?: { status?: string; revisadaPorId?: string; revisadaEm?: string };
  extracaoOriginalOcr?: unknown;
};

export function notaOcrRevisada(nota: NotaAgente) {
  return nota.modoExtracao === "OCR_PILOTO" &&
    nota.revisaoFiscal?.status === "VALIDADA" &&
    Boolean(nota.revisaoFiscal.revisadaPorId) &&
    Boolean(nota.revisaoFiscal.revisadaEm) &&
    Boolean(nota.extracaoOriginalOcr) &&
    Boolean(nota.emitidaEm) &&
    nota.itens.length > 0 &&
    nota.itens.every(linha => linha.valoresConferem === true && Boolean(linha.unidadeNota?.trim()));
}

type Catalogo = {
  dados: Produto[];
  totalPaginas: number;
  pagina: number;
};

type Item = {
  chave: number;
  indiceNota?: number;
  produto?: Produto;
  produtoNovo?: ProdutoNovo;
  descricaoNota: string;
  quantidade: string;
  fatorEmbalagem: string;
  codigoLote: string;
  validadeEm: string;
};

type CampoItem = "descricaoNota" | "quantidade" | "codigoLote" | "validadeEm" | "fatorEmbalagem";

const camposNota = [
  { nome: "fornecedorNome", rotulo: "Fornecedor", max: 150, tipo: "text", obrigatorio: true },
  { nome: "fornecedorCnpj", rotulo: "CNPJ do fornecedor", max: 18, tipo: "text", obrigatorio: true },
  { nome: "serieNota", rotulo: "Série", max: 3, tipo: "text", obrigatorio: true },
  { nome: "numeroNota", rotulo: "Número da nota", max: 9, tipo: "text", obrigatorio: true },
  { nome: "emitidaEm", rotulo: "Data de emissão", tipo: "date", obrigatorio: false },
  { nome: "compradaEm", rotulo: "Data da compra", tipo: "date", obrigatorio: false },
] as const;

function mensagemDaApi(dados: unknown, padrao: string) {
  if (!dados || typeof dados !== "object" || !("message" in dados)) return padrao;

  const mensagem = dados.message;
  if (typeof mensagem === "string") return mensagem;
  if (Array.isArray(mensagem)) {
    return mensagem.filter((item) => typeof item === "string").join(" ") || padrao;
  }
  return padrao;
}

export function FormularioRecebimento({
  apiUrl,
  aoConfirmar,
  nota,
  notaId,
  unidades = [],
  categorias = [],
  vinculos = [],
  aoFechar,
}: {
  apiUrl: string;
  aoConfirmar?: () => void;
  nota?: NotaAgente;
  notaId?: string;
  unidades?: UnidadeEstoque[];
  categorias?: CategoriaPreco[];
  vinculos?: VinculoNotaAgente[];
  aoFechar?: () => void;
}) {
  const router = useRouter();
  const proximaChave = useRef(nota?.itens.length ?? 0);
  const [indiceNota, setIndiceNota] = useState("");
  const [busca, setBusca] = useState("");
  const [catalogo, setCatalogo] = useState<Catalogo | null>(null);
  const [itens, setItens] = useState<Item[]>(() => {
    if (!nota) return [];

    const vinculados = new Map(
      vinculos.map(({ indiceNota, produto }) => [indiceNota, produto]),
    );

    return nota.itens.map((linha, indiceNota): Item => {
      const produto = vinculados.get(indiceNota);

      return {
        chave: indiceNota + 1,
        indiceNota,
        produto,
        produtoNovo: produto ? undefined : {
          nome: linha.descricaoNota.slice(0, 150),
          categoriaId: "",
          usarPrecoDaNota: Number(linha.valorTotalItemNota) > 0,
          custo: "",
          preco: "",
        },
        descricaoNota: linha.descricaoNota,
        quantidade: "",
        fatorEmbalagem: sugerirFator(linha),
        codigoLote: "",
        validadeEm: "",
      };
    });
  });
  const [buscando, setBuscando] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erroBusca, setErroBusca] = useState("");
  const [erro, setErro] = useState("");
  const [aviso, setAviso] = useState("");

  function voltarAoLogin() {
    sessionStorage.removeItem("gestao.accessToken");
    sessionStorage.removeItem("gestao.usuario");
    router.replace("/");
  }

  async function buscar(pagina = 1) {
    const token = sessionStorage.getItem("gestao.accessToken");
    if (!token) {
      voltarAoLogin();
      return;
    }

    setBuscando(true);
    setErroBusca("");
    try {
      const parametros = new URLSearchParams({
        pagina: String(pagina),
        limite: "10",
        ativo: "true",
      });
      if (busca.trim()) parametros.set("busca", busca.trim());

      const resposta = await fetch(`${apiUrl}/produtos?${parametros}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      if (resposta.status === 401) {
        voltarAoLogin();
        return;
      }

      const dados = await resposta.json();
      if (!resposta.ok || !Array.isArray(dados?.dados)) {
        setErroBusca(mensagemDaApi(dados, "Não foi possível buscar produtos."));
        return;
      }

      setCatalogo({ dados: dados.dados, totalPaginas: dados.totalPaginas, pagina });
    } catch {
      setErroBusca("Não foi possível buscar produtos. Tente novamente.");
    } finally {
      setBuscando(false);
    }
  }

  function adicionar(produto?: Produto) {
    const indice = nota && indiceNota !== "" ? Number(indiceNota) : undefined;
    const linha = indice === undefined ? undefined : nota?.itens[indice];
    if ((nota && !linha) || (!produto && !linha)) return;

    const chave = ++proximaChave.current;
    setItens((atuais) => {
      const novoItem: Item = {
        chave,
        produto,
        produtoNovo: !produto && linha ? {
          nome: linha.descricaoNota.slice(0, 150),
          categoriaId: "",
          usarPrecoDaNota: Number(linha.valorTotalItemNota) > 0,
          custo: "",
          preco: "",
        } : undefined,
        indiceNota: indice,
        descricaoNota: linha?.descricaoNota ?? produto?.nome ?? "",
        quantidade: linha ? "" : "1",
        fatorEmbalagem: linha ? sugerirFator(linha) : "",
        codigoLote: "",
        validadeEm: "",
      };

      if (indice !== undefined) {
        const existente = atuais.find(
          (item) => item.indiceNota === indice,
        );

        if (existente) {
          return atuais.map((item) =>
            item.indiceNota === indice
              ? {
                  ...novoItem,
                  chave: item.chave,
                  fatorEmbalagem: item.fatorEmbalagem,
                  codigoLote: item.codigoLote,
                  validadeEm: item.validadeEm,
                }
              : item,
          );
        }
      }

      return [...atuais, novoItem];
    });
    if (nota) {
      setIndiceNota("");
      setBusca("");
      setCatalogo(null);
    }
    setAviso("");
  }

  function atualizar(chave: number, campo: CampoItem, valor: string) {
    setItens((atuais) => atuais.map((item) =>
      item.chave === chave ? { ...item, [campo]: valor } : item,
    ));
  }

  function atualizarNovo<Campo extends keyof ProdutoNovo>(
    chave: number, campo: Campo, valor: ProdutoNovo[Campo],
  ) {
    setItens((atuais) => atuais.map((item) =>
      item.chave === chave && item.produtoNovo
        ? { ...item, produtoNovo: { ...item.produtoNovo, [campo]: valor } }
        : item,
    ));
  }

  async function confirmar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    if (salvando || itens.length === 0) return;

    if (
      nota &&
      (
        (nota.aptoParaConfirmacaoAutomatica === false && !notaOcrRevisada(nota)) ||
        nota.itens.some((linha) => linha.valoresConferem === false)
      )
    ) {
      setErro(
        "Esta nota possui pendencias de OCR. " +
        "Aguarde a revisao fiscal antes de confirmar.",
      );
      return;
    }

    const itensAgente = nota ? itens.map((item) => montarItemAgente(item, nota, unidades, categorias)) : [];
    if (nota && (!notaId || itensAgente.length !== nota.itens.length || itensAgente.includes(null))) {
      setErro("Confira todos os itens, suas unidades e as quantidades antes de confirmar.");
      return;
    }
    const rota = nota
      ? "/recebimentos-compra/notas-pendentes/" + encodeURIComponent(notaId ?? "") + "/confirmar"
      : "/recebimentos-compra/confirmar";

    const token = sessionStorage.getItem("gestao.accessToken");
    if (!token) {
      voltarAoLogin();
      return;
    }

    const formulario = evento.currentTarget;
    const campos = new FormData(formulario);
    const ler = (nome: string) => String(campos.get(nome) ?? "").trim();
    const emitidaEm = ler("emitidaEm");
    const compradaEm = ler("compradaEm");

    setErro("");
    setAviso("");
    setSalvando(true);
    try {
      const resposta = await fetch(`${apiUrl}${rota}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(nota ? { itens: itensAgente } : {
          fornecedorNome: ler("fornecedorNome"),
          fornecedorCnpj: ler("fornecedorCnpj"),
          serieNota: ler("serieNota"),
          numeroNota: ler("numeroNota"),
          ...(emitidaEm ? { emitidaEm } : {}),
          ...(compradaEm ? { compradaEm } : {}),
          itens: itens.map((item) => ({
            produtoId: item.produto?.id,
            descricaoNota: item.descricaoNota.trim(),
            quantidadeRecebida: Number(item.quantidade),
            ...(item.codigoLote.trim() ? { codigoLote: item.codigoLote.trim() } : {}),
            ...(item.validadeEm ? { validadeEm: item.validadeEm } : {}),
          })),
        }),
      });

      if (resposta.status === 401) {
        voltarAoLogin();
        return;
      }

      if (!resposta.ok) {
        const dados: unknown = await resposta.json().catch(() => null);
        setErro(mensagemDaApi(dados, "Não foi possível confirmar o recebimento."));
        return;
      }

      formulario.reset();
      setItens([]);
      setBusca("");
      setCatalogo(null);
      setErroBusca("");
      setAviso("Recebimento confirmado e estoque atualizado.");
      aoConfirmar?.();
    } catch {
      setErro("Não foi possível confirmar a resposta. Consulte o histórico antes de reenviar.");
      if (!nota) aoConfirmar?.();
    } finally {
      setSalvando(false);
    }
  }

  const titulo = nota ? "titulo-conferencia-agente" : "titulo-entrada";

  return (
    <section className={styles.cartao} style={{ marginBottom: "1rem" }} aria-labelledby={titulo}>
      <h2 id={titulo}>{nota ? "Conferência da nota " + nota.numeroNota : "Registrar recebimento manual"}</h2>
      {nota && (
        <p>Confira os vínculos, os fatores e os totais de todos os itens antes de registrar a entrada.</p>
      )}

      {nota && (
        (nota.aptoParaConfirmacaoAutomatica === false && !notaOcrRevisada(nota)) ||
        nota.itens.some((linha) => linha.valoresConferem === false)
      ) && (
        <div role="alert">
          <p>
            Esta nota foi identificada pelo OCR e possui
            pendencias fiscais. A confirmacao permanece
            bloqueada ate a revisao dos dados.
          </p>
          {Boolean(nota.avisos?.length) && (
            <ul>
              {nota.avisos?.map((mensagem, indice) => (
                <li key={indice}>{mensagem}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      <form onSubmit={confirmar}>
        <fieldset className={styles.campos} disabled={salvando}>
          <legend className={styles.legenda}>Dados da nota</legend>
          <div className={styles.grade}>
            {camposNota.map((campo) => (
              <label className={styles.campo} key={campo.nome}>
                {campo.rotulo}
                <input
                  name={campo.nome}
                  defaultValue={nota?.[campo.nome] ?? ""}
                  readOnly={Boolean(nota)}
                  type={campo.tipo}
                  maxLength={"max" in campo ? campo.max : undefined}
                  required={campo.obrigatorio}
                  inputMode={campo.nome === "serieNota" || campo.nome === "numeroNota" ? "numeric" : undefined}
                  pattern={campo.nome === "serieNota" || campo.nome === "numeroNota" ? "[0-9]+" : undefined}
                />
              </label>
            ))}
          </div>

          <section className={styles.grupo}>
            <h3>Produtos recebidos</h3>
            {nota && (
              <label className={styles.campo}>
                Item da nota a vincular
                <select
                  value={indiceNota}
                  onChange={(evento) => setIndiceNota(evento.target.value)}
                >
                  <option value="">Selecione um dos {nota.itens.length} itens</option>
                  {nota.itens.map((linha, indice) => (
                    <option key={indice} value={indice}>
                      {indice + 1}. {linha.descricaoNota} · {linha.quantidadeNota} {linha.unidadeNota}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {nota && (
              <button type="button" className={styles.secundario}
                disabled={indiceNota === ""}
                onClick={() => adicionar()}>
                Cadastrar novo produto para este item
              </button>
            )}
            <label className={styles.campo}>
              Buscar produto por nome ou SKU
              <input
                value={busca}
                disabled={buscando}
                onChange={(evento) => {
                  setBusca(evento.target.value);
                  setCatalogo(null);
                  setErroBusca("");
                }}
                onKeyDown={(evento) => {
                  if (evento.key === "Enter") {
                    evento.preventDefault();
                    if (!buscando) void buscar();
                  }
                }}
              />
            </label>
            <div className={styles.acoes}>
              <button type="button" className={styles.secundario} disabled={buscando}
                onClick={() => void buscar()}>
                {buscando ? "Buscando…" : "Buscar produtos"}
              </button>
            </div>
            {erroBusca && <p role="alert">{erroBusca}</p>}
            {catalogo && (
              <>
                {catalogo.dados.length === 0 ? <p>Nenhum produto ativo encontrado.</p> : (
                  <ul>
                    {catalogo.dados.map((produto) => (
                      <li key={produto.id}>
                        <button type="button" className={styles.secundario}
                          disabled={buscando || itens.length >= 100 || (Boolean(nota) && indiceNota === "")}
                          onClick={() => adicionar(produto)}>
                          {nota ? "Vincular" : "Adicionar"} {produto.nome} · {produto.sku}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {catalogo.totalPaginas > 1 && (
                  <div className={styles.acoes}>
                    <button type="button" className={styles.secundario}
                      disabled={buscando || catalogo.pagina <= 1}
                      onClick={() => void buscar(catalogo.pagina - 1)}>Anterior</button>
                    <span>Página {catalogo.pagina} de {catalogo.totalPaginas}</span>
                    <button type="button" className={styles.secundario}
                      disabled={buscando || catalogo.pagina >= catalogo.totalPaginas}
                      onClick={() => void buscar(catalogo.pagina + 1)}>Próxima</button>
                  </div>
                )}
              </>
            )}
            {nota ? (
              <p role="status">{itens.length} de {nota.itens.length} itens vinculados para conferência.</p>
            ) : itens.length === 0 && <p>Busque e adicione pelo menos um produto para confirmar.</p>}
            {itens.map((item) => {
              const linha = nota && item.indiceNota !== undefined ? nota.itens[item.indiceNota] : undefined;
              const unidade = linha ? unidadeParaEntrada(item, linha, unidades) : null;
              const calculado = linha && unidade &&
                typeof linha.unidadeNota === "string" &&
                linha.unidadeNota.trim() ? calcularQuantidadeNota(
                linha.quantidadeNota,
                linha.unidadeNota,
                unidade.codigo,
                usaEmbalagem(linha.unidadeNota) ? Number(item.fatorEmbalagem) : undefined,
              ) : null;
              const precificacao = item.produtoNovo && linha && calculado !== null
                ? preverPreco(item.produtoNovo, linha, calculado, categorias)
                : null;
              return (
              <fieldset key={item.chave} className={`${styles.campos} ${styles.grupo}`}>
                <legend>
                  {item.produtoNovo ? "Novo produto" : item.produto?.nome}
                  {item.produto && " · " + item.produto.sku}
                </legend>
                {nota && !item.produtoNovo && !unidade && (
                  <p role="alert">Cadastre a unidade de estoque do produto antes de confirmar.</p>
                )}
                {nota && unidade && calculado === null && (
                  <p role="alert">Confira a unidade de estoque e o fator de embalagem.</p>
                )}
                {nota && item.indiceNota !== undefined && (
                  <p>
                    Na nota: {nota.itens[item.indiceNota].quantidadeNota}{" "}
                    {nota.itens[item.indiceNota].unidadeNota}
                  </p>
                )}
                {item.produtoNovo && (
                  <div className={styles.grade}>
                    <label className={styles.campo}>
                      Nome do produto
                      <input required maxLength={150} value={item.produtoNovo.nome}
                        onChange={(evento) => atualizarNovo(item.chave, "nome", evento.target.value)} />
                    </label>
                    <div className={styles.campo}>
                      <strong>SKU interno</strong>
                      <small>Gerado automaticamente na confirmação do recebimento.</small>
                    </div>
                    <label className={styles.campo}>
                      Unidade de estoque
                      <input readOnly value={unidade?.codigo ?? ""} />
                      <small>{unidade?.existente
                        ? "Unidade já cadastrada na empresa."
                        : "A unidade será cadastrada na confirmação."}</small>
                    </label>
                    <label className={styles.campo}>
                      Categoria
                      <select value={item.produtoNovo.categoriaId}
                        onChange={(evento) => atualizarNovo(item.chave, "categoriaId", evento.target.value)}>
                        <option value="">Sem categoria · 43% padrão</option>
                        {categorias.map(({ id, nome, percentualAcrescimo }) => (
                          <option key={id} value={id}>
                            {nome} · {formatoPercentual.format(Number(percentualAcrescimo ?? 43))}%
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      <input type="checkbox" checked={item.produtoNovo.usarPrecoDaNota}
                        onChange={(evento) => atualizarNovo(item.chave, "usarPrecoDaNota", evento.target.checked)} />
                      Usar valores da nota
                    </label>
                    {linha?.valorUnitarioNota && linha?.valorTotalItemNota && (
                      <p>
                        Na nota: {formatoMoeda.format(Number(linha.valorUnitarioNota))} por {linha.unidadeNota}.
                        Total da linha: {formatoMoeda.format(Number(linha.valorTotalItemNota))}.
                      </p>
                    )}
                    {item.produtoNovo.usarPrecoDaNota ? (
                      <>
                        <label className={styles.campo}>
                          Custo por unidade de estoque
                          <input readOnly value={precificacao ? formatoMoeda.format(precificacao.custo) : "—"} />
                        </label>
                        <label className={styles.campo}>
                          Preço de venda por unidade de estoque
                          <input readOnly value={precificacao ? formatoMoeda.format(precificacao.preco) : "—"} />
                        </label>
                        <p role="status">{precificacao
                          ? "Acréscimo sobre o custo: " + formatoPercentual.format(precificacao.percentual) + "%."
                          : "Confira o valor da linha e a quantidade para calcular o preço."}</p>
                      </>
                    ) : (
                      <>
                        <label className={styles.campo}>
                          Custo por unidade de estoque
                          <input required type="number" min="0" max="9999999999.99" step="0.01"
                            value={item.produtoNovo.custo}
                            onChange={(evento) => atualizarNovo(item.chave, "custo", evento.target.value)} />
                        </label>
                        <label className={styles.campo}>
                          Preço de venda por unidade de estoque
                          <input required type="number" min="0" max="9999999999.99" step="0.01"
                            value={item.produtoNovo.preco}
                            onChange={(evento) => atualizarNovo(item.chave, "preco", evento.target.value)} />
                        </label>
                      </>
                    )}
                  </div>
                )}
                <div className={styles.grade}>
                  <label className={styles.campo}>
                    Descrição na nota
                    <input required maxLength={250} readOnly={Boolean(nota)} value={item.descricaoNota}
                      onChange={(evento) => atualizar(item.chave, "descricaoNota", evento.target.value)} />
                  </label>
                  {linha && usaEmbalagem(linha.unidadeNota) && (
                    <label className={styles.campo}>
                      Unidades por embalagem
                      <input required type="number" min="1" max="9007199254740991" step="1"
                        value={item.fatorEmbalagem}
                        onChange={(evento) => atualizar(item.chave, "fatorEmbalagem", evento.target.value)} />
                    </label>
                  )}
                  {nota ? (
                    <label className={styles.campo}>
                      Quantidade calculada para o estoque
                      <input readOnly value={calculado === null || !unidade ? "—" :
                        new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 3 }).format(calculado)
                          + " " + unidade.codigo} />
                    </label>
                  ) : (
                    <label className={styles.campo}>
                      Quantidade recebida
                      <input required type="number" min="0.001" max="99999999999.999" step="0.001"
                        value={item.quantidade}
                        onChange={(evento) => atualizar(item.chave, "quantidade", evento.target.value)} />
                    </label>
                  )}
                  <label className={styles.campo}>
                    Código do lote
                    <input maxLength={100} value={item.codigoLote}
                      onChange={(evento) => atualizar(item.chave, "codigoLote", evento.target.value)} />
                  </label>
                  <label className={styles.campo}>
                    Validade
                    <input type="date" value={item.validadeEm}
                      onChange={(evento) => atualizar(item.chave, "validadeEm", evento.target.value)} />
                  </label>
                </div>
                <div className={styles.acoes}>
                  <button type="button" className={styles.secundario}
                    onClick={() => setItens((atuais) => atuais.filter((outro) => outro.chave !== item.chave))}>
                    Remover item
                  </button>
                </div>
              </fieldset>
              );
            })}
          </section>

          <div className={styles.acoes}>
            {nota && (
              <button type="button" className={styles.secundario} onClick={aoFechar}>
                Fechar conferência
              </button>
            )}
            <button type="submit" className={styles.primario}
              disabled={salvando || itens.length === 0 || Boolean(nota && (
                (nota.aptoParaConfirmacaoAutomatica === false && !notaOcrRevisada(nota)) ||
                itens.length !== nota.itens.length ||
                itens.some((item) => montarItemAgente(item, nota, unidades, categorias) === null)
              ))}>
              {salvando ? "Confirmando…" : "Confirmar entrada no estoque"}
            </button>
          </div>
        </fieldset>
      </form>

      {erro && <p role="alert" className={styles.erro}>{erro}</p>}
      {aviso && <p role="status" className={styles.aviso}>{aviso}</p>}
    </section>
  );
}
