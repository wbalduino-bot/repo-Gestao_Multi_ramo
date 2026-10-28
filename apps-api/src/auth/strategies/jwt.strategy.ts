
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service.js';

// Dados de identidade esperados no token JWT.
interface DadosToken {
  sub: string;
  empresaId: string;
  perfil: string;
}

// Requisição HTTP que contém os dados do usuário autenticado.
export interface RequisicaoAutenticada extends Request {
  user: DadosToken;
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Obtém a requisição HTTP atual.
    const request = context
      .switchToHttp()
      .getRequest<RequisicaoAutenticada>();

    // Exige o cabeçalho Authorization com o formato Bearer.
    const authorization = request.headers.authorization;

    if (!authorization || !authorization.startsWith('Bearer ')) {
      throw new UnauthorizedException('Token de acesso não informado.');
    }

    const token = authorization.slice('Bearer '.length).trim();

    if (!token) {
      throw new UnauthorizedException('Token de acesso não informado.');
    }

    try {
      // Valida a assinatura e a expiração do JWT.
      const payload =
        await this.jwtService.verifyAsync<DadosToken>(token);

      // Confere os campos necessários para identificar o usuário.
      if (
        typeof payload.sub !== 'string' ||
        typeof payload.empresaId !== 'string' ||
        typeof payload.perfil !== 'string'
      ) {
        throw new UnauthorizedException('Token inválido.');
      }

      // Confirma no banco que o usuário pertence à empresa indicada,
      // que ambos continuam ativos e que o perfil não foi alterado.
      const usuario = await this.prisma.usuario.findFirst({
        where: {
          id: payload.sub,
          empresaId: payload.empresaId,
          ativo: true,
          empresa: {
            is: {
              ativo: true,
            },
          },
        },
        select: {
          id: true,
          empresaId: true,
          perfil: true,
        },
      });

      // Usuário inexistente, inativo ou empresa inativa.
      if (!usuario) {
        throw new UnauthorizedException(
          'Usuário ou empresa inativa ou não encontrada.',
        );
      }

      // Se o perfil mudou desde o login, exige nova autenticação.
      if (usuario.perfil !== payload.perfil) {
        throw new UnauthorizedException(
          'Perfil alterado. Faça login novamente.',
        );
      }

      // Usa os dados confirmados pelo banco, não apenas os do token.
      request.user = {
        sub: usuario.id,
        empresaId: usuario.empresaId,
        perfil: usuario.perfil,
      };

      return true;
    } catch (erro) {
      // Preserva erros de autenticação já identificados.
      if (erro instanceof UnauthorizedException) {
        throw erro;
      }

      // Rejeita tokens inválidos ou erros durante a validação.
      throw new UnauthorizedException(
        'Token inválido ou expirado.',
      );
    }
  }
}
