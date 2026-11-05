import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';

import type { RequisicaoAutenticada } from '../strategies/jwt.strategy.js';

/**
 * Autoriza funcionalidades restritas à gestão da empresa.
 *
 * A identidade e o perfil já foram validados pelo JwtAuthGuard.
 * Somente ADMINISTRADOR e GERENTE podem acessar os recursos
 * protegidos por este guard.
 */
@Injectable()
export class GerenciaGuard implements CanActivate {
  private readonly perfisPermitidos = new Set([
    'ADMINISTRADOR',
    'GERENTE',
  ]);

  canActivate(context: ExecutionContext): boolean {
    const requisicao = context
      .switchToHttp()
      .getRequest<RequisicaoAutenticada>();

    const perfil = requisicao.user?.perfil;

    if (!perfil || !this.perfisPermitidos.has(perfil)) {
      throw new ForbiddenException(
        'Seu perfil não tem permissão para acessar este recurso.',
      );
    }

    return true;
  }
}
