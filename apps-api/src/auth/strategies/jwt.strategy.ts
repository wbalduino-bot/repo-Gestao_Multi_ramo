
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { consultarTrialEmpresa } from '../../empresas/trial-empresa.js';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service.js';

// Dados de identidade esperados no token JWT.
interface DadosToken {
  sub: string;
  empresaId: string;
  perfil: string;
  aud?: unknown;
  trial?: { terminaEm: string; diasRestantes: number };
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

      // Tokens com audiência específica não são sessões empresariais.
      if (payload.aud !== undefined) {
        throw new UnauthorizedException('Token inválido para acesso empresarial.');
      }

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
          deveTrocarSenha: false,
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
          empresa: { select: { modalidadeAcesso: true, trialIniciadoEm: true, trialTerminaEm: true } },
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

      const acesso = consultarTrialEmpresa(usuario.empresa);
      if (acesso.bloqueado) {
        throw new UnauthorizedException({ codigo: 'TRIAL_EXPIRADO', message: 'Periodo de teste encerrado. Entre em contato com o administrador do sistema para liberar o acesso.' });
      }

      // Usa os dados confirmados pelo banco, não apenas os do token.
      request.user = {
        sub: usuario.id,
        empresaId: usuario.empresaId,
        perfil: usuario.perfil,
        ...(acesso.trial ? { trial: acesso.trial } : {}),
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
