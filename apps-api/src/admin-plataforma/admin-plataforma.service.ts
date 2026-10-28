import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { PrismaService } from '../prisma/prisma.service.js';
import { LoginAdminPlataformaDto } from './dto/login-admin-plataforma.dto.js';

@Injectable()
export class AdminPlataformaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  async login(dto: LoginAdminPlataformaDto) {
    const email = dto.email.trim().toLowerCase();

    const administrador =
      await this.prisma.administradorPlataforma.findUnique({
        where: { email },
      });

    if (!administrador || !administrador.ativo) {
      throw new UnauthorizedException('Credenciais inválidas.');
    }

    let senhaValida = false;

    try {
      senhaValida = await argon2.verify(
        administrador.hashSenha,
        dto.senha,
      );
    } catch {
      throw new UnauthorizedException('Credenciais inválidas.');
    }

    if (!senhaValida) {
      throw new UnauthorizedException('Credenciais inválidas.');
    }

    const payload = {
      sub: administrador.id,
      tipo: 'ADMIN_PLATAFORMA',
    };

    const accessToken = await this.jwtService.signAsync(payload);

    return {
      accessToken,
      tokenType: 'Bearer',
      expiresIn: 900,
      administrador: {
        id: administrador.id,
        nome: administrador.nome,
        email: administrador.email,
      },
    };
  }
}
