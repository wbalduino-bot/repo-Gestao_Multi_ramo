import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

/**
 * Calcula saldo comercial apos estornos, SEM presumir reembolso financeiro.
 * Nao altera o registro historico da venda.
 */
export function calcularSaldoHistoricoVenda(venda: {
  total: Prisma.Decimal;
  itens: Array<{
    id: string;
    quantidade: Prisma.Decimal;
    subtotal: Prisma.Decimal;
    custoUnitario: Prisma.Decimal | null;
  }>;
  estornos: Array<{
    totalEstornado: Prisma.Decimal;
    itens: Array<{
      itemVendaId: string;
      quantidade: Prisma.Decimal;
      valorEstornado: Prisma.Decimal;
    }>;
  }>;
}) {
  const totalEstornado = venda.estornos.reduce(
    (acumulado, registro) => acumulado.plus(registro.totalEstornado),
    new Prisma.Decimal(0),
  ).toDecimalPlaces(2);

  if (totalEstornado.lt(0) || totalEstornado.gt(venda.total)) {
    throw new ConflictException('Historico de estornos com valor inconsistente.');
  }

  const quantidadesEstornadas = new Map<string, Prisma.Decimal>();
  for (const estorno of venda.estornos) {
    for (const item of estorno.itens) {
      const atual = quantidadesEstornadas.get(item.itemVendaId) ?? new Prisma.Decimal(0);
      quantidadesEstornadas.set(item.itemVendaId, atual.plus(item.quantidade));
    }
  }

  const idsItens = new Set(venda.itens.map((item) => item.id));
  for (const id of quantidadesEstornadas.keys()) {
    if (!idsItens.has(id)) {
      throw new ConflictException('Estorno associado a item de outra venda.');
    }
  }

  const itensLiquidos = venda.itens.map((item) => {
    const quantidadeEstornada = quantidadesEstornadas.get(item.id) ?? new Prisma.Decimal(0);
    const quantidadeRestante = item.quantidade.minus(quantidadeEstornada);
    if (quantidadeEstornada.lt(0) || quantidadeRestante.lt(0)) {
      throw new ConflictException('Historico de estornos com quantidade inconsistente.');
    }
    return { ...item, quantidade: quantidadeRestante };
  });

  return {
    valorEstornado: totalEstornado,
    totalLiquido: venda.total.minus(totalEstornado).toDecimalPlaces(2),
    itensLiquidos,
    quantidadesEstornadas,
  };
}
