import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';

import {
  PerfilAcesso,
  Prisma,
  ResultadoAuditoria,
  TipoAtorAuditoria,
} from '@prisma/client';

import * as argon2 from 'argon2';

import { PrismaService } from '../prisma/prisma.service.js';
import { AuditoriaService } from '../auditoria/auditoria.service.js';

import { CriarUsuarioDto } from './dto/criar-usuario.dto.js';
import { AtualizarUsuarioDto } from './dto/atualizar-usuario.dto.js';
import { ListarUsuariosDto } from './dto/listar-usuarios.dto.js';

import type { RegistrarEventoAuditoriaInput } from '../auditoria/auditoria.service.js';

/**
 * Campos permitidos nas respostas.
 * O hash da senha nunca será enviado ao frontend.
 */
const USUARIO_PUBLICO_SELECT = {
  id: true,
  nome: true,
  email: true,
  perfil: true,
  ativo: true,
  criadoEm: true,
} satisfies Prisma.UsuarioSelect;

@Injectable()
export class UsuariosService {
  private readonly logger = new Logger(UsuariosService.name);

  /**
   * Perfis operacionais que podem ser gerenciados pelo GERENTE.
   */
  private readonly perfisOperacionais: PerfilAcesso[] = [
    PerfilAcesso.CAIXA,
    PerfilAcesso.ATENDENTE,
    PerfilAcesso.GARCOM,
  ];

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditoria: AuditoriaService,
  ) {}

  /**
   * CADASTRO DE USUÁRIO
   *
   * A empresa vem exclusivamente do JWT.
   * A senha é armazenada utilizando Argon2.
   * A criação e sua auditoria participam da mesma transação.
   */
  async criar(
    empresaId: string,
    atorId: string,
    atorPerfil: PerfilAcesso,
    dto: CriarUsuarioDto,
  ) {
    let usuarioIdAuditoria: string | undefined;

    try {
      const nome = dto.nome.trim();
      const email = dto.email.trim().toLowerCase();
      const perfil = dto.perfil ?? PerfilAcesso.CAIXA;

      this.validarPermissaoDePerfil(
        atorPerfil,
        undefined,
        perfil,
      );

      const hashSenha = await argon2.hash(dto.senha);

      return await this.prisma.$transaction(
        async (transacao) => {
          const usuario = await transacao.usuario.create({
            data: {
              empresaId,
              nome,
              email,
              hashSenha,
              perfil,
            },
            select: USUARIO_PUBLICO_SELECT,
          });

          usuarioIdAuditoria = usuario.id;

          await this.auditoria.registrar(
            {
              empresaId,
              atorId,
              tipoAtor: TipoAtorAuditoria.USUARIO_EMPRESA,
              modulo: 'USUARIOS',
              acao: 'CRIAR',
              entidade: 'USUARIO',
              entidadeId: usuario.id,
              resultado: ResultadoAuditoria.SUCESSO,
              dadosPosteriores: {
                nome: usuario.nome,
                perfil: usuario.perfil,
                ativo: usuario.ativo,
              },
              metadados: {
                emailCadastrado: true,
              },
            },
            transacao,
          );

          return usuario;
        },
      );
    } catch (erro) {
      await this.registrarFalhaAuditoria({
        empresaId,
        atorId,
        modulo: 'USUARIOS',
        acao: 'CRIAR',
        entidade: 'USUARIO',
        ...(usuarioIdAuditoria
          ? { entidadeId: usuarioIdAuditoria }
          : {}),
        motivo: this.obterClassificacaoErro(erro),
      });

      this.tratarErroPrisma(erro);
    }
  }
    /**
   * LISTAGEM DE USUÁRIOS
   *
   * Todas as consultas são limitadas à empresa autenticada.
   * A auditoria é concluída antes da entrega dos resultados.
   */
  async listar(
    empresaId: string,
    atorId: string,
    atorPerfil: PerfilAcesso,
    filtros: ListarUsuariosDto,
  ) {
    const pagina = filtros.pagina ?? 1;
    const limite = filtros.limite ?? 20;

    if (!Number.isInteger(pagina) || pagina < 1) {
      throw new BadRequestException(
        'A página deve ser um número inteiro maior que zero.',
      );
    }

    if (
      !Number.isInteger(limite) ||
      limite < 1 ||
      limite > 100
    ) {
      throw new BadRequestException(
        'O limite deve estar entre 1 e 100.',
      );
    }

    if (
      atorPerfil !== PerfilAcesso.ADMINISTRADOR &&
      atorPerfil !== PerfilAcesso.GERENTE
    ) {
      throw new ForbiddenException(
        'Seu perfil não pode gerenciar usuários.',
      );
    }

    const where: Prisma.UsuarioWhereInput = {
      empresaId,
    };

    const condicoes: Prisma.UsuarioWhereInput[] = [];

    if (filtros.ativo !== undefined) {
      where.ativo = filtros.ativo;
    }

    if (filtros.perfil !== undefined) {
      condicoes.push({
        perfil: filtros.perfil,
      });
    }

    // GERENTE só pode visualizar usuários operacionais.
    if (atorPerfil === PerfilAcesso.GERENTE) {
      condicoes.push({
        perfil: {
          in: this.perfisOperacionais,
        },
      });
    }

    const busca = filtros.busca?.trim();

    if (busca) {
      condicoes.push({
        OR: [
          {
            nome: {
              contains: busca,
              mode: 'insensitive',
            },
          },
          {
            email: {
              contains: busca,
              mode: 'insensitive',
            },
          },
        ],
      });
    }

    if (condicoes.length > 0) {
      where.AND = condicoes;
    }

    const [dados, total] = await this.prisma.$transaction([
      this.prisma.usuario.findMany({
        where,
        orderBy: {
          criadoEm: 'desc',
        },
        skip: (pagina - 1) * limite,
        take: limite,
        select: USUARIO_PUBLICO_SELECT,
      }),

      this.prisma.usuario.count({
        where,
      }),
    ]);

    const resultado = {
      dados,
      total,
      pagina,
      limite,
      totalPaginas: Math.ceil(total / limite),
    };

    // Registra somente os filtros seguros, nunca o texto pesquisado.
    await this.auditoria.registrar({
      empresaId,
      atorId,
      tipoAtor: TipoAtorAuditoria.USUARIO_EMPRESA,
      modulo: 'USUARIOS',
      acao: 'CONSULTAR_LISTA',
      entidade: 'USUARIO',
      resultado: ResultadoAuditoria.SUCESSO,
      metadados: {
        pagina,
        limite,
        filtroAtivo: filtros.ativo ?? null,
        filtroPerfil: filtros.perfil ?? null,
        buscaInformada: Boolean(busca),
        quantidadeRetornada: dados.length,
        totalRegistros: total,
      },
    });

    return resultado;
  }

  /**
   * CONSULTA INDIVIDUAL
   *
   * A identificação do usuário e da empresa é verificada
   * conjuntamente, impedindo consultas entre empresas.
   * A auditoria ocorre antes da entrega do resultado.
   */
  async buscarPorId(
    empresaId: string,
    atorId: string,
    atorPerfil: PerfilAcesso,
    id: string,
  ) {
    const usuario = await this.prisma.usuario.findFirst({
      where: {
        id,
        empresaId,
      },
      select: USUARIO_PUBLICO_SELECT,
    });

    if (!usuario) {
      throw new NotFoundException(
        'Usuário não encontrado.',
      );
    }

    this.validarPermissaoDePerfil(
      atorPerfil,
      usuario.perfil,
    );

    await this.auditoria.registrar({
      empresaId,
      atorId,
      tipoAtor: TipoAtorAuditoria.USUARIO_EMPRESA,
      modulo: 'USUARIOS',
      acao: 'CONSULTAR',
      entidade: 'USUARIO',
      entidadeId: id,
      resultado: ResultadoAuditoria.SUCESSO,
    });

    return usuario;
  }

  /**
   * ATUALIZAÇÃO DE USUÁRIO
   *
   * A consulta, a alteração e a auditoria acontecem
   * dentro da mesma transação.
   */
  async atualizar(
    empresaId: string,
    atorId: string,
    atorPerfil: PerfilAcesso,
    id: string,
    dto: AtualizarUsuarioDto,
  ) {
    try {
      const data: Prisma.UsuarioUpdateInput = {};
      const camposAlterados: string[] = [];

      if (dto.nome !== undefined) {
        data.nome = dto.nome.trim();
        camposAlterados.push('nome');
      }

      if (dto.email !== undefined) {
        data.email = dto.email.trim().toLowerCase();
        camposAlterados.push('email');
      }

      if (dto.senha !== undefined) {
        data.hashSenha = await argon2.hash(dto.senha);
        camposAlterados.push('senha');
      }

      if (dto.perfil !== undefined) {
        data.perfil = dto.perfil;
        camposAlterados.push('perfil');
      }

      if (camposAlterados.length === 0) {
        throw new BadRequestException(
          'Informe pelo menos um campo para atualização.',
        );
      }

      return await this.prisma.$transaction(
        async (transacao) => {
          const usuarioAnterior =
            await transacao.usuario.findFirst({
              where: {
                id,
                empresaId,
              },
              select: {
                id: true,
                nome: true,
                perfil: true,
                ativo: true,
              },
            });

          if (!usuarioAnterior) {
            throw new NotFoundException(
              'Usuário não encontrado.',
            );
          }

          this.validarPermissaoDePerfil(
            atorPerfil,
            usuarioAnterior.perfil,
            dto.perfil,
          );

          // Impede que o administrador altere o próprio nível de acesso.
          if (
            id === atorId &&
            dto.perfil !== undefined &&
            dto.perfil !== usuarioAnterior.perfil
          ) {
            throw new ForbiddenException(
              'Não é permitido alterar o próprio perfil.',
            );
          }

          // Preserva pelo menos um administrador ativo na empresa.
          if (
            usuarioAnterior.perfil === PerfilAcesso.ADMINISTRADOR &&
            dto.perfil !== undefined &&
            dto.perfil !== PerfilAcesso.ADMINISTRADOR &&
            usuarioAnterior.ativo
          ) {
            await this.garantirOutroAdministradorAtivo(
              transacao,
              empresaId,
              id,
            );
          }

          const usuarioAtualizado =
            await transacao.usuario.update({
              where: {
                id,
              },
              data,
              select: USUARIO_PUBLICO_SELECT,
            });

          await this.auditoria.registrar(
            {
              empresaId,
              atorId,
              tipoAtor: TipoAtorAuditoria.USUARIO_EMPRESA,
              modulo: 'USUARIOS',
              acao: 'ATUALIZAR',
              entidade: 'USUARIO',
              entidadeId: id,
              resultado: ResultadoAuditoria.SUCESSO,

              dadosAnteriores: {
                nome: usuarioAnterior.nome,
                perfil: usuarioAnterior.perfil,
                ativo: usuarioAnterior.ativo,
              },

              dadosPosteriores: {
                nome: usuarioAtualizado.nome,
                perfil: usuarioAtualizado.perfil,
                ativo: usuarioAtualizado.ativo,
              },

              metadados: {
                camposAlterados,
                emailAlterado: dto.email !== undefined,
                senhaAlterada: dto.senha !== undefined,
              },
            },
            transacao,
          );

          return usuarioAtualizado;
        },
        {
          isolationLevel:
            Prisma.TransactionIsolationLevel.Serializable,
        },
      );
    } catch (erro) {
      await this.registrarFalhaAuditoria({
        empresaId,
        atorId,
        modulo: 'USUARIOS',
        acao: 'ATUALIZAR',
        entidade: 'USUARIO',
        entidadeId: id,
        motivo: this.obterClassificacaoErro(erro),
      });

      this.tratarErroPrisma(erro);
    }
  }

  /**
   * ATIVAÇÃO E DESATIVAÇÃO
   *
   * Impede desativação da própria conta e remoção do
   * último administrador ativo da empresa.
   */
  async alterarAtivacao(
    empresaId: string,
    atorId: string,
    atorPerfil: PerfilAcesso,
    id: string,
    ativo: boolean,
  ) {
    try {
      return await this.prisma.$transaction(
        async (transacao) => {
          const usuarioAnterior =
            await transacao.usuario.findFirst({
              where: {
                id,
                empresaId,
              },
              select: {
                id: true,
                nome: true,
                perfil: true,
                ativo: true,
              },
            });

          if (!usuarioAnterior) {
            throw new NotFoundException(
              'Usuário não encontrado.',
            );
          }

          this.validarPermissaoDePerfil(
            atorPerfil,
            usuarioAnterior.perfil,
          );

          if (id === atorId && !ativo) {
            throw new ForbiddenException(
              'Não é permitido desativar a própria conta.',
            );
          }

          if (
            usuarioAnterior.perfil === PerfilAcesso.ADMINISTRADOR &&
            usuarioAnterior.ativo &&
            !ativo
          ) {
            await this.garantirOutroAdministradorAtivo(
              transacao,
              empresaId,
              id,
            );
          }

          const usuarioAtualizado =
            await transacao.usuario.update({
              where: {
                id,
              },
              data: {
                ativo,
              },
              select: USUARIO_PUBLICO_SELECT,
            });

          await this.auditoria.registrar(
            {
              empresaId,
              atorId,
              tipoAtor: TipoAtorAuditoria.USUARIO_EMPRESA,
              modulo: 'USUARIOS',
              acao: 'ALTERAR_ATIVACAO',
              entidade: 'USUARIO',
              entidadeId: id,
              resultado: ResultadoAuditoria.SUCESSO,

              dadosAnteriores: {
                nome: usuarioAnterior.nome,
                perfil: usuarioAnterior.perfil,
                ativo: usuarioAnterior.ativo,
              },

              dadosPosteriores: {
                nome: usuarioAtualizado.nome,
                perfil: usuarioAtualizado.perfil,
                ativo: usuarioAtualizado.ativo,
              },
            },
            transacao,
          );

          return usuarioAtualizado;
        },
        {
          isolationLevel:
            Prisma.TransactionIsolationLevel.Serializable,
        },
      );
    } catch (erro) {
      await this.registrarFalhaAuditoria({
        empresaId,
        atorId,
        modulo: 'USUARIOS',
        acao: 'ALTERAR_ATIVACAO',
        entidade: 'USUARIO',
        entidadeId: id,
        motivo: this.obterClassificacaoErro(erro),
      });

      this.tratarErroPrisma(erro);
    }
  }
    /**
   * CONTROLE DE PERMISSÕES
   *
   * ADMINISTRADOR gerencia todos os perfis.
   * GERENTE gerencia somente CAIXA, ATENDENTE e GARCOM.
   */
  private validarPermissaoDePerfil(
    atorPerfil: PerfilAcesso,
    perfilAlvo?: PerfilAcesso,
    perfilNovo?: PerfilAcesso,
  ): void {
    if (atorPerfil === PerfilAcesso.ADMINISTRADOR) {
      return;
    }

    if (atorPerfil !== PerfilAcesso.GERENTE) {
      throw new ForbiddenException(
        'Seu perfil não pode gerenciar usuários.',
      );
    }

    if (
      perfilAlvo !== undefined &&
      !this.perfisOperacionais.includes(perfilAlvo)
    ) {
      throw new ForbiddenException(
        'Gerentes não podem gerenciar usuários de nível administrativo.',
      );
    }

    if (
      perfilNovo !== undefined &&
      !this.perfisOperacionais.includes(perfilNovo)
    ) {
      throw new ForbiddenException(
        'Gerentes não podem atribuir perfis de nível administrativo.',
      );
    }
  }

  /**
   * Garante que exista outro administrador ativo antes
   * de retirar o perfil ou desativar um administrador.
   */
  private async garantirOutroAdministradorAtivo(
    transacao: Prisma.TransactionClient,
    empresaId: string,
    usuarioId: string,
  ): Promise<void> {
    const quantidade =
      await transacao.usuario.count({
        where: {
          empresaId,
          id: {
            not: usuarioId,
          },
          perfil: PerfilAcesso.ADMINISTRADOR,
          ativo: true,
        },
      });

    if (quantidade === 0) {
      throw new BadRequestException(
        'Não é possível remover o último administrador ativo da empresa.',
      );
    }
  }

  /**
   * REGISTRO DE FALHAS
   *
   * O registro ocorre fora da transação revertida.
   * Uma falha secundária não esconde o erro original.
   */
  private async registrarFalhaAuditoria(
    entrada: Omit<
      RegistrarEventoAuditoriaInput,
      'tipoAtor' | 'resultado'
    >,
  ): Promise<void> {
    try {
      await this.auditoria.registrar({
        ...entrada,
        tipoAtor: TipoAtorAuditoria.USUARIO_EMPRESA,
        resultado: ResultadoAuditoria.FALHA,
      });
    } catch (erroAuditoria) {
      this.logger.error(
        'Não foi possível registrar a falha na auditoria de usuários.',
        erroAuditoria instanceof Error
          ? erroAuditoria.stack
          : undefined,
      );
    }
  }

  /**
   * Classifica os erros sem guardar mensagens internas
   * ou informações sensíveis.
   */
  private obterClassificacaoErro(erro: unknown): string {
    return erro instanceof Error
      ? erro.constructor.name
      : 'ERRO_DESCONHECIDO';
  }

  /**
   * Trata erros conhecidos do Prisma.
   *
   * P2002: duplicidade de e-mail.
   * P2025: registro não encontrado.
   * P2034: conflito de transação concorrente.
   */
  private tratarErroPrisma(erro: unknown): never {
    if (
      erro instanceof Prisma.PrismaClientKnownRequestError &&
      erro.code === 'P2002'
    ) {
      throw new ConflictException(
        'Já existe um usuário cadastrado com este e-mail nesta empresa.',
      );
    }

    if (
      erro instanceof Prisma.PrismaClientKnownRequestError &&
      erro.code === 'P2025'
    ) {
      throw new NotFoundException(
        'Usuário não encontrado.',
      );
    }

    if (
      erro instanceof Prisma.PrismaClientKnownRequestError &&
      erro.code === 'P2034'
    ) {
      throw new ConflictException(
        'A gestão de usuários foi alterada simultaneamente. Atualize os dados e tente novamente.',
      );
    }

    throw erro;
  }
}