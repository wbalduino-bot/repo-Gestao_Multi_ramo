import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma, ResultadoAuditoria, TipoAtorAuditoria } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { ListarAuditoriaEmpresaDto } from './dto/listar-auditoria-empresa.dto.js';

/**
 * Consulta somente a auditoria vinculada à empresa autenticada.
 * Não retorna metadados brutos, estados anteriores/posteriores, IPs ou credenciais.
 * As consultas a este painel NÃO criam novos eventos de leitura.
 */
@Injectable()
export class AuditoriaEmpresaService {
  constructor(private readonly prisma: PrismaService) {}

  async listar(empresaId: string, filtros: ListarAuditoriaEmpresaDto) {
    const pagina = Number(filtros.pagina ?? 1);
    const limite = Number(filtros.limite ?? 20);
    if (!Number.isInteger(pagina) || pagina < 1 ||
        !Number.isInteger(limite) || limite < 1 || limite > 50) {
      throw new BadRequestException('Paginação inválida.');
    }

    const agora = new Date();
    const inicio = filtros.inicio
      ? new Date(filtros.inicio)
      : new Date(agora.getTime() - 30 * 24 * 60 * 60 * 1000);
    const fim = filtros.fim ? new Date(filtros.fim) : agora;
    if (!Number.isFinite(inicio.getTime()) || !Number.isFinite(fim.getTime()) ||
        inicio > fim || fim.getTime() - inicio.getTime() > 93 * 24 * 60 * 60 * 1000) {
      throw new BadRequestException('O período é inválido ou supera 93 dias.');
    }

    // O empresaId vem exclusivamente da identidade verificada no backend.
    // Inclui tentativas de login anônimas associadas a esta empresa.
    const condicoes: Prisma.EventoAuditoriaWhereInput[] = [
      { empresaId },
      { OR: [
        { tipoAtor: TipoAtorAuditoria.USUARIO_EMPRESA },
        { tipoAtor: TipoAtorAuditoria.ANONIMO, modulo: 'AUTH', acao: 'LOGIN' },
      ] },
      { criadoEm: { gte: inicio, lte: fim } },
    ];
    if (filtros.modulo) condicoes.push({ modulo: filtros.modulo });
    if (filtros.acao) condicoes.push({ acao: filtros.acao });
    if (filtros.resultado) condicoes.push({ resultado: filtros.resultado });
    if (filtros.atorId) condicoes.push({ atorId: filtros.atorId });

    const where: Prisma.EventoAuditoriaWhereInput = { AND: condicoes };
    const [eventos, total, sucessos, falhas, bloqueados] = await this.prisma.$transaction([
      this.prisma.eventoAuditoria.findMany({
        where,
        orderBy: [{ criadoEm: 'desc' }, { id: 'desc' }],
        skip: (pagina - 1) * limite,
        take: limite,
        select: {
          id: true, criadoEm: true, atorId: true, tipoAtor: true,
          modulo: true, acao: true, entidade: true, entidadeId: true,
          resultado: true, motivo: true, requestId: true,
        },
      }),
      this.prisma.eventoAuditoria.count({ where }),
      this.prisma.eventoAuditoria.count({ where: { AND: [...condicoes, { resultado: ResultadoAuditoria.SUCESSO }] } }),
      this.prisma.eventoAuditoria.count({ where: { AND: [...condicoes, { resultado: ResultadoAuditoria.FALHA }] } }),
      this.prisma.eventoAuditoria.count({ where: { AND: [...condicoes, { resultado: ResultadoAuditoria.BLOQUEADO }] } }),
    ]);

    // Consulta de nomes também é limitada à empresa, evitando referência cruzada.
    const ids = [...new Set(eventos.map((evento) => evento.atorId).filter((id): id is string => Boolean(id)))];
    const usuarios = ids.length
      ? await this.prisma.usuario.findMany({
          where: { empresaId, id: { in: ids } },
          select: { id: true, nome: true },
        })
      : [];
    const nomes = new Map(usuarios.map((usuario) => [usuario.id, usuario.nome]));

    return {
      dados: eventos.map((evento) => ({
        ...evento,
        responsavel: evento.atorId
          ? nomes.get(evento.atorId) ?? 'Usuário não identificado'
          : 'Tentativa sem autenticação',
      })),
      total, sucessos, falhas, bloqueados, pagina, limite,
      totalPaginas: Math.ceil(total / limite),
    };
  }
}
