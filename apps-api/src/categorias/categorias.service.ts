import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ResultadoAuditoria, TipoAtorAuditoria } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditoriaService } from '../auditoria/auditoria.service.js';
import { CriarCategoriaDto } from './dto/criar-categoria.dto.js';
import { EditarCategoriaDto } from './dto/editar-categoria.dto.js';

@Injectable()
export class CategoriasService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditoria: AuditoriaService,
  ) {}

  /** Consulta apenas categorias da empresa, sem auditoria por leitura rotineira. */
  listar(empresaId: string) {
    return this.prisma.categoria.findMany({
      where: { empresaId },
      orderBy: [{ nome: 'asc' }, { id: 'asc' }],
      select: { id: true, nome: true, categoriaPaiId: true },
    });
  }

  /** Cadastro e auditoria confirmados na mesma transação. */
  async criar(empresaId: string, atorId: string, dto: CriarCategoriaDto) {
    return this.prisma.$transaction(async (tx) => {
      // A categoria pai deve existir dentro do mesmo tenant.
      if (dto.categoriaPaiId) {
        const pai = await tx.categoria.findFirst({
          where: { id: dto.categoriaPaiId, empresaId },
          select: { id: true },
        });
        if (!pai) {
          throw new BadRequestException('Categoria pai inválida para esta empresa.');
        }
      }

      // Evita cadastro duplicado na mesma posição da árvore.
      const existente = await tx.categoria.findFirst({
        where: {
          empresaId,
          nome: { equals: dto.nome, mode: 'insensitive' },
          categoriaPaiId: dto.categoriaPaiId ?? null,
        },
        select: { id: true },
      });
      if (existente) {
        throw new ConflictException('Já existe uma categoria com esse nome neste nível.');
      }

      const categoria = await tx.categoria.create({
        data: {
          empresaId,
          nome: dto.nome,
          categoriaPaiId: dto.categoriaPaiId ?? null,
        },
        select: { id: true, nome: true, categoriaPaiId: true },
      });

      await this.auditoria.registrar({
        empresaId,
        atorId,
        tipoAtor: TipoAtorAuditoria.USUARIO_EMPRESA,
        modulo: 'CATEGORIAS',
        acao: 'CRIAR',
        entidade: 'CATEGORIA',
        entidadeId: categoria.id,
        resultado: ResultadoAuditoria.SUCESSO,
        dadosPosteriores: { nome: categoria.nome, categoriaPaiId: categoria.categoriaPaiId },
      }, tx);
      return categoria;
    });
  }

  /**
   * Atualiza somente uma categoria da empresa autenticada.
   * Preserva o ID e os produtos vinculados; impede ciclos na árvore.
   * A alteração e a auditoria são confirmadas na mesma transação.
   */
  async editar(empresaId: string, atorId: string, id: string, dto: EditarCategoriaDto) {
    return this.prisma.$transaction(async (tx) => {
      const anterior = await tx.categoria.findFirst({
        where: { id, empresaId },
        select: { id: true, nome: true, categoriaPaiId: true },
      });
      if (!anterior) throw new NotFoundException('Categoria não encontrada.');

      const nome = dto.nome === undefined ? anterior.nome : dto.nome.trim();
      const categoriaPaiId = dto.categoriaPaiId === undefined
        ? anterior.categoriaPaiId
        : dto.categoriaPaiId;

      if (categoriaPaiId === id) {
        throw new BadRequestException('Uma categoria não pode ser sua própria categoria-pai.');
      }

      // Percorre os ancestrais da nova categoria-pai e rejeita ciclos,
      // inclusive caso existam relações antigas inconsistentes.
      const visitados = new Set<string>([id]);
      let ancestralId = categoriaPaiId;
      while (ancestralId) {
        if (visitados.has(ancestralId)) {
          throw new BadRequestException('A hierarquia de categorias não pode conter ciclos.');
        }
        visitados.add(ancestralId);
        const ancestral = await tx.categoria.findFirst({
          where: { id: ancestralId, empresaId },
          select: { id: true, categoriaPaiId: true },
        });
        if (!ancestral) {
          throw new BadRequestException('Categoria-pai inválida para esta empresa.');
        }
        ancestralId = ancestral.categoriaPaiId;
      }

      const duplicada = await tx.categoria.findFirst({
        where: {
          empresaId,
          nome: { equals: nome, mode: 'insensitive' },
          categoriaPaiId,
          id: { not: id },
        },
        select: { id: true },
      });
      if (duplicada) {
        throw new ConflictException('Já existe uma categoria com esse nome neste nível.');
      }

      // UpdateMany inclui empresaId na condição e impede alteração fora do tenant.
      const atualizacao = await tx.categoria.updateMany({
        where: { id, empresaId },
        data: { nome, categoriaPaiId },
      });
      if (atualizacao.count !== 1) throw new NotFoundException('Categoria não encontrada.');

      const atual = { id, nome, categoriaPaiId };
      await this.auditoria.registrar({
        empresaId,
        atorId,
        tipoAtor: TipoAtorAuditoria.USUARIO_EMPRESA,
        modulo: 'CATEGORIAS',
        acao: 'ATUALIZAR',
        entidade: 'CATEGORIA',
        entidadeId: id,
        resultado: ResultadoAuditoria.SUCESSO,
        dadosAnteriores: { nome: anterior.nome, categoriaPaiId: anterior.categoriaPaiId },
        dadosPosteriores: { nome, categoriaPaiId },
      }, tx);
      return atual;
    });
  }
}
