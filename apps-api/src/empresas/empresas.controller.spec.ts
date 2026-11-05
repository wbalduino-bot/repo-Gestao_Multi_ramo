import { Test, TestingModule } from '@nestjs/testing';

import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import { EmpresasController } from './empresas.controller.js';
import { EmpresasService } from './empresas.service.js';

import { AdminPlataformaGuard } from '../admin-plataforma/guards/admin-plataforma.guard.js';

import type { RequisicaoAdminPlataforma } from '../admin-plataforma/guards/admin-plataforma.guard.js';

const ADMINISTRADOR_ID =
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

describe('EmpresasController', () => {
  let controller: EmpresasController;

  const service = {
    criar: vi.fn(),
    listar: vi.fn(),
    buscarPorId: vi.fn(),
    atualizar: vi.fn(),
    alterarAtivacao: vi.fn(),
  };

  const requisicao = {
    user: {
      sub: ADMINISTRADOR_ID,
      tipo: 'ADMIN_PLATAFORMA' as const,
    },
  } as RequisicaoAdminPlataforma;

  beforeEach(async () => {
    vi.resetAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [
        EmpresasController,
      ],
      providers: [
        {
          provide: EmpresasService,
          useValue: service,
        },
      ],
    })
      // Simula a autorização administrativa nos testes.
      .overrideGuard(AdminPlataformaGuard)
      .useValue({
        canActivate: vi.fn(() => true),
      })
      .compile();

    controller = module.get<EmpresasController>(
      EmpresasController,
    );
  });

  it('deve estar definido', () => {
    expect(controller).toBeDefined();
  });

  it('deve encaminhar o cadastro e a identidade do administrador para o service', async () => {
    const dto = {
      nome: 'Mercado Exemplo',
      cnpj: '11222333000181',
    };

    service.criar.mockResolvedValue({
      id: 'empresa-1',
      ...dto,
    });

    await expect(
      controller.criar(requisicao, dto),
    ).resolves.toMatchObject(dto);

    expect(service.criar).toHaveBeenCalledWith(
      ADMINISTRADOR_ID,
      dto,
    );
  });

  it('deve encaminhar a atualização e a identidade do administrador para o service', async () => {
    const dto = {
      nome: 'Mercado Atualizado',
    };

    service.atualizar.mockResolvedValue({
      id: 'empresa-1',
      nome: 'Mercado Atualizado',
    });

    await expect(
      controller.atualizar(
        requisicao,
        'empresa-1',
        dto,
      ),
    ).resolves.toMatchObject(dto);

    expect(service.atualizar).toHaveBeenCalledWith(
      ADMINISTRADOR_ID,
      'empresa-1',
      dto,
    );
  });

  it('deve encaminhar a ativação e a identidade do administrador para o service', async () => {
    const dto = {
      ativo: false,
    };

    service.alterarAtivacao.mockResolvedValue({
      id: 'empresa-1',
      ativo: false,
    });

    await expect(
      controller.alterarAtivacao(
        requisicao,
        'empresa-1',
        dto,
      ),
    ).resolves.toMatchObject(dto);

    expect(service.alterarAtivacao).toHaveBeenCalledWith(
      ADMINISTRADOR_ID,
      'empresa-1',
      false,
    );
  });

  it('deve impedir operação administrativa sem identidade validada', () => {
    const requisicaoSemAdministrador = {
      user: undefined,
    } as RequisicaoAdminPlataforma;

    expect(() =>
      controller.criar(
        requisicaoSemAdministrador,
        {
          nome: 'Mercado Exemplo',
          cnpj: '11222333000181',
        },
      ),
    ).toThrow(
      'Identidade administrativa não encontrada.',
    );

    expect(service.criar).not.toHaveBeenCalled();
  });

  it('deve encaminhar a listagem e a identidade do administrador para o service', async () => {
    const filtros = {
      pagina: 1,
      limite: 20,
    };

    service.listar.mockResolvedValue({
      dados: [],
      total: 0,
      pagina: 1,
      limite: 20,
      totalPaginas: 0,
    });

    await controller.listar(requisicao, filtros);

    expect(service.listar).toHaveBeenCalledWith(ADMINISTRADOR_ID, filtros);
  });

  it('deve encaminhar a consulta de empresa para o service', async () => {
    service.buscarPorId.mockResolvedValue({
      id: 'empresa-1',
      nome: 'Mercado Exemplo',
    });

    await controller.buscarPorId(requisicao, 'empresa-1');

    expect(service.buscarPorId).toHaveBeenCalledWith(
      ADMINISTRADOR_ID,
      'empresa-1',
    );
  });
});