import test from 'node:test';
import assert from 'node:assert/strict';
import {
  identidadeVenda, chaveCacheVenda, lerOperacaoVenda, prepararEnvioVenda,
  repetirEnvioVenda, rejeitarEnvioVenda, concluirEnvioVenda, exigeSenhaParaDesconto,
} from '../app/vendas/operacao-venda.ts';

const id = { empresaId: '11111111-1111-4111-8111-111111111111', usuarioId: '22222222-2222-4222-8222-222222222222' };
const chave = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const pedido = () => ({ formaPagamento: 'PIX', itens: [{ produtoId: '33333333-3333-4333-8333-333333333333', quantidade: 1.25 }] });
function storage() {
  const mapa = new Map();
  return { mapa, getItem: k => mapa.get(k) ?? null, setItem: (k, v) => mapa.set(k, v), removeItem: k => mapa.delete(k) };
}
test('identidade usa somente sub e empresaId, sem salvar token', () => {
  const token = 'header.' + Buffer.from(JSON.stringify({ sub: id.usuarioId, empresaId: id.empresaId })).toString('base64url') + '.assinatura';
  assert.deepEqual(identidadeVenda(token), id);
  assert.throws(() => identidadeVenda('invalido'));
});
test('persiste chave e pedido antes de permitir o envio', () => {
  const s = storage(); const op = prepararEnvioVenda(s, id, pedido(), () => chave);
  assert.equal(op.estado, 'INCERTA'); assert.deepEqual(lerOperacaoVenda(s, id), op);
  assert.equal(JSON.parse(s.getItem(chaveCacheVenda(id))).chaveOperacao, chave);
});
test('recarregar a pagina recupera a mesma chave e o mesmo corpo', () => {
  const s = storage(); const original = prepararEnvioVenda(s, id, pedido(), () => chave);
  const recuperada = lerOperacaoVenda(s, id);
  const repetida = repetirEnvioVenda(s, id, recuperada);
  assert.equal(repetida.chaveOperacao, original.chaveOperacao);
  assert.deepEqual(repetida.pedido, original.pedido);
});
test('nao gera nova operacao enquanto o resultado e incerto', () => {
  const s = storage(); prepararEnvioVenda(s, id, pedido(), () => chave);
  let gerou = false;
  assert.throws(() => prepararEnvioVenda(s, id, pedido(), () => { gerou = true; return chave; }));
  assert.equal(gerou, false);
});
test('correcao apos rejeicao preserva a chave anterior', () => {
  const s = storage(); const op = prepararEnvioVenda(s, id, pedido(), () => chave);
  rejeitarEnvioVenda(s, id, op);
  const corrigido = { ...pedido(), itens: [{ ...pedido().itens[0], quantidade: 2 }] };
  const nova = prepararEnvioVenda(s, id, corrigido, () => { throw new Error('Nao gerar outra chave'); });
  assert.equal(nova.chaveOperacao, chave); assert.equal(nova.pedido.itens[0].quantidade, 2);
});
test('so limpa a operacao correspondente apos resultado confirmado', () => {
  const s = storage(); const op = prepararEnvioVenda(s, id, pedido(), () => chave);
  assert.throws(() => concluirEnvioVenda(s, id, { ...op, chaveOperacao: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }));
  assert.notEqual(lerOperacaoVenda(s, id), null);
  concluirEnvioVenda(s, id, op); assert.equal(lerOperacaoVenda(s, id), null);
});
test('separa o cache de outros usuarios e empresas', () => {
  const s = storage(); prepararEnvioVenda(s, id, pedido(), () => chave);
  assert.equal(lerOperacaoVenda(s, { ...id, usuarioId: '44444444-4444-4444-8444-444444444444' }), null);
  assert.equal(lerOperacaoVenda(s, { ...id, empresaId: '55555555-5555-4555-8555-555555555555' }), null);
});
test('conteudo corrompido bloqueia e nao e apagado automaticamente', () => {
  const s = storage(); s.setItem(chaveCacheVenda(id), '{invalido');
  assert.throws(() => lerOperacaoVenda(s, id)); assert.equal(s.getItem(chaveCacheVenda(id)), '{invalido');
});
test('falha ao persistir impede preparar o envio', () => {
  const s = storage(); s.setItem = () => { throw new Error('Sem armazenamento'); };
  assert.throws(() => prepararEnvioVenda(s, id, pedido(), () => chave));
});
test('rejeita pedido invalido sem salvar', () => {
  for (const quantidade of [0, -1, 1.2345, Infinity, NaN]) {
    const s = storage(); assert.throws(() => prepararEnvioVenda(s, id, { ...pedido(), itens: [{ ...pedido().itens[0], quantidade }] }, () => chave));
    assert.equal(s.getItem(chaveCacheVenda(id)), null);
  }
});
test('forma e valor recebido permanecem identicos no reenvio', () => {
  const s = storage(); const dinheiro = { ...pedido(), formaPagamento: 'DINHEIRO', valorRecebido: 100.10 };
  const op = prepararEnvioVenda(s, id, dinheiro, () => chave);
  assert.deepEqual(repetirEnvioVenda(s, id, op).pedido, dinheiro);
});

test('desconto fica pendente sem persistir senha administrativa', () => {
  const s = storage();
  const autorizado = { ...pedido(), percentualDesconto: 5,
    autorizadorEmail: 'admin@empresa.com' };
  const op = prepararEnvioVenda(s, id, autorizado, () => chave);
  assert.equal(op.pedido.percentualDesconto, 5);
  assert.equal(op.pedido.autorizadorEmail, 'admin@empresa.com');
  assert.ok(!s.getItem(chaveCacheVenda(id)).includes('senhaAutorizador'));
  assert.deepEqual(repetirEnvioVenda(s, id, op).pedido, autorizado);
});
test('desconto maior que cinco ou senha persistida e rejeitado', () => {
  for (const invalido of [
    { ...pedido(), percentualDesconto: 5.01, autorizadorEmail: 'admin@empresa.com' },
    { ...pedido(), percentualDesconto: 3, autorizadorEmail: 'admin@empresa.com', senhaAutorizador: 'segredo' },
  ]) {
    const s = storage();
    assert.throws(() => prepararEnvioVenda(s, id, invalido, () => chave));
    assert.equal(s.getItem(chaveCacheVenda(id)), null);
  }
});

test('ADMINISTRADOR e GERENTE nao precisam senha adicional; operacionais precisam', () => {
  assert.equal(exigeSenhaParaDesconto('ADMINISTRADOR'), false);
  assert.equal(exigeSenhaParaDesconto('GERENTE'), false);
  for (const perfil of ['ATENDENTE', 'CAIXA', 'GARCOM', null]) {
    assert.equal(exigeSenhaParaDesconto(perfil), true);
  }
});
test('venda gerencial com desconto preserva percentual sem autorizador ou senha', () => {
  const s = storage();
  const op = prepararEnvioVenda(s, id, { ...pedido(), percentualDesconto: 5 }, () => chave);
  assert.deepEqual(op.pedido, { ...pedido(), percentualDesconto: 5 });
  assert.ok(!s.getItem(chaveCacheVenda(id)).includes('senhaAutorizador'));
  assert.ok(!s.getItem(chaveCacheVenda(id)).includes('autorizadorEmail'));
  assert.deepEqual(repetirEnvioVenda(s,id,op).pedido,op.pedido);
});
