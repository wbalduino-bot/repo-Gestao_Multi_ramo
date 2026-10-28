
import {
  Controller,
  Get,
  Req,
  UseGuards,
} from '@nestjs/common';

import {
  JwtAuthGuard,
  type RequisicaoAutenticada,
} from '../auth/strategies/jwt.strategy.js';

// Define a rota base /usuarios.
@Controller('usuarios')
export class UsuariosController {
  // Cria a rota GET /usuarios/me, protegida por autenticação JWT.
  @Get('me')
  @UseGuards(JwtAuthGuard)
  obterUsuarioAutenticado(@Req() requisicao: RequisicaoAutenticada) {
    // O guard já validou o token e disponibilizou os dados do usuário.
    const { sub, empresaId, perfil } = requisicao.user;

    // Retorna os dados de identidade sem expor informações sensíveis.
    return {
      usuarioId: sub,
      empresaId,
      perfil,
    };
  }
}
