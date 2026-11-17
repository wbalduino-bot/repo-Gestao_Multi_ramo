import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { PrismaService } from '../prisma/prisma.service.js';

type EntradaOperacaoVenda = {
  chaveOperacao?: string;
  formaPagamento: string;
  valorRecebido?: number;
  percentualDesconto?: number;
  autorizadorEmail?: string;
  itens: Array<{ produtoId: string; quantidade: number }>;
};

export type OperacaoVenda = { chave: string; hash: string };
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const PAGAMENTOS = new Set(['DINHEIRO', 'PIX', 'CARTAO_DEBITO', 'CARTAO_CREDITO', 'OUTRO']);

/** Hash dos dados enviados, sem precos que possam mudar apos a primeira venda. */
export function prepararOperacaoVenda(dto: EntradaOperacaoVenda): OperacaoVenda | undefined {
  // Compatibilidade com integracoes anteriores. A tela nova sempre devera enviar a chave.
  if (dto.chaveOperacao === undefined) return undefined;
  if (typeof dto.chaveOperacao !== 'string' || !UUID.test(dto.chaveOperacao) ||
      !PAGAMENTOS.has(dto.formaPagamento) || !Array.isArray(dto.itens) || dto.itens.length === 0) {
    throw new BadRequestException('Informe uma chave de operacao e uma venda validas.');
  }
  if (dto.valorRecebido !== undefined &&
      (dto.formaPagamento !== 'DINHEIRO' || typeof dto.valorRecebido !== 'number' ||
       !Number.isFinite(dto.valorRecebido) || dto.valorRecebido < 0 ||
       !/^\d{1,12}(?:\.\d{1,2})?$/.test(String(dto.valorRecebido)))) {
    throw new BadRequestException('Valor recebido invalido para esta operacao.');
  }
  const percentual = dto.percentualDesconto ?? 0;
  if (!Number.isFinite(percentual) || percentual < 0 || percentual > 5 ||
      !/^\d(?:\.\d{1,2})?$/.test(String(percentual)) ||
      (percentual > 0 && dto.autorizadorEmail !== undefined &&
        (typeof dto.autorizadorEmail !== 'string' || !dto.autorizadorEmail.trim())) ||
      (percentual === 0 && dto.autorizadorEmail !== undefined)) {
    throw new BadRequestException('Desconto ou autorizador invalido.');
  }
  const emailAutorizador = percentual > 0 && dto.autorizadorEmail !== undefined
    ? dto.autorizadorEmail.trim().toLowerCase() : null;
  const ids = new Set<string>();
  const itens = dto.itens.map(item => {
    if (!item || typeof item.produtoId !== 'string' || !UUID.test(item.produtoId) ||
        typeof item.quantidade !== 'number' || !Number.isFinite(item.quantidade) ||
        item.quantidade <= 0 || !/^\d{1,11}(?:\.\d{1,3})?$/.test(String(item.quantidade))) {
      throw new BadRequestException('Itens invalidos para identificar a operacao.');
    }
    const produtoId = item.produtoId.toLowerCase();
    if (ids.has(produtoId)) throw new BadRequestException('Produto repetido na operacao.');
    ids.add(produtoId);
    return { produtoId, quantidade: item.quantidade.toFixed(3) };
  }).sort((a, b) => a.produtoId < b.produtoId ? -1 : a.produtoId > b.produtoId ? 1 : 0);
  // Sem desconto, o hash permanece compativel com operacoes antigas.
  // A senha jamais entra no hash ou na persistencia local da tentativa.
  const canonico = JSON.stringify({ versao: 1, formaPagamento: dto.formaPagamento,
    valorRecebido: dto.valorRecebido === undefined ? null : dto.valorRecebido.toFixed(2), itens,
    ...(percentual > 0 ? { percentualDesconto: percentual.toFixed(2) } : {}),
    ...(emailAutorizador !== null ? { autorizadorEmail: emailAutorizador } : {}),
  });
  return { chave: dto.chaveOperacao.toLowerCase(), hash: createHash('sha256').update(canonico).digest('hex') };
}

/** A consulta e sempre por empresa + chave. Dados gerenciais continuam filtrados no controller. */
export async function consultarVendaDaOperacao(
  prisma: Pick<PrismaService, 'venda' | 'usuario'>,
  empresaId: string, usuarioId: string, operacao: OperacaoVenda, revalidarUsuario = false,
) {
  if (revalidarUsuario) {
    const usuario = await prisma.usuario.findFirst({
      where: { id: usuarioId, empresaId, ativo: true }, select: { id: true },
    });
    if (!usuario) throw new ForbiddenException('Usuario nao esta ativo nesta empresa.');
  }
  const venda = await prisma.venda.findFirst({
    where: { empresaId, chaveOperacao: operacao.chave },
    select: { id: true, usuarioId: true, hashRequisicao: true },
  });
  if (!venda) return null;
  if (venda.usuarioId !== usuarioId || venda.hashRequisicao !== operacao.hash) {
    throw new ConflictException('Esta chave de operacao ja foi utilizada em outra venda. Consulte o historico antes de continuar.');
  }
  return venda.id;
}
