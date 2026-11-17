import test from "node:test";
import assert from "node:assert/strict";
import { alturaPapelMm, cssCupomIsolado } from "../app/vendas/impressao-cupom.ts";

const classes = {
  cabecalho: "cabecalho", marca: "marca", meta: "meta", linha: "linha",
  identificador: "identificador", itens: "itens", item: "item",
  pagamento: "pagamento", total: "total", rodape: "rodape",
};

test("impressao usa largura exata de 58mm ou 80mm", () => {
  const a = cssCupomIsolado(58, classes);
  const b = cssCupomIsolado(80, classes);
  assert.match(a, /width: 58mm !important/);
  assert.match(b, /width: 80mm !important/);
  assert.match(a, /\[class~="linha"\]/);
  assert.throws(() => cssCupomIsolado(90, classes));
});

test("papel ajusta a altura do comprovante sem reduzir conteudo", () => {
  assert.equal(alturaPapelMm(0), 60);
  assert.ok(alturaPapelMm(900) >= 244);
  assert.throws(() => alturaPapelMm(-5));
});
