
import { Test, TestingModule } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { EmpresasController } from './empresas.controller.js';
import { EmpresasService } from './empresas.service.js';
import { AdminPlataformaGuard } from '../admin-plataforma/guards/admin-plataforma.guard.js';

describe('EmpresasController', () => {
  let controller: EmpresasController;

  // Simula os métodos do serviço para testar o controller isoladamente.
  const service = {
    criar: vi.fn(),
    listar: vi.fn(),
    buscarPorId: vi.fn(),
    atualizar: vi.fn(),
    alterarAtivacao: vi.fn(),
  };

  beforeEach(async () => {
    // Limpa as chamadas anteriores dos mocks antes de cada teste.
    vi.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [EmpresasController],
      providers: [
        {
          provide: EmpresasService,
          useValue: service,
        },
      ],
    })
      // Simula a autorização administrativa apenas durante os testes.
      // O guard real continua sendo utilizado na aplicação.
      .overrideGuard(AdminPlataformaGuard)
      .useValue({
        canActivate: vi.fn(() => true),
      })
      .compile();

    controller = module.get<EmpresasController>(EmpresasController);
  });

  it('deve estar definido', () => {
    expect(controller).toBeDefined();
  });

  it('deve encaminhar o cadastro para o service', async () => {
    const dto = {
      nome: 'Mercado Exemplo',
      cnpj: '11222333000181',
    };

    service.criar.mockResolvedValue({
      id: 'empresa-1',
      ...dto,
    });

    await expect(controller.criar(dto)).resolves.toMatchObject(dto);

    expect(service.criar).toHaveBeenCalledWith(dto);
  });
});
