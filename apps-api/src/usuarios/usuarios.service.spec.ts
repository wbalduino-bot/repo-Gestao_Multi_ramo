
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';

import {
  PerfilAcesso,
  Prisma,
  ResultadoAuditoria,
  TipoAtorAuditoria,
} from '@prisma/client';

import * as argon2 from 'argon2';

import { UsuariosService } from './usuarios.service.js';

import { CriarUsuarioDto } from './dto/criar-usuario.dto.js';
import { AtualizarUsuarioDto } from './dto/atualizar-usuario.dto.js';
import { ListarUsuariosDto } from './dto/listar-usuarios.dto.js';

// Evita executar o Argon2 real durante os testes.
vi.mock('argon2', () => ({
  hash: vi.fn(),
}));

/**
 * Retorna um usuário de exemplo sem incluir o hash da senha.
 */
function usuarioPublico(
  sobrescritos: Record<string, unknown> = {},
) {
  return {
    id: 'usuario-1',
    nome: 'Usuário de Teste',
    email: 'usuario@empresa.com',
    perfil: PerfilAcesso.CAIXA,
    ativo: true,
    criadoEm: new Date('2026-01-01T10:00:00.000Z'),
    ...sobrescritos,
  };
}

describe('UsuariosService', () => {
  let service: UsuariosService;
  let prisma: any;
  let transacao: any;
  let auditoria: any;

  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(argon2.hash).mockResolvedValue('hash-seguro');

    // Simula as operações do Prisma dentro de uma transação.
    transacao = {
      usuario: {
        create: vi.fn(),
        findFirst: vi.fn(),
        update: vi.fn(),
        count: vi.fn(),
      },
    };

    auditoria = {
      registrar: vi.fn().mockResolvedValue(undefined),
    };

    prisma = {
      usuario: {
        findMany: vi.fn().mockResolvedValue([]),
        findFirst: vi.fn().mockResolvedValue(null),
        count: vi.fn().mockResolvedValue(0),
      },

      // Aceita tanto transações por callback quanto transações por array.
      $transaction: vi.fn(async (operacao: unknown) => {
        if (typeof operacao === 'function') {
          return operacao(transacao);
        }

        return Promise.all(operacao as Promise<unknown>[]);
      }),
    };

    service = new UsuariosService(
      prisma as never,
      auditoria as never,
    );
  });

  describe('criar', () => {
    it('deve criar usuário vinculado à empresa autenticada e registrar auditoria', async () => {
      const usuario = usuarioPublico({
        nome: 'Novo Usuário',
        email: 'novo@empresa.com',
      });

      transacao.usuario.create.mockResolvedValue(usuario);

      const dto = {
        nome: '  Novo Usuário  ',
        email: '  NOVO@EMPRESA.COM ',
        senha: 'SenhaSegura123',
      } as CriarUsuarioDto;

      const resultado = await service.criar(
        'empresa-1',
        'administrador-1',
        PerfilAcesso.ADMINISTRADOR,
        dto,
      );

      expect(argon2.hash).toHaveBeenCalledWith('SenhaSegura123');

      expect(transacao.usuario.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            empresaId: 'empresa-1',
            nome: 'Novo Usuário',
            email: 'novo@empresa.com',
            hashSenha: 'hash-seguro',
            perfil: PerfilAcesso.CAIXA,
          },
          select: expect.not.objectContaining({
            hashSenha: true,
          }),
        }),
      );

      expect(auditoria.registrar).toHaveBeenCalledWith(
        expect.objectContaining({
          empresaId: 'empresa-1',
          atorId: 'administrador-1',
          tipoAtor: TipoAtorAuditoria.USUARIO_EMPRESA,
          modulo: 'USUARIOS',
          acao: 'CRIAR',
          entidade: 'USUARIO',
          resultado: ResultadoAuditoria.SUCESSO,
        }),
        transacao,
      );

      expect(resultado).toEqual(usuario);
      expect(resultado).not.toHaveProperty('hashSenha');
    });

    it('não deve permitir que GERENTE crie usuário administrador', async () => {
      const dto = {
        nome: 'Administrador',
        email: 'admin@empresa.com',
        senha: 'SenhaSegura123',
        perfil: PerfilAcesso.ADMINISTRADOR,
      } as CriarUsuarioDto;

      await expect(
        service.criar(
          'empresa-1',
          'gerente-1',
          PerfilAcesso.GERENTE,
          dto,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);

      expect(transacao.usuario.create).not.toHaveBeenCalled();

      expect(auditoria.registrar).toHaveBeenCalledWith(
        expect.objectContaining({
          acao: 'CRIAR',
          resultado: ResultadoAuditoria.FALHA,
        }),
      );
    });

    it('deve converter e-mail duplicado em conflito', async () => {
      const erro = new Prisma.PrismaClientKnownRequestError(
        'E-mail duplicado',
        {
          code: 'P2002',
          clientVersion: 'test',
        },
      );

      prisma.$transaction.mockRejectedValueOnce(erro);

      const dto = {
        nome: 'Novo Usuário',
        email: 'novo@empresa.com',
        senha: 'SenhaSegura123',
      } as CriarUsuarioDto;

      await expect(
        service.criar(
          'empresa-1',
          'administrador-1',
          PerfilAcesso.ADMINISTRADOR,
          dto,
        ),
      ).rejects.toBeInstanceOf(ConflictException);

      expect(auditoria.registrar).toHaveBeenCalledWith(
        expect.objectContaining({
          acao: 'CRIAR',
          resultado: ResultadoAuditoria.FALHA,
        }),
      );
    });
  });

  describe('listar', () => {
    it('deve limitar a listagem à empresa e aos perfis operacionais do GERENTE e auditar a consulta', async () => {
      const usuario = usuarioPublico();

      prisma.usuario.findMany.mockResolvedValue([usuario]);
      prisma.usuario.count.mockResolvedValue(1);

      const filtros = {
        pagina: 2,
        limite: 5,
        ativo: true,
        busca: '  Jo  ',
      } as ListarUsuariosDto;

      const resultado = await service.listar(
        'empresa-1',
        'gerente-1',
        PerfilAcesso.GERENTE,
        filtros,
      );

      expect(prisma.usuario.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            empresaId: 'empresa-1',
            ativo: true,
            AND: expect.arrayContaining([
              {
                perfil: {
                  in: [
                    PerfilAcesso.CAIXA,
                    PerfilAcesso.ATENDENTE,
                    PerfilAcesso.GARCOM,
                  ],
                },
              },
              {
                OR: [
                  {
                    nome: {
                      contains: 'Jo',
                      mode: 'insensitive',
                    },
                  },
                  {
                    email: {
                      contains: 'Jo',
                      mode: 'insensitive',
                    },
                  },
                ],
              },
            ]),
          }),
          skip: 5,
          take: 5,
        }),
      );

      expect(prisma.usuario.count).toHaveBeenCalledWith({
        where: expect.objectContaining({
          empresaId: 'empresa-1',
        }),
      });

      expect(auditoria.registrar).toHaveBeenCalledWith(
        expect.objectContaining({
          empresaId: 'empresa-1',
          atorId: 'gerente-1',
          tipoAtor: TipoAtorAuditoria.USUARIO_EMPRESA,
          modulo: 'USUARIOS',
          acao: 'CONSULTAR_LISTA',
          entidade: 'USUARIO',
          resultado: ResultadoAuditoria.SUCESSO,
          metadados: {
            pagina: 2,
            limite: 5,
            filtroAtivo: true,
            filtroPerfil: null,
            buscaInformada: true,
            quantidadeRetornada: 1,
            totalRegistros: 1,
          },
        }),
      );

      // O conteúdo digitado na busca nunca deve ser armazenado na auditoria.
      const dadosAuditoria = JSON.stringify(
        auditoria.registrar.mock.calls[0][0],
      );

      expect(dadosAuditoria).not.toContain('Jo');
      expect(dadosAuditoria).not.toContain('usuario@empresa.com');

      expect(resultado).toEqual({
        dados: [usuario],
        total: 1,
        pagina: 2,
        limite: 5,
        totalPaginas: 1,
      });
    });

    it('não deve entregar a listagem quando o registro da auditoria falhar', async () => {
      prisma.usuario.findMany.mockResolvedValue([
        usuarioPublico(),
      ]);
      prisma.usuario.count.mockResolvedValue(1);
      auditoria.registrar.mockRejectedValue(
        new Error('Auditoria indisponível'),
      );

      await expect(
        service.listar(
          'empresa-1',
          'administrador-1',
          PerfilAcesso.ADMINISTRADOR,
          {} as ListarUsuariosDto,
        ),
      ).rejects.toThrow('Auditoria indisponível');

      expect(prisma.usuario.findMany).toHaveBeenCalled();
      expect(prisma.usuario.count).toHaveBeenCalled();
      expect(auditoria.registrar).toHaveBeenCalledTimes(1);
    });

    it('não deve permitir que perfil operacional liste usuários', async () => {
      await expect(
        service.listar(
          'empresa-1',
          'caixa-1',
          PerfilAcesso.CAIXA,
          {} as ListarUsuariosDto,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);

      expect(prisma.usuario.findMany).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(auditoria.registrar).not.toHaveBeenCalled();
    });

    it('deve rejeitar paginação inválida', async () => {
      await expect(
        service.listar(
          'empresa-1',
          'administrador-1',
          PerfilAcesso.ADMINISTRADOR,
          {
            pagina: 0,
          } as ListarUsuariosDto,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(prisma.usuario.findMany).not.toHaveBeenCalled();
      expect(auditoria.registrar).not.toHaveBeenCalled();
    });
  });

  describe('buscarPorId', () => {
    it('deve consultar o usuário pelo identificador e pela empresa e auditar a consulta', async () => {
      const usuario = usuarioPublico();

      prisma.usuario.findFirst.mockResolvedValue(usuario);

      const resultado = await service.buscarPorId(
        'empresa-1',
        'gerente-1',
        PerfilAcesso.GERENTE,
        'usuario-1',
      );

      expect(prisma.usuario.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: 'usuario-1',
            empresaId: 'empresa-1',
          },
          select: expect.not.objectContaining({
            hashSenha: true,
          }),
        }),
      );

      expect(auditoria.registrar).toHaveBeenCalledWith(
        expect.objectContaining({
          empresaId: 'empresa-1',
          atorId: 'gerente-1',
          tipoAtor: TipoAtorAuditoria.USUARIO_EMPRESA,
          modulo: 'USUARIOS',
          acao: 'CONSULTAR',
          entidade: 'USUARIO',
          entidadeId: 'usuario-1',
          resultado: ResultadoAuditoria.SUCESSO,
        }),
      );

      expect(resultado).toEqual(usuario);
    });

    it('não deve entregar o usuário quando o registro da auditoria falhar', async () => {
      prisma.usuario.findFirst.mockResolvedValue(
        usuarioPublico(),
      );
      auditoria.registrar.mockRejectedValue(
        new Error('Auditoria indisponível'),
      );

      await expect(
        service.buscarPorId(
          'empresa-1',
          'administrador-1',
          PerfilAcesso.ADMINISTRADOR,
          'usuario-1',
        ),
      ).rejects.toThrow('Auditoria indisponível');

      expect(prisma.usuario.findFirst).toHaveBeenCalled();
      expect(auditoria.registrar).toHaveBeenCalledTimes(1);
    });

    it('não deve encontrar usuário pertencente a outra empresa', async () => {
      prisma.usuario.findFirst.mockResolvedValue(null);

      await expect(
        service.buscarPorId(
          'empresa-1',
          'administrador-1',
          PerfilAcesso.ADMINISTRADOR,
          'usuario-de-outra-empresa',
        ),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(prisma.usuario.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: 'usuario-de-outra-empresa',
            empresaId: 'empresa-1',
          },
        }),
      );

      expect(auditoria.registrar).not.toHaveBeenCalled();
    });

    it('não deve permitir que GERENTE consulte usuário administrador', async () => {
      prisma.usuario.findFirst.mockResolvedValue(
        usuarioPublico({
          perfil: PerfilAcesso.ADMINISTRADOR,
        }),
      );

      await expect(
        service.buscarPorId(
          'empresa-1',
          'gerente-1',
          PerfilAcesso.GERENTE,
          'administrador-1',
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);

      expect(auditoria.registrar).not.toHaveBeenCalled();
    });
  });

  describe('atualizar', () => {
    it('deve atualizar usuário, registrar auditoria e usar isolamento Serializable', async () => {
      const usuarioAnterior = usuarioPublico();

      const usuarioAtualizado = usuarioPublico({
        nome: 'Nome Atualizado',
      });

      transacao.usuario.findFirst.mockResolvedValue(usuarioAnterior);
      transacao.usuario.update.mockResolvedValue(usuarioAtualizado);

      const resultado = await service.atualizar(
        'empresa-1',
        'administrador-1',
        PerfilAcesso.ADMINISTRADOR,
        'usuario-1',
        {
          nome: '  Nome Atualizado  ',
        } as AtualizarUsuarioDto,
      );

      expect(transacao.usuario.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: 'usuario-1',
          },
          data: {
            nome: 'Nome Atualizado',
          },
        }),
      );

      expect(prisma.$transaction).toHaveBeenCalledWith(
        expect.any(Function),
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        },
      );

      expect(auditoria.registrar).toHaveBeenCalledWith(
        expect.objectContaining({
          empresaId: 'empresa-1',
          atorId: 'administrador-1',
          acao: 'ATUALIZAR',
          resultado: ResultadoAuditoria.SUCESSO,
        }),
        transacao,
      );

      expect(resultado).toEqual(usuarioAtualizado);
    });

    it('deve rejeitar atualização sem campos informados', async () => {
      await expect(
        service.atualizar(
          'empresa-1',
          'administrador-1',
          PerfilAcesso.ADMINISTRADOR,
          'usuario-1',
          {} as AtualizarUsuarioDto,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(prisma.$transaction).not.toHaveBeenCalled();

      expect(auditoria.registrar).toHaveBeenCalledWith(
        expect.objectContaining({
          acao: 'ATUALIZAR',
          resultado: ResultadoAuditoria.FALHA,
        }),
      );
    });

    it('não deve permitir que GERENTE altere usuário administrador', async () => {
      transacao.usuario.findFirst.mockResolvedValue(
        usuarioPublico({
          perfil: PerfilAcesso.ADMINISTRADOR,
        }),
      );

      await expect(
        service.atualizar(
          'empresa-1',
          'gerente-1',
          PerfilAcesso.GERENTE,
          'administrador-1',
          {
            nome: 'Tentativa de alteração',
          } as AtualizarUsuarioDto,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);

      expect(transacao.usuario.update).not.toHaveBeenCalled();
    });

    it('não deve permitir que usuário altere o próprio perfil', async () => {
      transacao.usuario.findFirst.mockResolvedValue(
        usuarioPublico({
          id: 'administrador-1',
          perfil: PerfilAcesso.ADMINISTRADOR,
        }),
      );

      await expect(
        service.atualizar(
          'empresa-1',
          'administrador-1',
          PerfilAcesso.ADMINISTRADOR,
          'administrador-1',
          {
            perfil: PerfilAcesso.GERENTE,
          } as AtualizarUsuarioDto,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);

      expect(transacao.usuario.update).not.toHaveBeenCalled();
    });

    it('não deve permitir remover o último administrador ativo', async () => {
      transacao.usuario.findFirst.mockResolvedValue(
        usuarioPublico({
          perfil: PerfilAcesso.ADMINISTRADOR,
          ativo: true,
        }),
      );

      transacao.usuario.count.mockResolvedValue(0);

      await expect(
        service.atualizar(
          'empresa-1',
          'outro-administrador',
          PerfilAcesso.ADMINISTRADOR,
          'administrador-1',
          {
            perfil: PerfilAcesso.GERENTE,
          } as AtualizarUsuarioDto,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(transacao.usuario.count).toHaveBeenCalled();
      expect(transacao.usuario.update).not.toHaveBeenCalled();
    });

    it('deve converter conflito de transação em erro de conflito', async () => {
      const erro = new Prisma.PrismaClientKnownRequestError(
        'Conflito de transação',
        {
          code: 'P2034',
          clientVersion: 'test',
        },
      );

      prisma.$transaction.mockRejectedValueOnce(erro);

      await expect(
        service.atualizar(
          'empresa-1',
          'administrador-1',
          PerfilAcesso.ADMINISTRADOR,
          'usuario-1',
          {
            nome: 'Nome Atualizado',
          } as AtualizarUsuarioDto,
        ),
      ).rejects.toBeInstanceOf(ConflictException);

      expect(auditoria.registrar).toHaveBeenCalledWith(
        expect.objectContaining({
          acao: 'ATUALIZAR',
          resultado: ResultadoAuditoria.FALHA,
        }),
      );
    });
  });

  describe('alterarAtivacao', () => {
    it('deve ativar usuário, registrar auditoria e usar isolamento Serializable', async () => {
      const usuarioAnterior = usuarioPublico({
        ativo: false,
      });

      const usuarioAtualizado = usuarioPublico({
        ativo: true,
      });

      transacao.usuario.findFirst.mockResolvedValue(usuarioAnterior);
      transacao.usuario.update.mockResolvedValue(usuarioAtualizado);

      const resultado = await service.alterarAtivacao(
        'empresa-1',
        'administrador-1',
        PerfilAcesso.ADMINISTRADOR,
        'usuario-1',
        true,
      );

      expect(transacao.usuario.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: 'usuario-1',
          },
          data: {
            ativo: true,
          },
        }),
      );

      expect(prisma.$transaction).toHaveBeenCalledWith(
        expect.any(Function),
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        },
      );

      expect(auditoria.registrar).toHaveBeenCalledWith(
        expect.objectContaining({
          empresaId: 'empresa-1',
          acao: 'ALTERAR_ATIVACAO',
          resultado: ResultadoAuditoria.SUCESSO,
        }),
        transacao,
      );

      expect(resultado).toEqual(usuarioAtualizado);
    });

    it('não deve permitir desativar a própria conta', async () => {
      transacao.usuario.findFirst.mockResolvedValue(
        usuarioPublico({
          id: 'administrador-1',
          perfil: PerfilAcesso.ADMINISTRADOR,
        }),
      );

      await expect(
        service.alterarAtivacao(
          'empresa-1',
          'administrador-1',
          PerfilAcesso.ADMINISTRADOR,
          'administrador-1',
          false,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);

      expect(transacao.usuario.update).not.toHaveBeenCalled();
    });

    it('não deve permitir desativar o último administrador ativo', async () => {
      transacao.usuario.findFirst.mockResolvedValue(
        usuarioPublico({
          perfil: PerfilAcesso.ADMINISTRADOR,
          ativo: true,
        }),
      );

      transacao.usuario.count.mockResolvedValue(0);

      await expect(
        service.alterarAtivacao(
          'empresa-1',
          'outro-administrador',
          PerfilAcesso.ADMINISTRADOR,
          'administrador-1',
          false,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(transacao.usuario.count).toHaveBeenCalled();
      expect(transacao.usuario.update).not.toHaveBeenCalled();
    });
  });
});
