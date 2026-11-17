import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parametrosCatalogo, consultarPaginaCatalogo, atualizarProdutosSelecionados,
  consultarProdutosDoCarrinho, ErroCatalogo,
} from '../app/vendas/catalogo-venda.ts';

const id = n => `11111111-1111-4111-8111-${String(n).padStart(12, '0')}`;
const produto = n => ({ id: id(n), nome: 'Produto ' + n, sku: 'SKU-' + n, preco: '8.00', ativo: true, unidadeCodigo: 'KG',
  codigoBarras: '789' + String(n).padStart(10, '0'),
  saldoEstoque: { quantidadeDisponivel: '10.000', quantidadeReservada: '0', estoqueMinimo: '0' } });
const sinal = () => new AbortController().signal;
const responder = dados => new Response(JSON.stringify(dados), { status: 200, headers: { 'Content-Type': 'application/json' } });

test('consulta produtos ativos, vinte por pagina e termo normalizado no servidor', () => {
  const p = parametrosCatalogo('  tomate  ', 6);
  assert.equal(p.get('ativo'), 'true'); assert.equal(p.get('limite'), '20');
  assert.equal(p.get('pagina'), '6'); assert.equal(p.get('busca'), 'tomate');
  assert.equal(parametrosCatalogo('', 1).has('busca'), false);
  assert.throws(() => parametrosCatalogo('x'.repeat(101), 1));
  assert.throws(() => parametrosCatalogo('tomate', 0));
});
test('busca por codigo de barras nao e filtrada novamente apenas por nome e SKU', async () => {
  let url;
  const resultado = await consultarPaginaCatalogo('http://api', 'token-teste', '7890000000104', 1, sinal(), async (u, opcoes) => {
    url = new URL(u);
    assert.equal(opcoes.headers.Authorization, 'Bearer token-teste');
    assert.equal(opcoes.cache, 'no-store');
    return responder({ dados: [produto(104)], total: 1, pagina: 1, limite: 20, totalPaginas: 1 });
  });
  assert.equal(url.searchParams.get('busca'), '7890000000104');
  assert.equal(resultado.dados[0].id, id(104));
});
test('carrega pagina alem dos cem primeiros produtos', async () => {
  const resultado = await consultarPaginaCatalogo('http://api', 'token', '', 6, sinal(), async u => {
    assert.equal(new URL(u).searchParams.get('pagina'), '6');
    return responder({ dados: [produto(104)], total: 105, pagina: 6, limite: 20, totalPaginas: 6 });
  });
  assert.equal(resultado.total, 105); assert.equal(resultado.dados[0].id, id(104));
});
test('pagina vazia valida mantem zero resultados', async () => {
  const r = await consultarPaginaCatalogo('http://api', 'token', 'inexistente', 1, sinal(), async () =>
    responder({ dados: [], total: 0, pagina: 1, limite: 20, totalPaginas: 0 }));
  assert.equal(r.total, 0); assert.deepEqual(r.dados, []);
});
test('trocar a pagina preserva produtos selecionados fora dos resultados', () => {
  const selecionados = { [id(1)]: produto(1), [id(2)]: produto(2) };
  const atualizados = atualizarProdutosSelecionados(selecionados, [produto(101)]);
  assert.equal(atualizados[id(1)].preco, '8.00'); assert.equal(atualizados[id(2)].preco, '8.00');
  assert.equal(atualizados[id(101)], undefined); assert.equal(Object.keys(atualizados).length, 2);
});
test('resultado novo atualiza saldo e preco de um produto ja selecionado', () => {
  const original = { [id(1)]: produto(1), [id(2)]: produto(2) };
  const novo = { ...produto(1), preco: '9.00', saldoEstoque: { ...produto(1).saldoEstoque, quantidadeDisponivel: '3.500' } };
  const cache = atualizarProdutosSelecionados(original, [novo]);
  assert.equal(cache[id(1)].preco, '9.00'); assert.equal(cache[id(1)].saldoEstoque.quantidadeDisponivel, '3.500');
  assert.deepEqual(cache[id(2)], produto(2)); assert.equal(original[id(1)].preco, '8.00');
});
test('recupera carrinho por ID sem depender de busca ou pagina', async () => {
  const urls = [];
  const r = await consultarProdutosDoCarrinho('http://api', 'token', [id(101), id(102), id(101)], sinal(), async u => {
    urls.push(u); return responder(u.endsWith(id(101)) ? produto(101) : produto(102));
  });
  assert.equal(urls.length, 2); assert(urls.every(u => !u.includes('?')));
  assert.deepEqual(r.map(p => p.id), [id(101), id(102)]); assert.equal(r[0].unidadeCodigo, 'KG');
});
test('limita recuperacao a quatro consultas simultaneas', async () => {
  let emCurso = 0; let maximo = 0;
  const ids = Array.from({ length: 9 }, (_, i) => id(i + 1));
  await consultarProdutosDoCarrinho('http://api', 'token', ids, sinal(), async u => {
    emCurso++; maximo = Math.max(maximo, emCurso);
    await new Promise(resolve => setTimeout(resolve, 2)); emCurso--;
    return responder(produto(Number(u.slice(-12))));
  });
  assert.equal(maximo, 4);
});
test('resposta de busca antiga e descartada quando o sinal foi cancelado', async () => {
  const c = new AbortController();
  await assert.rejects(() => consultarPaginaCatalogo('http://api', 'token', 'antiga', 1, c.signal, async () => {
    c.abort(); return responder({ dados: [produto(1)], total: 1, pagina: 1, limite: 20, totalPaginas: 1 });
  }), e => e.name === 'AbortError');
});
test('falha em recuperar um item nao retorna carrinho parcial', async () => {
  await assert.rejects(() => consultarProdutosDoCarrinho('http://api', 'token', [id(1), id(2)], sinal(), async u =>
    u.endsWith(id(2)) ? new Response(JSON.stringify({ message: 'Produto nao encontrado' }), { status: 404 }) : responder(produto(1))),
  e => e instanceof ErroCatalogo && e.status === 404);
});
test('recusa resposta de outro produto e saldo ilegivel', async () => {
  await assert.rejects(() => consultarProdutosDoCarrinho('http://api', 'token', [id(1)], sinal(), async () => responder(produto(2))), ErroCatalogo);
  await assert.rejects(() => consultarProdutosDoCarrinho('http://api', 'token', [id(1)], sinal(), async () =>
    responder({ ...produto(1), saldoEstoque: { ...produto(1).saldoEstoque, quantidadeDisponivel: 'ilegivel' } })), ErroCatalogo);
});
test('falha de autenticacao e identificada sem gravar ou expor token', async () => {
  await assert.rejects(() => consultarPaginaCatalogo('http://api', 'token', '', 1, sinal(), async () =>
    new Response(JSON.stringify({ message: 'Sessao expirada' }), { status: 401 })), e => e instanceof ErroCatalogo && e.status === 401);
});
