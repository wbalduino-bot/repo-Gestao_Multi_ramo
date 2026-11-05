
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Test, TestingModule } from '@nestjs/testing';

import { UnauthorizedException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';

import { PerfilAcesso } from '@prisma/client';

import {
  JwtAuthGuard,
  type RequisicaoAutenticada,
} from '../auth/strategies/jwt.strategy.js';

import { GerenciaGuard } from '../auth/guards/gerencia.guard.js';

import { UsuariosController } from './usuarios.controller.js';
import { UsuariosService } from './usuarios.service.js';

import { CriarUsuarioDto } from './dto/criar-usuario.dto.js';
import { AtualizarUsuarioDto } from './dto/atualizar-usuario.dto.js';
import { ListarUsuariosDto } from './dto/listar-usuarios.dto.js';
import { AtivarUsuarioDto } from './dto/ativar-usuario.dto.js';

/**
 * Cria uma requisição simulando os dados validados pela estratégia JWT.
 */
function criarRequisicao(
  usuario: {
    sub?: string;
    empresaId?: string;
    perfil?: string;
  } = {},
): RequisicaoAutenticada {
  return {
    user: {
      sub: 'usuario-1',
      empresaId: 'empresa-1',
      perfil: PerfilAcesso.ADMINISTRADOR,
      ...usuario,
    },
  } as unknown as RequisicaoAutenticada;
}

describe('UsuariosController', () => {
  let controller: UsuariosController;
  let modulo: TestingModule;
  let usuariosService: {
    criar: ReturnType<typeof vi.fn>;
    listar: ReturnType<typeof vi.fn>;
    buscarPorId: ReturnType<typeof vi.fn>;
    atualizar: ReturnType<typeof vi.fn>;
    alterarAtivacao: ReturnType<typeof vi.fn>;
  };

  const usuarioResposta = {
    id: 'usuario-2',
    nome: 'Funcionário Teste',
    email: 'funcionario@empresa.com',
    perfil: PerfilAcesso.CAIXA,
    ativo: true,
    criadoEm: new Date('2026-01-01T10:00:00.000Z'),
  };

  beforeEach(async () => {
    // Cada teste recebe mocks independentes do service.
    usuariosService = {
      criar: vi.fn().mockResolvedValue(usuarioResposta),

      listar: vi.fn().mockResolvedValue({
        dados: [usuarioResposta],
        total: 1,
        pagina: 1,
        limite: 20,
        totalPaginas: 1,
      }),

      buscarPorId: vi.fn().mockResolvedValue(usuarioResposta),

      atualizar: vi.fn().mockResolvedValue(usuarioResposta),

      alterarAtivacao: vi.fn().mockResolvedValue(usuarioResposta),
    };

    modulo = await Test.createTestingModule({
      controllers: [UsuariosController],
      providers: [
        {
          provide: UsuariosService,
          useValue: usuariosService,
        },
      ],
    })
      // Os testes do controller não precisam validar JWT real.
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: vi.fn(() => true),
      })
      // Simula também a autorização gerencial.
      .overrideGuard(GerenciaGuard)
      .useValue({
        canActivate: vi.fn(() => true),
      })
      .compile();

    controller = modulo.get<UsuariosController>(UsuariosController);
  });

  describe('obterUsuarioAutenticado', () => {
    it('deve retornar os dados de identidade da sessão autenticada', () => {
      const requisicao = criarRequisicao();

      const resultado =
        controller.obterUsuarioAutenticado(requisicao);

      expect(resultado).toEqual({
        usuarioId: 'usuario-1',
        empresaId: 'empresa-1',
        perfil: PerfilAcesso.ADMINISTRADOR,
      });

      expect(usuariosService.buscarPorId).not.toHaveBeenCalled();
    });

    it('deve rejeitar identidade sem identificador de usuário', () => {
      const requisicao = criarRequisicao({
        sub: undefined,
      });

      expect(() =>
        controller.obterUsuarioAutenticado(requisicao),
      ).toThrow(UnauthorizedException);
    });

    it('deve rejeitar identidade sem empresa vinculada', () => {
      const requisicao = criarRequisicao({
        empresaId: undefined,
      });

      expect(() =>
        controller.obterUsuarioAutenticado(requisicao),
      ).toThrow(UnauthorizedException);
    });

    it('deve rejeitar perfil de acesso inválido', () => {
      const requisicao = criarRequisicao({
        perfil: 'PERFIL_INVALIDO',
      });

      expect(() =>
        controller.obterUsuarioAutenticado(requisicao),
      ).toThrow(UnauthorizedException);
    });
  });

  describe('criar', () => {
    it('deve encaminhar empresa, ator, perfil e DTO ao service', async () => {
      const requisicao = criarRequisicao();

      const dto = {
        nome: 'Funcionário Teste',
        email: 'funcionario@empresa.com',
        senha: 'SenhaSegura123',
        perfil: PerfilAcesso.CAIXA,
      } as CriarUsuarioDto;

      const resultado = await controller.criar(
        requisicao,
        dto,
      );

      expect(usuariosService.criar).toHaveBeenCalledWith(
        'empresa-1',
        'usuario-1',
        PerfilAcesso.ADMINISTRADOR,
        dto,
      );

      expect(resultado).toEqual(usuarioResposta);
    });

    it('deve ignorar empresaId enviado no corpo e utilizar a empresa do JWT', async () => {
      const requisicao = criarRequisicao();

      // Simula uma tentativa de informar outra empresa pelo frontend.
      const dto = {
        nome: 'Funcionário Teste',
        email: 'funcionario@empresa.com',
        senha: 'SenhaSegura123',
        empresaId: 'empresa-2',
      } as unknown as CriarUsuarioDto;

      await controller.criar(requisicao, dto);

      expect(usuariosService.criar).toHaveBeenCalledWith(
        'empresa-1',
        'usuario-1',
        PerfilAcesso.ADMINISTRADOR,
        dto,
      );

      expect(usuariosService.criar).not.toHaveBeenCalledWith(
        'empresa-2',
        expect.anything(),
        expect.anything(),
        expect.anything(),
      );
    });
  });

  describe('listar', () => {
    it('deve encaminhar empresa, perfil e filtros ao service', async () => {
      const requisicao = criarRequisicao();

      const filtros = {
        pagina: 2,
        limite: 10,
        ativo: true,
      } as ListarUsuariosDto;

      const resultado = await controller.listar(
        requisicao,
        filtros,
      );

      expect(usuariosService.listar).toHaveBeenCalledWith(
        'empresa-1',
        'usuario-1',
        PerfilAcesso.ADMINISTRADOR,
        filtros,
      );

      expect(resultado).toEqual({
        dados: [usuarioResposta],
        total: 1,
        pagina: 1,
        limite: 20,
        totalPaginas: 1,
      });
    });
  });

  describe('buscarPorId', () => {
    it('deve encaminhar empresa, perfil e identificador ao service', async () => {
      const requisicao = criarRequisicao();

      const resultado = await controller.buscarPorId(
        requisicao,
        'usuario-2',
      );

      expect(usuariosService.buscarPorId).toHaveBeenCalledWith(
        'empresa-1',
        'usuario-1',
        PerfilAcesso.ADMINISTRADOR,
        'usuario-2',
      );

      expect(resultado).toEqual(usuarioResposta);
    });
  });

  describe('atualizar', () => {
    it('deve encaminhar empresa, ator, perfil, identificador e DTO ao service', async () => {
      const requisicao = criarRequisicao();

      const dto = {
        nome: 'Nome Atualizado',
      } as AtualizarUsuarioDto;

      const resultado = await controller.atualizar(
        requisicao,
        'usuario-2',
        dto,
      );

      expect(usuariosService.atualizar).toHaveBeenCalledWith(
        'empresa-1',
        'usuario-1',
        PerfilAcesso.ADMINISTRADOR,
        'usuario-2',
        dto,
      );

      expect(resultado).toEqual(usuarioResposta);
    });
  });

  describe('alterarAtivacao', () => {
    it('deve encaminhar empresa, ator, perfil, identificador e situação ao service', async () => {
      const requisicao = criarRequisicao();

      const dto = {
        ativo: false,
      } as AtivarUsuarioDto;

      const resultado = await controller.alterarAtivacao(
        requisicao,
        'usuario-2',
        dto,
      );

      expect(usuariosService.alterarAtivacao).toHaveBeenCalledWith(
        'empresa-1',
        'usuario-1',
        PerfilAcesso.ADMINISTRADOR,
        'usuario-2',
        false,
      );

      expect(resultado).toEqual(usuarioResposta);
    });
  });

  describe('proteção das rotas', () => {
    it('deve exigir somente JWT na rota de identidade', () => {
      const guards = Reflect.getMetadata(
        GUARDS_METADATA,
        UsuariosController.prototype.obterUsuarioAutenticado,
      );

      expect(guards).toEqual([JwtAuthGuard]);
    });

    it('deve exigir JWT e GerenciaGuard nas rotas administrativas', () => {
      const rotasProtegidas = [
        UsuariosController.prototype.criar,
        UsuariosController.prototype.listar,
        UsuariosController.prototype.buscarPorId,
        UsuariosController.prototype.atualizar,
        UsuariosController.prototype.alterarAtivacao,
      ];

      for (const rota of rotasProtegidas) {
        const guards = Reflect.getMetadata(
          GUARDS_METADATA,
          rota,
        );

        expect(guards).toEqual([
          JwtAuthGuard,
          GerenciaGuard,
        ]);
      }
    });

    it('não deve chamar o service quando a identidade for inválida', () => {
      const requisicao = criarRequisicao({
        sub: undefined,
      });

      const dto = {
        nome: 'Funcionário Teste',
        email: 'funcionario@empresa.com',
        senha: 'SenhaSegura123',
      } as CriarUsuarioDto;

      expect(() =>
        controller.criar(requisicao, dto),
      ).toThrow(UnauthorizedException);

      expect(usuariosService.criar).not.toHaveBeenCalled();
    });
  });
});
