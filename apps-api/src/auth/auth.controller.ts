
import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
} from '@nestjs/common';

import { AuthService } from './auth.service.js';
import { LoginDto } from './dto/login.dto.js';

// Define a rota base deste controller: /auth.
@Controller('auth')
export class AuthController {
  // Injeta o serviço responsável pela lógica de autenticação.
  constructor(private readonly authService: AuthService) {}

  // Define o endpoint POST /auth/login.
  // O código HTTP 200 indica que a autenticação foi realizada com sucesso.
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() dto: LoginDto) {
    // Recebe os dados enviados no corpo da requisição.
    // O LoginDto define e valida os campos esperados.
    // A autenticação propriamente dita fica no AuthService.
    return this.authService.login(dto);
  }
}
