
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
 * Define os dados que esperamos encontrar no token JWT
 * depois de validar sua assinatura e sua validade.
 *
 * sub: identificador do administrador da plataforma.
 * tipo: identifica que o token pertence à plataforma,
 * e não a um usuário comum de uma empresa cliente.
 */
interface PayloadAdminPlataforma {
  sub: string;
  tipo: 'ADMIN_PLATAFORMA';
}

/**
 * Estende a requisição HTTP para permitir que o NestJS
 * disponibilize a identidade validada durante a requisição.
 */
interface RequisicaoAdminPlataforma extends Request {
  user?: PayloadAdminPlataforma;
}

/**
 * Guard responsável por proteger as rotas administrativas
 * exclusivas da plataforma Gestão Comercial.
 *
 * Ele verifica:
 * 1. Se o token foi enviado no cabeçalho Authorization.
 * 2. Se o token é válido e não expirou.
 * 3. Se o token pertence a um administrador da plataforma.
 * 4. Se o administrador continua ativo no banco de dados.
 */
@Injectable()
export class AdminPlataformaGuard implements CanActivate {
  constructor(
    // Serviço responsável por verificar os tokens JWT.
    private readonly jwtService: JwtService,

    // Serviço responsável pelo acesso ao banco PostgreSQL.
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Método executado pelo NestJS antes de permitir
   * o acesso à rota protegida.
   */
  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Obtém a requisição HTTP atual.
    const requisicao =
      context.switchToHttp().getRequest<RequisicaoAdminPlataforma>();

    // Lê o cabeçalho Authorization enviado pelo cliente.
    const autorizacao = requisicao.headers.authorization;

    // Espera o formato: Authorization: Bearer <token>.
    const correspondencia = autorizacao?.match(/^Bearer\s+(.+)$/i);

    // Sem token, a requisição não está autenticada.
    if (!correspondencia) {
      throw new UnauthorizedException(
        'Token de acesso não informado.',
      );
    }

    // Verifica a assinatura e a validade do token.
    // Tokens inválidos ou expirados não podem prosseguir.
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

    // Confirma que o conteúdo do token tem o formato esperado
    // e que foi emitido para um administrador da plataforma.
    //
    // Um token de usuário de uma empresa não deve passar
    // nesta verificação, pois possui outra estrutura.
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

    // Consulta o banco para confirmar que o administrador
    // ainda existe e permanece ativo.
    //
    // Isso impede que um administrador desativado continue
    // acessando as rotas apenas porque seu token não expirou.
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

    // Bloqueia o acesso se o registro não existir
    // ou se o administrador tiver sido desativado.
    if (!administrador || !administrador.ativo) {
      throw new UnauthorizedException(
        'Administrador inexistente ou inativo.',
      );
    }

    // Disponibiliza a identidade confirmada para os próximos
    // componentes que precisarem consultar requisicao.user.
    requisicao.user = {
      sub: administrador.id,
      tipo: 'ADMIN_PLATAFORMA',
    };

    // Retornar true autoriza a continuação da requisição.
    return true;
  }
}
