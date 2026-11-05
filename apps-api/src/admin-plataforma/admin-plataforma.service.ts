
import {
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  ResultadoAuditoria,
  TipoAtorAuditoria,
} from '@prisma/client';
import * as argon2 from 'argon2';

import { AuditoriaService } from '../auditoria/auditoria.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AplicacaoLogger } from '../logging/logger.service.js';
import { LoginAdminPlataformaDto } from './dto/login-admin-plataforma.dto.js';

/**
 * Serviço responsável pela autenticação dos administradores globais.
 *
 * O login administrativo possui fluxo independente da autenticação
 * dos usuários das empresas.
 *
 * Os eventos de login são registrados na auditoria central,
 * respeitando o tipo de ator ADMIN_PLATAFORMA ou ANONIMO.
 */
@Injectable()
export class AdminPlataformaService {
  // Registra problemas internos sem expor detalhes ao cliente.
  private readonly logger = new Logger(AdminPlataformaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly auditoria: AuditoriaService,
    private readonly aplicacaoLogger: AplicacaoLogger,
  ) {}

  /**
   * REGISTRA UMA TENTATIVA ADMINISTRATIVA RECUSADA
   *
   * Como a identidade ainda não foi confirmada, não utilizamos
   * o identificador do administrador como ator.
   *
   * O evento é classificado como ANONIMO.
   *
   * Não são armazenados e-mail, senha, hash ou token.
   *
   * Caso a auditoria de uma tentativa recusada falhe, a resposta
   * de autenticação permanece HTTP 401.
   */
  /**
   * REGISTRO TÉCNICO COMPLEMENTAR DE AUTENTICAÇÃO ADMINISTRATIVA
   *
   * Registra somente módulo, ação e resultado.
   * Não inclui e-mail, identificador, IP, senha, hash ou token.
   *
   * O histórico oficial continua no PostgreSQL.
   * Uma falha no arquivo não pode impedir o login.
   */
  private registrarEventoSeguranca(
    resultado: ResultadoAuditoria,
  ): void {
    try {
      const sucesso = resultado === ResultadoAuditoria.SUCESSO;

      this.aplicacaoLogger.registrarSeguranca(
        sucesso
          ? 'Login administrativo da plataforma concluído.'
          : 'Tentativa de login administrativo recusada.',
        {
          modulo: 'ADMIN_PLATAFORMA',
          acao: 'LOGIN',
          resultado,
        },
        sucesso ? 'info' : 'warn',
      );
    } catch {
      // O log técnico é complementar e não pode interromper a autenticação.
    }
  }
  private async registrarFalhaLogin(): Promise<void> {
    // Registra a tentativa recusada sem expor a identidade informada.
    this.registrarEventoSeguranca(ResultadoAuditoria.FALHA);

    try {
      await this.auditoria.registrar({
        tipoAtor: TipoAtorAuditoria.ANONIMO,
        modulo: 'ADMIN_PLATAFORMA',
        acao: 'LOGIN',
        resultado: ResultadoAuditoria.FALHA,
        motivo: 'Tentativa de autenticação recusada.',
      });
    } catch {
      // Não expõe detalhes internos nem substitui a resposta HTTP 401.
      this.logger.error(
        'Não foi possível registrar uma tentativa de login administrativo recusada na auditoria.',
      );
    }
  }

  /**
   * AUTENTICA UM ADMINISTRADOR DA PLATAFORMA
   *
   * Fluxo:
   * 1. Normaliza o e-mail.
   * 2. Busca o administrador pelo e-mail.
   * 3. Confirma que o administrador está ativo.
   * 4. Compara a senha com o hash armazenado.
   * 5. Gera o token JWT administrativo.
   * 6. Registra o login bem-sucedido.
   * 7. Retorna o token e os dados públicos do administrador.
   *
   * O token somente será entregue depois da confirmação
   * do registro de auditoria.
   */
  async login(dto: LoginAdminPlataformaDto) {
    // Padroniza o e-mail para evitar diferenças causadas por espaços ou maiúsculas.
    const email = dto.email.trim().toLowerCase();

    // Busca o administrador exclusivamente pelo e-mail normalizado.
    const administrador =
      await this.prisma.administradorPlataforma.findUnique({
        where: { email },
      });

    // Administradores inexistentes ou inativos não podem se autenticar.
    if (!administrador || !administrador.ativo) {
      await this.registrarFalhaLogin();

      throw new UnauthorizedException('Credenciais inválidas.');
    }

    // Verifica a senha digitada comparando-a com o hash armazenado.
    // A senha original nunca é armazenada em texto puro.
    let senhaValida = false;

    try {
      senhaValida = await argon2.verify(
        administrador.hashSenha,
        dto.senha,
      );
    } catch {
      // Também rejeita credenciais caso o hash armazenado esteja inválido.
      await this.registrarFalhaLogin();

      throw new UnauthorizedException('Credenciais inválidas.');
    }

    // Encerra a autenticação quando a senha não corresponde ao hash.
    if (!senhaValida) {
      await this.registrarFalhaLogin();

      throw new UnauthorizedException('Credenciais inválidas.');
    }

    // Define o payload exclusivo do administrador da plataforma.
    // Não existe empresaId porque esse ator pertence ao contexto global.
    const payload = {
      sub: administrador.id,
      tipo: 'ADMIN_PLATAFORMA',
    };

    // Assina o token com a configuração disponibilizada pelo JwtModule.
    const accessToken = await this.jwtService.signAsync(payload);

    /**
     * AUDITORIA DE LOGIN ADMINISTRATIVO BEM-SUCEDIDO
     *
     * Neste ponto, o administrador foi encontrado, está ativo
     * e sua senha foi confirmada.
     *
     * A auditoria recebe o identificador real do administrador.
     * empresaId permanece ausente, conforme as regras do serviço.
     *
     * Se a gravação falhar, o token não será entregue ao cliente.
     */
    await this.auditoria.registrar({
      atorId: administrador.id,
      tipoAtor: TipoAtorAuditoria.ADMIN_PLATAFORMA,
      modulo: 'ADMIN_PLATAFORMA',
      acao: 'LOGIN',
      resultado: ResultadoAuditoria.SUCESSO,
    });

    // O registro técnico ocorre após a auditoria oficial.
    this.registrarEventoSeguranca(ResultadoAuditoria.SUCESSO);

    // Retorna o token e os dados públicos do administrador.
    // O hash da senha nunca deve ser enviado ao cliente.
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
