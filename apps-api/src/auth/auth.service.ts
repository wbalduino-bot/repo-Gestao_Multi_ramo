
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { PrismaService } from '../prisma/prisma.service.js';
import { LoginDto } from './dto/login.dto.js';

@Injectable()
export class AuthService {
  // Injeta o Prisma para consultar o banco e o JwtService para gerar tokens.
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  // Autentica o usuário e retorna um token JWT quando as credenciais são válidas.
  async login(dto: LoginDto) {
    // Padroniza o e-mail para evitar diferenças causadas por espaços ou maiúsculas.
    const email = dto.email.trim().toLowerCase();

    // Busca a empresa informada e consulta apenas os campos necessários.
    const empresa = await this.prisma.empresa.findUnique({
      where: { id: dto.empresaId },
      select: {
        id: true,
        nome: true,
        ativo: true,
      },
    });
    // Impede o login se a empresa não existir ou estiver desativada.
    if (!empresa || !empresa.ativo) {
      throw new UnauthorizedException('Credenciais inválidas.');
    }

    // Busca o usuário dentro da empresa informada.
    // A chave composta corresponde à restrição @@unique([empresaId, email]) do Prisma.
    const usuario = await this.prisma.usuario.findUnique({
      where: {
        empresaId_email: {
          empresaId: empresa.id,
          email,
        },
      },
    });

    // Usuários inexistentes ou inativos não podem se autenticar.
    if (!usuario || !usuario.ativo) {
      throw new UnauthorizedException('Credenciais inválidas.');
    }

    // Verifica a senha digitada comparando-a com o hash armazenado no banco.
    // A senha original nunca precisa ser armazenada em texto puro.
    let senhaValida = false;

    try {
      senhaValida = await argon2.verify(usuario.hashSenha, dto.senha);
    } catch {
      // Também rejeita credenciais caso o hash armazenado esteja inválido.
      throw new UnauthorizedException('Credenciais inválidas.');
    }

    // Se a senha não corresponder ao hash, encerra a autenticação.
    if (!senhaValida) {
      throw new UnauthorizedException('Credenciais inválidas.');
    }

    // Define as informações que serão incluídas no payload do JWT.
    // "sub" representa o identificador do usuário autenticado.
    const payload = {
      sub: usuario.id,
      empresaId: usuario.empresaId,
      perfil: usuario.perfil,
    };

    // Assina o token usando a configuração do JwtModule.
    // A validade de 15 minutos foi definida no AuthModule.
    const accessToken = await this.jwtService.signAsync(payload);

    // Retorna o token e os dados públicos do usuário.
    // O hash da senha nunca deve ser enviado ao cliente.
    return {
      accessToken,
      tokenType: 'Bearer',
      expiresIn: 900, // Validade do token em segundos: 15 minutos.
      usuario: {
        id: usuario.id,
        empresaId: usuario.empresaId,
        empresaNome: empresa.nome,
        nome: usuario.nome,
        email: usuario.email,
        perfil: usuario.perfil,
      },
    };
  }
}
