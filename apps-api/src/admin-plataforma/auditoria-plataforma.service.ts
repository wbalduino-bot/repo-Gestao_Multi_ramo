import {
  BadRequestException,
  Injectable,
} from '@nestjs/common';
import {
  Prisma,
  ResultadoAuditoria,
  TipoAtorAuditoria,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { ListarAuditoriaPlataformaDto } from './dto/listar-auditoria-plataforma.dto.js';

/**
 * Consulta exclusivamente eventos administrativos SaaS.
 * NÃO disponibiliza a auditoria operacional das empresas clientes.
 * Nenhum campo JSON bruto, senha, token, IP ou userAgent é entregue à tela.
 */
@Injectable()
export class AuditoriaPlataformaService {
  constructor(
    private readonly prisma: PrismaService,
  ) {}

  async listar(
    _administradorPlataformaId: string,
    filtros: ListarAuditoriaPlataformaDto,
  ) {
    const pagina = filtros.pagina ?? 1;
    const limite = filtros.limite ?? 20;

    if (!Number.isInteger(pagina) || pagina < 1 ||
        !Number.isInteger(limite) || limite < 1 || limite > 50) {
      throw new BadRequestException('Paginação inválida.');
    }

    // Intervalo padrão de 30 dias, contado a partir do momento da consulta.
    const agora = new Date();
    const inicio = filtros.inicio
      ? new Date(filtros.inicio)
      : new Date(agora.getTime() - 30 * 24 * 60 * 60 * 1000);
    const fim = filtros.fim ? new Date(filtros.fim) : agora;

    if (
      !Number.isFinite(inicio.getTime()) ||
      !Number.isFinite(fim.getTime()) ||
      inicio > fim ||
      fim.getTime() - inicio.getTime() > 93 * 24 * 60 * 60 * 1000
    ) {
      throw new BadRequestException(
        'O período é inválido ou supera 93 dias.',
      );
    }

    /**
     * Limite obrigatório no SERVIDOR, independente dos filtros enviados.
     * Eventos anônimos só podem ser visualizados quando originados pelo
     * módulo ADMIN_PLATAFORMA (por exemplo, login administrativo recusado).
     */
    const condicoes: Prisma.EventoAuditoriaWhereInput[] = [
      {
        OR: [
          { tipoAtor: TipoAtorAuditoria.ADMIN_PLATAFORMA },
          {
            tipoAtor: TipoAtorAuditoria.ANONIMO,
            modulo: 'ADMIN_PLATAFORMA',
          },
        ],
      },
      { criadoEm: { gte: inicio, lte: fim } },
    ];

    if (filtros.modulo) condicoes.push({ modulo: filtros.modulo });
    if (filtros.acao) condicoes.push({ acao: filtros.acao });
    if (filtros.resultado) condicoes.push({ resultado: filtros.resultado });

    const where: Prisma.EventoAuditoriaWhereInput = { AND: condicoes };

    // Indicadores calculados no conjunto filtrado, não apenas na página atual.
    const [eventos, total, sucesso, falha, bloqueado] = await Promise.all([
      this.prisma.eventoAuditoria.findMany({
        where,
        orderBy: [{ criadoEm: 'desc' }, { id: 'desc' }],
        skip: (pagina - 1) * limite,
        take: limite,
        select: {
          id: true,
          criadoEm: true,
          tipoAtor: true,
          atorId: true,
          modulo: true,
          acao: true,
          entidade: true,
          entidadeId: true,
          resultado: true,
          motivo: true,
          requestId: true,
          metadados: true,
        },
      }),
      this.prisma.eventoAuditoria.count({ where }),
      this.prisma.eventoAuditoria.count({
        where: { AND: [...condicoes, { resultado: ResultadoAuditoria.SUCESSO }] },
      }),
      this.prisma.eventoAuditoria.count({
        where: { AND: [...condicoes, { resultado: ResultadoAuditoria.FALHA }] },
      }),
      this.prisma.eventoAuditoria.count({
        where: { AND: [...condicoes, { resultado: ResultadoAuditoria.BLOQUEADO }] },
      }),
    ]);

    // Consulta rotineira: não gera evento persistente a cada atualização da tela.

    return {
      dados: eventos.map((evento) => {
        // Somente o identificador de empresa-alvo é extraído do JSON.
        // Os metadados completos não são disponibilizados via endpoint.
        const metadados = evento.metadados;
        const empresaAlvoId =
          metadados !== null &&
          typeof metadados === 'object' &&
          !Array.isArray(metadados) &&
          typeof metadados.empresaAlvoId === 'string'
            ? metadados.empresaAlvoId
            : null;

        return {
          id: evento.id,
          criadoEm: evento.criadoEm,
          tipoAtor: evento.tipoAtor,
          atorId: evento.atorId,
          modulo: evento.modulo,
          acao: evento.acao,
          entidade: evento.entidade,
          entidadeId: evento.entidadeId,
          resultado: evento.resultado,
          motivo: evento.motivo,
          requestId: evento.requestId,
          empresaAlvoId,
        };
      }),
      total,
      pagina,
      limite,
      totalPaginas: Math.ceil(total / limite),
      indicadores: { sucesso, falha, bloqueado },
      periodo: { inicio: inicio.toISOString(), fim: fim.toISOString() },
    };
  }
}
