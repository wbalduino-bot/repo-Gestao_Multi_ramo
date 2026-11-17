import { ConflictException } from '@nestjs/common';
import { Prisma, type MovimentacaoEstoque } from '@prisma/client';

/** Aplica aos lotes a mesma variação registrada no saldo do produto. */
export async function movimentarLotes(
  transacao: Prisma.TransactionClient,
  movimentacao: Pick<MovimentacaoEstoque, 'id' | 'empresaId' | 'produtoId' | 'criadoEm'>,
  variacao: Prisma.Decimal,
  dadosLote?: { codigoLote: string | null; validadeEm: Date | null },
): Promise<void> {
  const { id: movimentacaoId, empresaId, produtoId, criadoEm } = movimentacao;
  const vinculo = { empresaId, produtoId, movimentacaoId };

  if (variacao.gt(0)) {
    const lote = await transacao.loteEstoque.create({
      data: {
        empresaId,
        produtoId,
        entradaEm: criadoEm,
        codigoLote: dadosLote?.codigoLote ?? null,
        validadeEm: dadosLote?.validadeEm ?? null,
        quantidadeInicial: variacao,
        quantidadeRestante: variacao,
      },
    });

    await transacao.movimentacaoLoteEstoque.create({
      data: { ...vinculo, loteId: lote.id, quantidade: variacao },
    });
    return;
  }

  const lotes = await transacao.loteEstoque.findMany({
    where: { empresaId, produtoId, quantidadeRestante: { gt: 0 } },
    orderBy: [
      { validadeEm: { sort: 'asc', nulls: 'last' } },
      { entradaEm: { sort: 'asc', nulls: 'first' } },
      { id: 'asc' },
    ],
  });

  let restante = variacao.abs();

  for (const lote of lotes) {
    const quantidade = Prisma.Decimal.min(restante, lote.quantidadeRestante);

    await transacao.loteEstoque.update({
      where: { id: lote.id },
      data: { quantidadeRestante: { decrement: quantidade } },
    });
    await transacao.movimentacaoLoteEstoque.create({
      data: { ...vinculo, loteId: lote.id, quantidade },
    });

    restante = restante.minus(quantidade);
    if (restante.isZero()) return;
  }

  throw new ConflictException(
    'O saldo por lote é insuficiente para concluir a movimentação. Confira o estoque do produto.',
  );
}
