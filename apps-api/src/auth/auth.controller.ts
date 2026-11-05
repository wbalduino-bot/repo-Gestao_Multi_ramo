
import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
} from '@nestjs/common';

import type { Request } from 'express';

import { AuthService } from './auth.service.js';
import { LoginDto } from './dto/login.dto.js';

/**
 * Define a rota base deste controller: /auth.
 *
 * Este controller recebe as requisições HTTP e encaminha
 * os dados para o serviço responsável pelas regras de autenticação.
 */
@Controller('auth')
export class AuthController {
  /**
   * Injeta o serviço responsável pelo processamento do login.
   */
  constructor(
    private readonly authService: AuthService,
  ) {}

  /**
   * POST /auth/login
   *
   * Recebe as credenciais e identifica o IP da conexão.
   *
   * O IP é obtido por request.ip, sem confiar diretamente
   * no cabeçalho X-Forwarded-For enviado pelo cliente.
   *
   * Em ambientes com proxy reverso, a configuração de confiança
   * deve ser definida explicitamente no servidor.
   *
   * O código HTTP 200 indica autenticação bem-sucedida.
   */
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() dto: LoginDto,
    @Req() requisicao: Request,
  ) {
    // Obtém o endereço de origem reconhecido pelo Express.
    const ip = requisicao.ip ?? '';

    /**
     * Encaminha credenciais e IP ao AuthService.
     *
     * A validação, os limites Redis, a geração do JWT
     * e a auditoria permanecem sob responsabilidade do serviço.
     */
    return this.authService.login(dto, ip);
  }
}
