import { ResultadoAuditoria, TipoAtorAuditoria, type Prisma } from '@prisma/client';
import type { AuditoriaService } from '../auditoria/auditoria.service.js';
import type { CriarUnidadeDto } from './dto/criar-unidade.dto.js';

export async function criarUnidadeNaTransacao(
  tx: Prisma.TransactionClient,
  auditoria: AuditoriaService,
  empresaId: string,
  atorId: string,
  dto: CriarUnidadeDto,
) {
  const unidade = await tx.unidade.create({
    data: { empresaId, codigo: dto.codigo, nome: dto.nome },
    select: { id: true, codigo: true, nome: true },
  });
  await auditoria.registrar({
    empresaId,
    atorId,
    tipoAtor: TipoAtorAuditoria.USUARIO_EMPRESA,
    modulo: 'UNIDADES',
    acao: 'CRIAR',
    entidade: 'UNIDADE',
    entidadeId: unidade.id,
    resultado: ResultadoAuditoria.SUCESSO,
    dadosPosteriores: { codigo: unidade.codigo, nome: unidade.nome },
  }, tx);
  return unidade;
}
