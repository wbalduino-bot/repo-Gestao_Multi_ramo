/** A interface solicita uma autorizacao adicional apenas de perfis operacionais.
 * A API consulta o perfil atual no banco e e a autoridade definitiva.
 */
export function exigeSenhaParaDesconto(perfil: string | null): boolean {
  return perfil !== 'ADMINISTRADOR' && perfil !== 'GERENTE';
}

/** Persistencia da tentativa de venda; nao guarda token nem concede autorizacao. */
export type PedidoVenda = {
  formaPagamento: 'DINHEIRO' | 'PIX' | 'CARTAO_DEBITO' | 'CARTAO_CREDITO' | 'OUTRO';
  valorRecebido?: number;
  percentualDesconto?: number;
  autorizadorEmail?: string;
  itens: Array<{ produtoId: string; quantidade: number }>;
};
export type IdentidadeVenda = { empresaId: string; usuarioId: string };
export type OperacaoPendente = {
  versao: 1;
  empresaId: string;
  usuarioId: string;
  chaveOperacao: string;
  estado: 'INCERTA' | 'REJEITADA';
  pedido: PedidoVenda;
};
type Armazenamento = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const FORMAS = new Set(['DINHEIRO', 'PIX', 'CARTAO_DEBITO', 'CARTAO_CREDITO', 'OUTRO']);

function objeto(x: unknown): x is Record<string, unknown> { return !!x && typeof x === 'object' && !Array.isArray(x); }
function uuid(x: unknown): x is string { return typeof x === 'string' && UUID.test(x); }

/** Claims usadas apenas para separar o cache. JWT e permissoes sao validados na API. */
export function identidadeVenda(token: string): IdentidadeVenda {
  try {
    const parte = token.split('.')[1];
    if (!parte) throw new Error();
    const b64 = parte.replace(/-/g, '+').replace(/_/g, '/');
    const dados: unknown = JSON.parse(atob(b64.padEnd(Math.ceil(b64.length / 4) * 4, '=')));
    if (!objeto(dados) || !uuid(dados.empresaId) || !uuid(dados.sub)) throw new Error();
    return { empresaId: dados.empresaId.toLowerCase(), usuarioId: dados.sub.toLowerCase() };
  } catch { throw new Error('Sessao invalida. Entre novamente antes de registrar uma venda.'); }
}

export function chaveCacheVenda(id: IdentidadeVenda) {
  if (!uuid(id.empresaId) || !uuid(id.usuarioId)) throw new Error('Identidade da venda invalida.');
  return `gestao.venda.pendente.v1.${id.empresaId.toLowerCase()}.${id.usuarioId.toLowerCase()}`;
}

function validarPedido(valor: unknown): PedidoVenda {
  if (!objeto(valor) || typeof valor.formaPagamento !== 'string' || !FORMAS.has(valor.formaPagamento) ||
      !Array.isArray(valor.itens) || valor.itens.length < 1 || valor.itens.length > 100 ||
      Object.keys(valor).some(k => !['formaPagamento', 'valorRecebido', 'percentualDesconto', 'autorizadorEmail', 'itens'].includes(k))) {
    throw new Error('Pedido pendente invalido. Consulte o historico antes de continuar.');
  }
  const ids = new Set<string>();
  const itens = valor.itens.map((i: unknown) => {
    if (!objeto(i) || !uuid(i.produtoId) || typeof i.quantidade !== 'number' ||
        !Number.isFinite(i.quantidade) || i.quantidade <= 0 ||
        !/^\d{1,11}(?:\.\d{1,3})?$/.test(String(i.quantidade)) ||
        Object.keys(i).some(k => !['produtoId', 'quantidade'].includes(k))) throw new Error('Item pendente invalido.');
    const produtoId = i.produtoId.toLowerCase();
    if (ids.has(produtoId)) throw new Error('Produto repetido na operacao pendente.');
    ids.add(produtoId);
    return { produtoId, quantidade: i.quantidade };
  });
  const pedido: PedidoVenda = { formaPagamento: valor.formaPagamento as PedidoVenda['formaPagamento'], itens };
  if (valor.valorRecebido !== undefined) {
    if (pedido.formaPagamento !== 'DINHEIRO' || typeof valor.valorRecebido !== 'number' ||
        !Number.isFinite(valor.valorRecebido) || valor.valorRecebido < 0 ||
        !/^\d{1,12}(?:\.\d{1,2})?$/.test(String(valor.valorRecebido))) throw new Error('Recebimento pendente invalido.');
    pedido.valorRecebido = valor.valorRecebido;
  }
  if (valor.percentualDesconto !== undefined) {
    if (typeof valor.percentualDesconto !== 'number' || !Number.isFinite(valor.percentualDesconto) ||
        valor.percentualDesconto <= 0 || valor.percentualDesconto > 5 ||
        !/^\d(?:\.\d{1,2})?$/.test(String(valor.percentualDesconto)) ||
        (valor.autorizadorEmail !== undefined &&
          (typeof valor.autorizadorEmail !== 'string' || valor.autorizadorEmail.length > 254 ||
           !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(valor.autorizadorEmail)))) {
      throw new Error('Desconto pendente invalido.');
    }
    pedido.percentualDesconto = valor.percentualDesconto;
    if (typeof valor.autorizadorEmail === 'string') {
      pedido.autorizadorEmail = valor.autorizadorEmail.trim().toLowerCase();
    }
  } else if (valor.autorizadorEmail !== undefined) {
    throw new Error('Autorizador sem desconto no pedido pendente.');
  }
  return pedido;
}

export function lerOperacaoVenda(storage: Armazenamento, id: IdentidadeVenda): OperacaoPendente | null {
  const texto = storage.getItem(chaveCacheVenda(id));
  if (texto === null) return null;
  try {
    if (texto.length > 65536) throw new Error();
    const x: unknown = JSON.parse(texto);
    if (!objeto(x) || x.versao !== 1 || x.empresaId !== id.empresaId || x.usuarioId !== id.usuarioId ||
        !uuid(x.chaveOperacao) || !['INCERTA', 'REJEITADA'].includes(String(x.estado))) throw new Error();
    return { versao: 1, ...id, chaveOperacao: x.chaveOperacao.toLowerCase(),
      estado: x.estado as OperacaoPendente['estado'], pedido: validarPedido(x.pedido) };
  } catch { throw new Error('Existe uma tentativa de venda invalida no navegador. Nao descarte os dados; consulte o historico para reconciliar a compra.'); }
}

export function prepararEnvioVenda(
  storage: Armazenamento, id: IdentidadeVenda, pedido: PedidoVenda,
  gerarChave: () => string = () => crypto.randomUUID(),
): OperacaoPendente {
  const anterior = lerOperacaoVenda(storage, id);
  if (anterior?.estado === 'INCERTA') throw new Error('Consulte ou repita a confirmacao pendente antes de iniciar outra venda.');
  const operacao: OperacaoPendente = { versao: 1, ...id,
    chaveOperacao: anterior?.chaveOperacao ?? gerarChave(), estado: 'INCERTA', pedido: validarPedido(pedido) };
  if (!uuid(operacao.chaveOperacao)) throw new Error('Nao foi possivel identificar a venda.');
  // Esta escrita precisa funcionar ANTES do POST. Se falhar, a venda nao e enviada.
  storage.setItem(chaveCacheVenda(id), JSON.stringify(operacao));
  return operacao;
}

function exigirMesmaOperacao(storage: Armazenamento, id: IdentidadeVenda, op: OperacaoPendente) {
  const atual = lerOperacaoVenda(storage, id);
  if (!atual || atual.chaveOperacao !== op.chaveOperacao || JSON.stringify(atual.pedido) !== JSON.stringify(op.pedido)) {
    throw new Error('A tentativa mudou no navegador. Consulte o resultado antes de continuar.');
  }
  return atual;
}

export function repetirEnvioVenda(storage: Armazenamento, id: IdentidadeVenda, op: OperacaoPendente) {
  const atual = exigirMesmaOperacao(storage, id, op);
  const envio: OperacaoPendente = { ...atual, estado: 'INCERTA' };
  storage.setItem(chaveCacheVenda(id), JSON.stringify(envio));
  return envio;
}

export function rejeitarEnvioVenda(storage: Armazenamento, id: IdentidadeVenda, op: OperacaoPendente) {
  const atual = exigirMesmaOperacao(storage, id, op);
  const rejeitada: OperacaoPendente = { ...atual, estado: 'REJEITADA' };
  storage.setItem(chaveCacheVenda(id), JSON.stringify(rejeitada));
  // Mesmo apos erro de validacao, corrigir o carrinho reutiliza a chave.
  return rejeitada;
}

export function concluirEnvioVenda(storage: Armazenamento, id: IdentidadeVenda, op: OperacaoPendente) {
  exigirMesmaOperacao(storage, id, op);
  storage.removeItem(chaveCacheVenda(id));
}
