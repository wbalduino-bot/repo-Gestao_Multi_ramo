import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';

import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service.js';

/**
 * Dados esperados no JWT após validação da assinatura e validade.
 */
export interface PayloadAdminPlataforma {
  sub: string;
  tipo: 'ADMIN_PLATAFORMA';
}

/**
 * Requisição HTTP com a identidade administrativa validada pelo guard.
 */
export interface RequisicaoAdminPlataforma extends Request {
  user?: PayloadAdminPlataforma;
}

/**
 * Protege as rotas administrativas exclusivas da plataforma.
 */
@Injectable()
export class AdminPlataformaGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requisicao =
      context.switchToHttp().getRequest<RequisicaoAdminPlataforma>();

    const autorizacao = requisicao.headers.authorization;
    const correspondencia = autorizacao?.match(/^Bearer\s+(.+)$/i);

    if (!correspondencia) {
      throw new UnauthorizedException(
        'Token de acesso não informado.',
      );
    }

    let payload: unknown;

    try {
      payload = await this.jwtService.verifyAsync(
        correspondencia[1],
      );
    } catch {
      throw new UnauthorizedException(
        'Token inválido ou expirado.',
      );
    }

    if (
      typeof payload !== 'object' ||
      payload === null ||
      !('sub' in payload) ||
      typeof payload.sub !== 'string' ||
      !('tipo' in payload) ||
      payload.tipo !== 'ADMIN_PLATAFORMA'
    ) {
      throw new ForbiddenException(
        'Acesso permitido somente ao administrador da plataforma.',
      );
    }

    const administrador =
      await this.prisma.administradorPlataforma.findUnique({
        where: {
          id: payload.sub,
        },
        select: {
          id: true,
          ativo: true,
        },
      });

    if (!administrador || !administrador.ativo) {
      throw new UnauthorizedException(
        'Administrador inexistente ou inativo.',
      );
    }

    // Disponibiliza somente a identidade confirmada no banco.
    requisicao.user = {
      sub: administrador.id,
      tipo: 'ADMIN_PLATAFORMA',
    };

    return true;
  }
}