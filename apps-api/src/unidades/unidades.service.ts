import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, ResultadoAuditoria, TipoAtorAuditoria } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditoriaService } from '../auditoria/auditoria.service.js';
import { CriarUnidadeDto } from './dto/criar-unidade.dto.js';
import { EditarUnidadeDto } from './dto/editar-unidade.dto.js';

@Injectable()
export class UnidadesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditoria: AuditoriaService,
  ) {}

  /** Consulta apenas unidades da empresa, sem gravar evento a cada abertura. */
  listar(empresaId: string) {
    return this.prisma.unidade.findMany({
      where: { empresaId },
      orderBy: { codigo: 'asc' },
      select: { id: true, codigo: true, nome: true },
    });
  }

  /** A restrição única [empresaId, codigo] impede duplicações concorrentes. */
  async criar(empresaId: string, atorId: string, dto: CriarUnidadeDto) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const unidade = await tx.unidade.create({
          data: { empresaId, codigo: dto.codigo, nome: dto.nome },
          select: { id: true, codigo: true, nome: true },
        });
        await this.auditoria.registrar({
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
      });
    } catch (erro) {
      if (erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === 'P2002') {
        throw new ConflictException('Já existe uma unidade com esse código nesta empresa.');
      }
      throw erro;
    }
  }

  /**
   * Corrige a unidade da empresa autenticada sem alterar saldo ou produtos.
   * Mudança de código é proibida se a unidade já estiver em uso.
   * Auditoria e atualização pertencem à mesma transação.
   */
  async editar(empresaId: string, atorId: string, id: string, dto: EditarUnidadeDto) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const anterior = await tx.unidade.findFirst({
          where: { id, empresaId },
          select: { id: true, codigo: true, nome: true },
        });
        if (!anterior) throw new NotFoundException('Unidade não encontrada.');

        const codigo = dto.codigo ?? anterior.codigo;
        const nome = dto.nome ?? anterior.nome;
        if (codigo === anterior.codigo && nome === anterior.nome) {
          throw new BadRequestException('Nenhuma alteração foi informada.');
        }

        // O campo Produto.unidadeId utiliza a mesma identificação da unidade.
        // Não alteramos sua semântica quando existem produtos que a utilizam.
        if (codigo !== anterior.codigo) {
          const produtosVinculados = await tx.produto.count({
            where: { empresaId, unidadeId: id },
          });
          if (produtosVinculados > 0) {
            throw new ConflictException(
              'Esta unidade está vinculada a produtos. É permitido alterar somente sua descrição.',
            );
          }
        }

        // Impede códigos repetidos na empresa, inclusive antes da restrição SQL.
        if (codigo !== anterior.codigo) {
          const duplicada = await tx.unidade.findFirst({
            where: { empresaId, codigo, id: { not: id } },
            select: { id: true },
          });
          if (duplicada) {
            throw new ConflictException('Já existe uma unidade com esse código nesta empresa.');
          }
        }

        // A condição com empresaId impede atualização fora da empresa autenticada.
        const alteradas = await tx.unidade.updateMany({
          where: { id, empresaId },
          data: { codigo, nome },
        });
        if (alteradas.count !== 1) throw new NotFoundException('Unidade não encontrada.');

        await this.auditoria.registrar({
          empresaId,
          atorId,
          tipoAtor: TipoAtorAuditoria.USUARIO_EMPRESA,
          modulo: 'UNIDADES',
          acao: 'ATUALIZAR',
          entidade: 'UNIDADE',
          entidadeId: id,
          resultado: ResultadoAuditoria.SUCESSO,
          dadosAnteriores: { codigo: anterior.codigo, nome: anterior.nome },
          dadosPosteriores: { codigo, nome },
        }, tx);
        return { id, codigo, nome };
      });
    } catch (erro) {
      if (erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === 'P2002') {
        throw new ConflictException('Já existe uma unidade com esse código nesta empresa.');
      }
      throw erro;
    }
  }
}
