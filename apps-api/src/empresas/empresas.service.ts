import {
  BadRequestException,
  ConflictException,
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

import { CriarEmpresaDto } from './dto/criar-empresa.dto.js';
import {
  AdministradorEmpresaInicialDto,
  CriarEmpresaComAdministradoresDto,
} from './dto/criar-empresa-com-administradores.dto.js';
import { AtualizarEmpresaDto } from './dto/atualizar-empresa.dto.js';
import { ListarEmpresasDto } from './dto/listar-empresas.dto.js';

import type { RegistrarEventoAuditoriaInput } from '../auditoria/auditoria.service.js';

/**
 * Remove a pontuação do CNPJ e normaliza letras.
 */
function normalizarCnpj(cnpj: string): string {
  return cnpj.replace(/[./-]/g, '').toUpperCase();
}

/**
 * Valida o CNPJ numérico ou alfanumérico.
 *
 * Mantém a regra de cálculo já existente no projeto.
 */
function cnpjValido(cnpjInformado: string): boolean {
  const cnpj = normalizarCnpj(cnpjInformado);

  if (!/^[A-Z0-9]{12}\d{2}$/.test(cnpj)) {
    return false;
  }

  if (/^(\w)\1+$/.test(cnpj)) {
    return false;
  }

  const calcularDigito = (base: string): number => {
    const pesos =
      base.length === 12
        ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
        : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];

    // A entrada já foi validada como ASCII; o índice preserva o alinhamento dos pesos.
    let soma = 0;

    for (let indice = 0; indice < base.length; indice += 1) {
      soma += (base.charCodeAt(indice) - 48) * pesos[indice];
    }

    const resto = soma % 11;

    return resto < 2 ? 0 : 11 - resto;
  };

  const base = cnpj.slice(0, 12);
  const primeiro = calcularDigito(base);
  const segundo = calcularDigito(base + primeiro);

  return cnpj.endsWith(`${primeiro}${segundo}`);
}

@Injectable()
export class EmpresasService {
  private readonly logger = new Logger(EmpresasService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditoria: AuditoriaService,
  ) {}

  /**
   * Cadastra uma empresa.
   *
   * A criação e a auditoria de sucesso participam da mesma
   * transação. Se a auditoria falhar, a empresa não será criada.
   */
  async criar(
    administradorId: string,
    dto: CriarEmpresaDto,
  ) {
    let empresaIdAuditoria: string | undefined;

    try {
      const cnpj = normalizarCnpj(dto.cnpj);

      if (!cnpjValido(cnpj)) {
        throw new BadRequestException('CNPJ inválido.');
      }

      return await this.prisma.$transaction(
        async (transacao) => {
          const empresa = await transacao.empresa.create({
            data: {
              nome: dto.nome.trim(),
              cnpj,
            },
          });

          empresaIdAuditoria = empresa.id;

          await this.auditoria.registrar(
            {
              atorId: administradorId,
              tipoAtor: TipoAtorAuditoria.ADMIN_PLATAFORMA,
              modulo: 'EMPRESAS',
              acao: 'CRIAR',
              entidade: 'EMPRESA',
              entidadeId: empresa.id,
              resultado: ResultadoAuditoria.SUCESSO,
              dadosPosteriores: {
                nome: empresa.nome,
                ativo: empresa.ativo,
              },
            },
            transacao,
          );

          return empresa;
        },
      );
    } catch (erro) {
      await this.registrarFalhaAuditoria({
        atorId: administradorId,
        modulo: 'EMPRESAS',
        acao: 'CRIAR',
        entidade: 'EMPRESA',
        ...(empresaIdAuditoria
          ? { entidadeId: empresaIdAuditoria }
          : {}),
        motivo: this.obterClassificacaoErro(erro),
      });

      this.tratarErroPrisma(erro);
    }
  }

  /**
   * Provisiona uma empresa e seus administradores em uma única transação.
   *
   * O administrador SaaS é identificado pelo token administrativo.
   * O EmpresaId é gerado pelo banco e nunca é definido pelo frontend.
   * Se qualquer gravação ou auditoria falhar, a transação é revertida.
   */
  async criarComAdministradores(
    administradorPlataformaId: string,
    dto: CriarEmpresaComAdministradoresDto,
  ) {
    try {
      const cnpj = normalizarCnpj(dto.cnpj);
      if (!cnpjValido(cnpj)) {
        throw new BadRequestException('CNPJ inválido.');
      }

      const administradores = await this.prepararAdministradores(
        dto.administradores,
      );

      return await this.prisma.$transaction(async (transacao) => {
        const empresa = await transacao.empresa.create({
          data: { nome: dto.nome.trim(), cnpj },
        });

        // A identidade SaaS é a responsável técnica por este provisionamento.
        await this.auditoria.registrar(
          {
            atorId: administradorPlataformaId,
            tipoAtor: TipoAtorAuditoria.ADMIN_PLATAFORMA,
            modulo: 'EMPRESAS',
            acao: 'CRIAR_COM_ADMINISTRADORES',
            entidade: 'EMPRESA',
            entidadeId: empresa.id,
            resultado: ResultadoAuditoria.SUCESSO,
            dadosPosteriores: {
              nome: empresa.nome,
              ativo: empresa.ativo,
            },
            metadados: {
              quantidadeAdministradores: administradores.length,
            },
          },
          transacao,
        );

        const usuarios = [];
        for (const administrador of administradores) {
          const usuario = await transacao.usuario.create({
            data: {
              empresaId: empresa.id,
              nome: administrador.nome,
              email: administrador.email,
              hashSenha: administrador.hashSenha,
              perfil: PerfilAcesso.ADMINISTRADOR,
            },
            select: {
              id: true,
              nome: true,
              email: true,
              perfil: true,
              ativo: true,
              criadoEm: true,
            },
          });

          // Não inclui senha, hash ou e-mail nos metadados da auditoria.
          await this.auditoria.registrar(
            {
              atorId: administradorPlataformaId,
              tipoAtor: TipoAtorAuditoria.ADMIN_PLATAFORMA,
              modulo: 'USUARIOS',
              acao: 'PROVISIONAR_ADMINISTRADOR',
              entidade: 'USUARIO',
              entidadeId: usuario.id,
              resultado: ResultadoAuditoria.SUCESSO,
              dadosPosteriores: {
                perfil: usuario.perfil,
                ativo: usuario.ativo,
              },
              metadados: {
                empresaAlvoId: empresa.id,
              },
            },
            transacao,
          );

          usuarios.push(usuario);
        }

        return { empresa, administradores: usuarios };
      });
    } catch (erro) {
      await this.registrarFalhaAuditoria({
        atorId: administradorPlataformaId,
        modulo: 'EMPRESAS',
        acao: 'CRIAR_COM_ADMINISTRADORES',
        entidade: 'EMPRESA',
        motivo: this.obterClassificacaoErro(erro),
      });
      this.tratarErroPrisma(erro);
    }
  }

  /**
   * Adiciona um administrador a uma empresa existente pelo painel SaaS.
   * O ID da empresa vem da rota protegida, jamais de um campo do formulário.
   */
  async adicionarAdministradorEmpresa(
    administradorPlataformaId: string,
    empresaId: string,
    dto: AdministradorEmpresaInicialDto,
  ) {
    try {
      // O helper exige pelo menos um administrador e rejeita entradas vazias.
      const administrador = (await this.prepararAdministradores([dto]))[0]!;

      return await this.prisma.$transaction(async (transacao) => {
        const empresa = await transacao.empresa.findUnique({
          where: { id: empresaId },
          select: { id: true },
        });

        if (!empresa) {
          throw new NotFoundException('Empresa não encontrada.');
        }

        const usuario = await transacao.usuario.create({
          data: {
            empresaId: empresa.id,
            nome: administrador.nome,
            email: administrador.email,
            hashSenha: administrador.hashSenha,
            perfil: PerfilAcesso.ADMINISTRADOR,
          },
          select: {
            id: true,
            nome: true,
            email: true,
            perfil: true,
            ativo: true,
            criadoEm: true,
          },
        });

        // A criação e o evento de auditoria têm o mesmo destino transacional.
        await this.auditoria.registrar(
          {
            atorId: administradorPlataformaId,
            tipoAtor: TipoAtorAuditoria.ADMIN_PLATAFORMA,
            modulo: 'USUARIOS',
            acao: 'PROVISIONAR_ADMINISTRADOR',
            entidade: 'USUARIO',
            entidadeId: usuario.id,
            resultado: ResultadoAuditoria.SUCESSO,
            dadosPosteriores: {
              perfil: usuario.perfil,
              ativo: usuario.ativo,
            },
            metadados: {
              empresaAlvoId: empresa.id,
            },
          },
          transacao,
        );

        return usuario;
      });
    } catch (erro) {
      // Sem empresaId no registro de falha: a empresa pode não existir.
      await this.registrarFalhaAuditoria({
        atorId: administradorPlataformaId,
        modulo: 'USUARIOS',
        acao: 'PROVISIONAR_ADMINISTRADOR',
        entidade: 'USUARIO',
        motivo: this.obterClassificacaoErro(erro),
      });
      this.tratarErroPrisma(erro);
    }
  }

  /**
   * Lista apenas administradores da empresa solicitada pelo painel SaaS.
   * Nunca retorna a coluna hashSenha.
   */
  async listarAdministradoresEmpresa(
    administradorPlataformaId: string,
    empresaId: string,
  ) {
    const empresa = await this.prisma.empresa.findUnique({
      where: { id: empresaId },
      select: { id: true },
    });
    if (!empresa) {
      throw new NotFoundException('Empresa não encontrada.');
    }

    const usuarios = await this.prisma.usuario.findMany({
      where: {
        empresaId: empresa.id,
        perfil: PerfilAcesso.ADMINISTRADOR,
      },
      orderBy: { nome: 'asc' },
      select: {
        id: true,
        nome: true,
        email: true,
        perfil: true,
        ativo: true,
        criadoEm: true,
      },
    });

    // O acesso à listagem é registrado antes da entrega dos dados.
    await this.auditoria.registrar({
      atorId: administradorPlataformaId,
      tipoAtor: TipoAtorAuditoria.ADMIN_PLATAFORMA,
      modulo: 'USUARIOS',
      acao: 'CONSULTAR_LISTA',
      entidade: 'USUARIO',
      resultado: ResultadoAuditoria.SUCESSO,
      metadados: {
        empresaAlvoId: empresa.id,
        perfil: PerfilAcesso.ADMINISTRADOR,
        quantidadeRetornada: usuarios.length,
      },
    });

    return usuarios;
  }

  /**
   * Normaliza os administradores e gera hash Argon2 fora da transação.
   * Evita duplicação de e-mail na mesma requisição e não persiste senha bruta.
   */
  private async prepararAdministradores(
    entradas: AdministradorEmpresaInicialDto[],
  ) {
    if (!Array.isArray(entradas) || entradas.length < 1 || entradas.length > 10) {
      throw new BadRequestException('Informe de 1 a 10 administradores.');
    }

    const emails = new Set<string>();
    const administradores = [];

    for (const entrada of entradas) {
      const nome = entrada.nome.trim();
      const email = entrada.email.trim().toLowerCase();

      if (emails.has(email)) {
        throw new BadRequestException('Há e-mails de administradores repetidos.');
      }
      emails.add(email);

      administradores.push({
        nome,
        email,
        hashSenha: await argon2.hash(entrada.senha),
      });
    }

    return administradores;
  }

  /**
   * Lista as empresas com paginação e filtro de situação.
   */
  async listar(
    _administradorId: string,
    filtros: ListarEmpresasDto,
  ) {
    const pagina = filtros.pagina ?? 1;
    const limite = filtros.limite ?? 20;

    const where: Prisma.EmpresaWhereInput = {};

    if (filtros.ativo !== undefined) {
      where.ativo = filtros.ativo;
    }

    const [dados, total] = await this.prisma.$transaction([
      this.prisma.empresa.findMany({
        where,
        orderBy: {
          criadoEm: 'desc',
        },
        skip: (pagina - 1) * limite,
        take: limite,
      }),

      this.prisma.empresa.count({
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

    // Consulta rotineira: não gera evento persistente a cada atualização da tela.

    return resultado;
  }

  /**
   * Busca uma empresa pelo identificador.
   */
  async buscarPorId(
    administradorId: string,
    id: string,
  ) {
    const empresa = await this.prisma.empresa.findUnique({
      where: { id },
    });

    if (!empresa) {
      throw new NotFoundException(
        'Empresa não encontrada.',
      );
    }

    // Não entrega os dados se o registro da consulta falhar.
    await this.auditoria.registrar({
      atorId: administradorId,
      tipoAtor: TipoAtorAuditoria.ADMIN_PLATAFORMA,
      modulo: 'EMPRESAS',
      acao: 'CONSULTAR',
      entidade: 'EMPRESA',
      entidadeId: id,
      resultado: ResultadoAuditoria.SUCESSO,
    });

    return empresa;
  }

  /**
   * Atualiza os dados cadastrais da empresa.
   *
   * O estado anterior é consultado dentro da transação.
   * A alteração e seu evento de auditoria são confirmados juntos.
   */
  async atualizar(
    administradorId: string,
    id: string,
    dto: AtualizarEmpresaDto,
  ) {
    try {
      const data: Prisma.EmpresaUpdateInput = {};

      if (dto.nome !== undefined) {
        data.nome = dto.nome.trim();
      }

      if (dto.cnpj !== undefined) {
        const cnpj = normalizarCnpj(dto.cnpj);

        if (!cnpjValido(cnpj)) {
          throw new BadRequestException('CNPJ inválido.');
        }

        data.cnpj = cnpj;
      }

      if (dto.ativo !== undefined) {
        data.ativo = dto.ativo;
      }

      return await this.prisma.$transaction(
        async (transacao) => {
          const empresaAnterior =
            await transacao.empresa.findUnique({
              where: { id },
              select: {
                id: true,
                nome: true,
                ativo: true,
              },
            });

          if (!empresaAnterior) {
            throw new NotFoundException(
              'Empresa não encontrada.',
            );
          }

          const empresaAtualizada =
            await transacao.empresa.update({
              where: { id },
              data,
            });

          await this.auditoria.registrar(
            {
              atorId: administradorId,
              tipoAtor: TipoAtorAuditoria.ADMIN_PLATAFORMA,
              modulo: 'EMPRESAS',
              acao: 'ATUALIZAR',
              entidade: 'EMPRESA',
              entidadeId: id,
              resultado: ResultadoAuditoria.SUCESSO,

              dadosAnteriores: {
                nome: empresaAnterior.nome,
                ativo: empresaAnterior.ativo,
              },

              dadosPosteriores: {
                nome: empresaAtualizada.nome,
                ativo: empresaAtualizada.ativo,
              },

              metadados: {
                camposAlterados: Object.keys(data),
                cnpjAlterado: dto.cnpj !== undefined,
              },
            },
            transacao,
          );

          return empresaAtualizada;
        },
      );
    } catch (erro) {
      await this.registrarFalhaAuditoria({
        atorId: administradorId,
        modulo: 'EMPRESAS',
        acao: 'ATUALIZAR',
        entidade: 'EMPRESA',
        entidadeId: id,
        motivo: this.obterClassificacaoErro(erro),
      });

      this.tratarErroPrisma(erro);
    }
  }

  /**
   * Ativa ou desativa uma empresa.
   *
   * O estado anterior, a alteração e a auditoria são tratados
   * dentro de uma única transação.
   */
  async alterarAtivacao(
    administradorId: string,
    id: string,
    ativo: boolean,
  ) {
    try {
      return await this.prisma.$transaction(
        async (transacao) => {
          const empresaAnterior =
            await transacao.empresa.findUnique({
              where: { id },
              select: {
                id: true,
                nome: true,
                ativo: true,
              },
            });

          if (!empresaAnterior) {
            throw new NotFoundException(
              'Empresa não encontrada.',
            );
          }

          const empresaAtualizada =
            await transacao.empresa.update({
              where: { id },
              data: { ativo },
            });

          await this.auditoria.registrar(
            {
              atorId: administradorId,
              tipoAtor: TipoAtorAuditoria.ADMIN_PLATAFORMA,
              modulo: 'EMPRESAS',
              acao: 'ALTERAR_ATIVACAO',
              entidade: 'EMPRESA',
              entidadeId: id,
              resultado: ResultadoAuditoria.SUCESSO,

              dadosAnteriores: {
                nome: empresaAnterior.nome,
                ativo: empresaAnterior.ativo,
              },

              dadosPosteriores: {
                nome: empresaAtualizada.nome,
                ativo: empresaAtualizada.ativo,
              },
            },
            transacao,
          );

          return empresaAtualizada;
        },
      );
    } catch (erro) {
      await this.registrarFalhaAuditoria({
        atorId: administradorId,
        modulo: 'EMPRESAS',
        acao: 'ALTERAR_ATIVACAO',
        entidade: 'EMPRESA',
        entidadeId: id,
        motivo: this.obterClassificacaoErro(erro),
      });

      this.tratarErroPrisma(erro);
    }
  }

  /**
   * Registra falhas fora da transação revertida.
   *
   * Uma falha secundária da auditoria não pode esconder
   * o erro original da operação administrativa.
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
        tipoAtor: TipoAtorAuditoria.ADMIN_PLATAFORMA,
        resultado: ResultadoAuditoria.FALHA,
      });
    } catch (erroAuditoria) {
      this.logger.error(
        'Não foi possível registrar a falha na auditoria de empresas.',
        erroAuditoria instanceof Error
          ? erroAuditoria.stack
          : undefined,
      );
    }
  }

  /**
   * Classifica a falha sem armazenar mensagens internas,
   * dados enviados pelo cliente ou informações sensíveis.
   */
  private obterClassificacaoErro(erro: unknown): string {
    return erro instanceof Error
      ? erro.constructor.name
      : 'ERRO_DESCONHECIDO';
  }

  /**
   * Converte erros conhecidos do Prisma em exceções HTTP.
   *
   * P2002: violação de unicidade.
   * P2025: registro necessário não encontrado.
   */
  private tratarErroPrisma(erro: unknown): never {
    if (
      erro instanceof Prisma.PrismaClientKnownRequestError &&
      erro.code === 'P2002'
    ) {
      throw new ConflictException(
        'Já existe uma empresa cadastrada com este CNPJ.',
      );
    }

    if (
      erro instanceof Prisma.PrismaClientKnownRequestError &&
      erro.code === 'P2025'
    ) {
      throw new NotFoundException(
        'Empresa não encontrada.',
      );
    }

    throw erro;
  }
}