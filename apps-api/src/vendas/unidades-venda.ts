import { BadRequestException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service.js';

/** Consulta somente unidades referenciadas e pertencentes a empresa. */
export async function consultarUnidadesVenda(
  prisma: Pick<PrismaService, 'unidade'>,
  empresaId: string,
  referencias: Array<string | null | undefined>,
) {
  const ids = [...new Set(referencias.filter((id): id is string => typeof id === 'string' && id.length > 0))];
  if (ids.length === 0) return new Map<string, string>();
  const unidades = await prisma.unidade.findMany({
    where: { empresaId, id: { in: ids } },
    select: { id: true, codigo: true },
  });
  return new Map(unidades.map(u => [u.id, u.codigo.trim().toUpperCase()]));
}

export function validarUnidadeEQuantidadeVenda(
  nome: string,
  unidadeId: string | null | undefined,
  unidades: Map<string, string>,
  quantidade: number,
) {
  if (!Number.isFinite(quantidade) || quantidade <= 0 ||
      !/^\d{1,11}(?:\.\d{1,3})?$/.test(String(quantidade))) {
    throw new BadRequestException('Informe quantidade positiva, com ate tres casas decimais e dentro do limite de estoque.');
  }
  if (unidadeId && !unidades.has(unidadeId)) {
    throw new BadRequestException('Confira a unidade de ' + nome + ' no cadastro desta empresa.');
  }
  const codigo = unidadeId ? unidades.get(unidadeId) : undefined;
  if (codigo === 'UN' && !Number.isInteger(quantidade)) {
    throw new BadRequestException('O produto ' + nome + ' e vendido em UN. Informe uma quantidade inteira.');
  }
  // KG admite 3 casas. Outros codigos mantem a regra anterior de precisao.
  // Ausencia de unidade nao e interpretada como UN nem convertida para KG.
}
