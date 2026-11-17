export type ProdutoCatalogo = {
  id: string; nome: string; sku: string; preco: number | string; ativo: boolean;
  codigoBarras?: string | null;
  unidadeCodigo?: string | null;
  saldoEstoque?: {
    quantidadeDisponivel: number | string; quantidadeReservada: number | string; estoqueMinimo: number | string;
  } | null;
};
export type PaginaCatalogo = {
  dados: ProdutoCatalogo[]; total: number; pagina: number; limite: number; totalPaginas: number;
};
export class ErroCatalogo extends Error {
  status: number;
  constructor(mensagem: string, status = 0) { super(mensagem); this.status = status; }
}
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const objeto = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
const numero = (x: unknown): x is number | string =>
  (typeof x === 'number' || (typeof x === 'string' && x.trim() !== '')) && Number.isFinite(Number(x));

export function parametrosCatalogo(busca: string, pagina: number) {
  if (!Number.isSafeInteger(pagina) || pagina < 1 || busca.trim().length > 100) throw new ErroCatalogo('Confira a pesquisa e a pagina do catalogo.');
  const p = new URLSearchParams({ pagina: String(pagina), limite: '20', ativo: 'true' });
  if (busca.trim()) p.set('busca', busca.trim());
  return p;
}

function validarProduto(x: unknown): ProdutoCatalogo {
  if (!objeto(x) || typeof x.id !== 'string' || !UUID.test(x.id) || typeof x.nome !== 'string' ||
      !x.nome.trim() || typeof x.sku !== 'string' || typeof x.ativo !== 'boolean' || !numero(x.preco) || Number(x.preco) < 0 ||
      (x.unidadeCodigo != null && typeof x.unidadeCodigo !== 'string') ||
      (x.codigoBarras != null && typeof x.codigoBarras !== 'string')) throw new ErroCatalogo('Produto retornado em formato inesperado.');
  let saldo: ProdutoCatalogo['saldoEstoque'] = null;
  if (x.saldoEstoque != null) {
    if (!objeto(x.saldoEstoque) || !numero(x.saldoEstoque.quantidadeDisponivel) ||
        !numero(x.saldoEstoque.quantidadeReservada) || !numero(x.saldoEstoque.estoqueMinimo)) {
      throw new ErroCatalogo('Saldo retornado em formato inesperado.');
    }
    saldo = { quantidadeDisponivel: x.saldoEstoque.quantidadeDisponivel,
      quantidadeReservada: x.saldoEstoque.quantidadeReservada, estoqueMinimo: x.saldoEstoque.estoqueMinimo };
  }
  return { id: x.id, nome: x.nome, sku: x.sku, ativo: x.ativo, preco: x.preco,
    unidadeCodigo: typeof x.unidadeCodigo === 'string' ? x.unidadeCodigo.trim().toUpperCase() : null,
    codigoBarras: typeof x.codigoBarras === 'string' ? x.codigoBarras : null, saldoEstoque: saldo };
}

async function receber(resposta: Response, sinal: AbortSignal) {
  const dados: unknown = await resposta.json().catch(() => null);
  if (sinal.aborted) throw new DOMException('Consulta cancelada.', 'AbortError');
  if (!resposta.ok) {
    const msg = objeto(dados) && typeof dados.message === 'string' ? dados.message : 'Nao foi possivel consultar os produtos.';
    throw new ErroCatalogo(msg, resposta.status);
  }
  return dados;
}

export async function consultarPaginaCatalogo(
  apiUrl: string, token: string, busca: string, pagina: number, sinal: AbortSignal,
  requisitar: typeof fetch = fetch,
): Promise<PaginaCatalogo> {
  if (sinal.aborted) throw new DOMException('Consulta cancelada.', 'AbortError');
  const p = parametrosCatalogo(busca, pagina);
  const r = await requisitar(`${apiUrl}/produtos?${p}`, {
    headers: { Accept: 'application/json', Authorization: `Bearer ${token}` }, cache: 'no-store', signal: sinal,
  });
  const x = await receber(r, sinal);
  if (!objeto(x) || !Array.isArray(x.dados) || x.dados.length > 20 ||
      typeof x.total !== 'number' || !Number.isSafeInteger(x.total) || x.total < 0 || x.pagina !== pagina ||
      x.limite !== 20 || x.totalPaginas !== Math.ceil(x.total / 20)) throw new ErroCatalogo('Paginacao retornada em formato inesperado.');
  const dados = x.dados.map(validarProduto);
  if (dados.some(p => !p.ativo) || new Set(dados.map(p => p.id)).size !== dados.length) throw new ErroCatalogo('Catalogo retornou produtos inativos ou repetidos.');
  return { dados, total: x.total, pagina, limite: 20, totalPaginas: Math.ceil(x.total / 20) };
}

/** Atualiza apenas os produtos ja selecionados; nao acumula todo o catalogo no carrinho. */
export function atualizarProdutosSelecionados(
  atuais: Record<string, ProdutoCatalogo>, recebidos: ProdutoCatalogo[],
): Record<string, ProdutoCatalogo> {
  const novos = recebidos.filter(p => Object.hasOwn(atuais, p.id));
  if (!novos.length) return atuais;
  const copia = { ...atuais };
  for (const p of novos) copia[p.id] = p;
  return copia;
}

/** Recupera o carrinho por ID, sem depender da pagina ou do termo pesquisado. */
export async function consultarProdutosDoCarrinho(
  apiUrl: string, token: string, ids: string[], sinal: AbortSignal,
  requisitar: typeof fetch = fetch,
): Promise<ProdutoCatalogo[]> {
  const unicos = [...new Set(ids)];
  if (unicos.length > 100 || unicos.some(id => !UUID.test(id))) throw new ErroCatalogo('Identificadores do carrinho invalidos.');
  const produtos: ProdutoCatalogo[] = [];
  for (let inicio = 0; inicio < unicos.length; inicio += 4) {
    if (sinal.aborted) throw new DOMException('Consulta cancelada.', 'AbortError');
    const lote = await Promise.all(unicos.slice(inicio, inicio + 4).map(async id => {
      const resposta = await requisitar(`${apiUrl}/produtos/${encodeURIComponent(id)}`, {
        headers: { Accept: 'application/json', Authorization: `Bearer ${token}` }, cache: 'no-store', signal: sinal,
      });
      const produto = validarProduto(await receber(resposta, sinal));
      if (produto.id.toLowerCase() !== id.toLowerCase()) throw new ErroCatalogo('A consulta retornou outro produto.');
      return produto;
    }));
    produtos.push(...lote);
  }
  if (sinal.aborted) throw new DOMException('Consulta cancelada.', 'AbortError');
  return produtos;
}
