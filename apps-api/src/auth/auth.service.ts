
import {
  BadRequestException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';

import { consultarTrialEmpresa } from '../empresas/trial-empresa.js';
import { JwtService } from '@nestjs/jwt';
import { createHash } from 'node:crypto';

import {
  ResultadoAuditoria,
  TipoAtorAuditoria,
} from '@prisma/client';

import * as argon2 from 'argon2';

import { AuditoriaService } from '../auditoria/auditoria.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AplicacaoLogger } from '../logging/logger.service.js';

import { LoginDto } from './dto/login.dto.js';
import { TrocarSenhaInicialDto } from './dto/trocar-senha-inicial.dto.js';

import { LoginRateLimitService } from './login-rate-limit.service.js';

import type { ReservaTentativaLogin } from './login-rate-limit.service.js';

const AUDIENCIA_PRIMEIRO_ACESSO = 'gestao:troca-senha-inicial';
const VALIDADE_PRIMEIRO_ACESSO = 300;

type DadosPrimeiroAcesso = {
  sub: string;
  empresaId: string;
  vinculo: string;
};

/** Vincula a autorização à credencial atual sem colocar o hash Argon2 no token. */
function vincularCredencial(hashSenha: string): string {
  return createHash('sha256').update(hashSenha).digest('base64url');
}

/**
 * Serviço responsável pela autenticação dos usuários empresariais.
 *
 * Também controla tentativas excessivas de login e registra
 * os resultados das autenticações na auditoria central.
 *
 * Nunca armazena ou registra senhas, hashes ou tokens em auditoria.
 */
@Injectable()
export class AuthService {
  // Logger interno para registrar problemas na infraestrutura.
  private readonly logger = new Logger(AuthService.name);

  /**
   * Injeta:
   * - PrismaService: consulta usuários e empresas.
   * - JwtService: gera os tokens JWT.
   * - AuditoriaService: registra os eventos de autenticação.
   * - LoginRateLimitService: controla tentativas excessivas de login.
   */
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly auditoria: AuditoriaService,
    private readonly aplicacaoLogger: AplicacaoLogger,
    private readonly loginRateLimit: LoginRateLimitService,
  ) {}

  /**
   * REGISTRA UMA TENTATIVA DE LOGIN RECUSADA.
   *
   * Como as credenciais não foram confirmadas, a tentativa
   * não é atribuída a um usuário específico.
   *
   * O ator será ANONIMO, sem atorId.
   *
   * O empresaId é mantido apenas como referência informada
   * na tentativa de autenticação.
   *
   * Se a auditoria estiver indisponível, preservamos a resposta
   * HTTP 401 da autenticação.
   */
  /**
   * REGISTRO TÉCNICO COMPLEMENTAR DE AUTENTICAÇÃO
   *
   * Registra somente informações operacionais genéricas.
   * Não inclui e-mail, empresa, usuário, IP, senha ou token.
   *
   * A auditoria oficial continua sendo persistida no PostgreSQL.
   * Uma falha neste registro complementar nunca altera o login.
   */
  private registrarEventoSeguranca(
    resultado: ResultadoAuditoria,
  ): void {
    try {
      const sucesso = resultado === ResultadoAuditoria.SUCESSO;

      this.aplicacaoLogger.registrarSeguranca(
        sucesso
          ? 'Login empresarial concluído.'
          : 'Tentativa de login empresarial recusada.',
        {
          modulo: 'AUTH',
          acao: 'LOGIN',
          resultado,
        },
        sucesso ? 'info' : 'warn',
      );
    } catch {
      // O log técnico é complementar e não pode interromper a autenticação.
    }
  }
  private async registrarFalhaLogin(
    empresaId: string,
  ): Promise<void> {
    // Registra a tentativa sem expor os dados informados no login.
    this.registrarEventoSeguranca(ResultadoAuditoria.FALHA);

    try {
      await this.auditoria.registrar({
        empresaId,
        tipoAtor: TipoAtorAuditoria.ANONIMO,
        modulo: 'AUTH',
        acao: 'LOGIN',
        resultado: ResultadoAuditoria.FALHA,
        motivo: 'Tentativa de autenticação recusada.',
      });
    } catch {
      // Não expõe detalhes internos nem substitui a resposta HTTP 401.
      this.logger.error(
        'Não foi possível registrar uma tentativa de login recusada na auditoria.',
      );
    }
  }

  /**
   * LIBERA UMA RESERVA QUANDO OCORRE UM ERRO INTERNO.
   *
   * Erros de banco, geração de token ou auditoria não representam
   * necessariamente uma senha incorreta.
   *
   * Por isso, a reserva deve ser liberada quando possível.
   *
   * Se o próprio Redis estiver indisponível durante a liberação,
   * o contador permanecerá protegido pelo TTL definido na reserva.
   */
  private async liberarReservaAposErro(
    reserva: ReservaTentativaLogin,
  ): Promise<void> {
    try {
      await reserva.liberar();
    } catch (erro) {
      // Preserva o erro original sem esconder o problema do Redis.
      this.logger.error(
        'Não foi possível liberar a reserva da tentativa de login.',
        erro instanceof Error ? erro.stack : undefined,
      );
    }
  }

  /**
   * AUTENTICA UM USUÁRIO EMPRESARIAL.
   *
   * Fluxo:
   * 1. Normaliza o e-mail.
   * 2. Reserva uma tentativa no Redis.
   * 3. Confirma que a empresa existe e está ativa.
   * 4. Busca o usuário dentro da empresa.
   * 5. Confirma que o usuário está ativo.
   * 6. Compara a senha com o hash armazenado.
   * 7. Gera o token JWT.
   * 8. Libera a reserva da autenticação válida.
   * 9. Registra o login bem-sucedido na auditoria.
   * 10. Retorna o token e os dados públicos do usuário.
   *
   * Somente credenciais recusadas permanecem contabilizadas.
   */
  async login(dto: LoginDto, ip: string) {
    // Padroniza o e-mail para evitar diferenças de espaços ou maiúsculas.
    const email = dto.email.trim().toLowerCase();

    /**
     * Reserva a tentativa antes das consultas de autenticação.
     *
     * Se o limite for ultrapassado, o serviço interrompe o login
     * com HTTP 429.
     *
     * Se o Redis estiver indisponível, o login será recusado
     * com HTTP 503, sem permitir autenticação sem controle.
     */
    const reserva = await this.loginRateLimit.reservarTentativa(
      dto.empresaId,
      email,
      ip,
    );

    /**
     * Indica se a operação terminou com credenciais recusadas.
     *
     * Quando verdadeiro, a reserva permanece contabilizada.
     *
     * Erros internos não devem penalizar o usuário, portanto
     * nesses casos a reserva será liberada.
     */
    let credenciaisRecusadas = false;

    try {
      // Busca a empresa informada e consulta apenas os campos necessários.
      const empresa = await this.prisma.empresa.findUnique({
        where: {
          id: dto.empresaId,
        },
        select: {
          id: true,
          nome: true,
          ativo: true,
          modalidadeAcesso: true,
          trialIniciadoEm: true,
          trialTerminaEm: true,
        },
      });

      // Impede o login quando a empresa não existe ou está desativada.
      if (!empresa || !empresa.ativo) {
        credenciaisRecusadas = true;

        await this.registrarFalhaLogin(dto.empresaId);

        throw new UnauthorizedException(
          'Credenciais inválidas.',
        );
      }

      /**
       * Busca o usuário dentro da empresa informada.
       *
       * A chave composta impede que um usuário de outra empresa
       * seja utilizado para autenticação nesta empresa.
       */
      const usuario = await this.prisma.usuario.findUnique({
        where: {
          empresaId_email: {
            empresaId: empresa.id,
            email,
          },
        },
      });

      // Usuários inexistentes ou desativados não podem se autenticar.
      if (!usuario || !usuario.ativo) {
        credenciaisRecusadas = true;

        await this.registrarFalhaLogin(dto.empresaId);

        throw new UnauthorizedException(
          'Credenciais inválidas.',
        );
      }

      /**
       * Verifica a senha comparando-a com o hash Argon2 armazenado.
       *
       * Uma senha incorreta permanece contabilizada no Redis.
       */
      let senhaValida = false;

      try {
        senhaValida = await argon2.verify(
          usuario.hashSenha,
          dto.senha,
        );
      } catch {
        /**
         * Um hash inválido também deve resultar em uma resposta
         * de autenticação recusada, sem revelar detalhes internos.
         *
         * A tentativa permanece contabilizada para evitar
         * exploração de registros de senha inconsistentes.
         */
        credenciaisRecusadas = true;

        await this.registrarFalhaLogin(dto.empresaId);

        throw new UnauthorizedException(
          'Credenciais inválidas.',
        );
      }

      // Encerra a autenticação quando a senha não corresponde ao hash.
      if (!senhaValida) {
        credenciaisRecusadas = true;

        await this.registrarFalhaLogin(dto.empresaId);

        throw new UnauthorizedException(
          'Credenciais inválidas.',
        );
      }

      /**
       * Define as informações que serão incluídas no JWT.
       *
       * O sub representa o identificador do usuário autenticado.
       * O empresaId identifica a empresa à qual o usuário pertence.
       */
      if (consultarTrialEmpresa(empresa).bloqueado) {
        await this.registrarFalhaLogin(dto.empresaId);
        throw new UnauthorizedException({ codigo: 'TRIAL_EXPIRADO', message: 'Periodo de teste encerrado. Entre em contato com o administrador do sistema para liberar o acesso.' });
      }

      const payload = {
        sub: usuario.id,
        empresaId: usuario.empresaId,
        perfil: usuario.perfil,
      };

      // A autorização inicial não contém as permissões de uma sessão empresarial.
      const sessao = usuario.deveTrocarSenha
        ? {
            requerTrocaSenha: true as const,
            tokenPrimeiroAcesso: await this.jwtService.signAsync({
              sub: usuario.id,
              empresaId: usuario.empresaId,
              vinculo: vincularCredencial(usuario.hashSenha),
            }, {
              audience: AUDIENCIA_PRIMEIRO_ACESSO,
              expiresIn: VALIDADE_PRIMEIRO_ACESSO,
            }),
            tokenType: 'Bearer',
            expiresIn: VALIDADE_PRIMEIRO_ACESSO,
          }
        : {
            accessToken: await this.jwtService.signAsync(payload),
            tokenType: 'Bearer',
            expiresIn: 900,
            usuario: {
              id: usuario.id,
              empresaId: usuario.empresaId,
              empresaNome: empresa.nome,
              nome: usuario.nome,
              email: usuario.email,
              perfil: usuario.perfil,
            },
          };

      /**
       * A senha foi confirmada, portanto esta requisição
       * não deve permanecer contabilizada como tentativa inválida.
       *
       * A liberação ocorre antes da auditoria de sucesso.
       * Se o Redis falhar, o token não será entregue.
       */
      await reserva.liberar();

      /**
       * AUDITORIA DE LOGIN BEM-SUCEDIDO.
       *
       * A auditoria precisa ser persistida antes da entrega do token.
       *
       * Se sua gravação falhar, o usuário não receberá uma sessão,
       * preservando a exigência de rastreabilidade da plataforma.
       */
      await this.auditoria.registrar({
        empresaId: usuario.empresaId,
        atorId: usuario.id,
        tipoAtor: TipoAtorAuditoria.USUARIO_EMPRESA,
        modulo: 'AUTH',
        acao: 'LOGIN',
        resultado: ResultadoAuditoria.SUCESSO,
      });

      // O log complementar acontece somente após a auditoria oficial.
      this.registrarEventoSeguranca(ResultadoAuditoria.SUCESSO);

      // Retorna exclusivamente os dados públicos do usuário.
      return sessao;
    } catch (erro) {
      /**
       * Credenciais recusadas permanecem contabilizadas.
       *
       * Erros internos, como falhas no banco, JWT ou auditoria,
       * liberam somente a reserva desta requisição.
       */
      if (!credenciaisRecusadas) {
        await this.liberarReservaAposErro(reserva);
      }

      // Preserva o erro original para o tratamento HTTP do NestJS.
      throw erro;
    }
  }

  /**
   * Troca a senha usando uma autorização curta, exclusiva do primeiro acesso.
   * A comparação na escrita impede que duas requisições consumam a mesma autorização.
   */
  async trocarSenhaInicial(
    authorization: string | undefined,
    dto: TrocarSenhaInicialDto,
  ): Promise<void> {
    const mensagem = 'Autorização de primeiro acesso inválida ou expirada.';
    const token = authorization?.startsWith('Bearer ')
      ? authorization.slice('Bearer '.length).trim()
      : '';

    if (!token) throw new UnauthorizedException(mensagem);

    let payload: DadosPrimeiroAcesso;
    try {
      payload = await this.jwtService.verifyAsync<DadosPrimeiroAcesso>(token, {
        audience: AUDIENCIA_PRIMEIRO_ACESSO,
      });
    } catch {
      throw new UnauthorizedException(mensagem);
    }

    if (
      typeof payload.sub !== 'string' ||
      typeof payload.empresaId !== 'string' ||
      typeof payload.vinculo !== 'string'
    ) {
      throw new UnauthorizedException(mensagem);
    }

    const contaPendente = {
      id: payload.sub,
      empresaId: payload.empresaId,
      ativo: true,
      deveTrocarSenha: true,
      empresa: { is: { ativo: true } },
    };
    const usuario = await this.prisma.usuario.findFirst({
      where: contaPendente,
      select: { id: true, empresaId: true, hashSenha: true, empresa: {
        select: { modalidadeAcesso: true, trialIniciadoEm: true, trialTerminaEm: true },
      } },
    });

    if (!usuario || vincularCredencial(usuario.hashSenha) !== payload.vinculo) {
      throw new UnauthorizedException(mensagem);
    }

    if (consultarTrialEmpresa(usuario.empresa).bloqueado) {
      throw new UnauthorizedException({ codigo: 'TRIAL_EXPIRADO', message: 'Periodo de teste encerrado. Entre em contato com o administrador do sistema.' });
    }

    if (await argon2.verify(usuario.hashSenha, dto.novaSenha)) {
      throw new BadRequestException('Escolha uma senha diferente da senha temporária.');
    }

    const novoHash = await argon2.hash(dto.novaSenha);
    await this.prisma.$transaction(async (transacao) => {
      const alteracao = await transacao.usuario.updateMany({
        where: { ...contaPendente, hashSenha: usuario.hashSenha, empresa: { is: {
          ativo: true, OR: [
            { modalidadeAcesso: 'DEFINITIVO' },
            { modalidadeAcesso: 'TRIAL', trialIniciadoEm: { lte: new Date() }, trialTerminaEm: { gt: new Date() } },
          ],
        } } },
        data: { hashSenha: novoHash, deveTrocarSenha: false },
      });

      if (alteracao.count !== 1) throw new UnauthorizedException(mensagem);

      // A troca e sua auditoria são confirmadas juntas, sem dados da credencial.
      await this.auditoria.registrar({
        empresaId: usuario.empresaId,
        atorId: usuario.id,
        tipoAtor: TipoAtorAuditoria.USUARIO_EMPRESA,
        modulo: 'AUTH',
        acao: 'TROCAR_SENHA_PRIMEIRO_ACESSO',
        resultado: ResultadoAuditoria.SUCESSO,
      }, transacao);
    });
  }
}
