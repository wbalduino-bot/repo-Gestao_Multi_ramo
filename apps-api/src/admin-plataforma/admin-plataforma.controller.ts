import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
} from '@nestjs/common';
import { AdminPlataformaService } from './admin-plataforma.service.js';
import { LoginAdminPlataformaDto } from './dto/login-admin-plataforma.dto.js';

@Controller('admin-plataforma')
export class AdminPlataformaController {
  constructor(
    private readonly adminPlataformaService: AdminPlataformaService,
  ) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() dto: LoginAdminPlataformaDto) {
    return this.adminPlataformaService.login(dto);
  }
}
