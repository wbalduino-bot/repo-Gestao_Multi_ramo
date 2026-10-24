
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EmpresasService } from './empresas.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

describe('EmpresasService', () => {
  let service: EmpresasService;

  const prisma = {
    empresa: {
      create: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    $transaction: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    service = new EmpresasService(prisma as unknown as PrismaService);
  });

  it('deve cadastrar empresa com CNPJ válido', async () => {
    const empresa = {
      id: 'empresa-1',
      nome: 'Mercado Exemplo',
      cnpj: '11222333000181',
      ativo: true,
      criadoEm: new Date(),
    };

    prisma.empresa.create.mockResolvedValue(empresa);

    await expect(
      service.criar({
        nome: 'Mercado Exemplo',
        cnpj: '11.222.333/0001-81',
      }),
    ).resolves.toEqual(empresa);

    expect(prisma.empresa.create).toHaveBeenCalledWith({
      data: {
        nome: 'Mercado Exemplo',
        cnpj: '11222333000181',
      },
    });
  });

  it('deve rejeitar CNPJ inválido', async () => {
    await expect(
      service.criar({
        nome: 'Mercado Exemplo',
        cnpj: '11.111.111/1111-11',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(prisma.empresa.create).not.toHaveBeenCalled();
  });

  it('deve retornar erro quando empresa não existir', async () => {
    prisma.empresa.findUnique.mockResolvedValue(null);

    await expect(
      service.buscarPorId('id-inexistente'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('deve permitir desativar uma empresa', async () => {
    prisma.empresa.update.mockResolvedValue({
      id: 'empresa-1',
      nome: 'Mercado Exemplo',
      cnpj: '11222333000181',
      ativo: false,
      criadoEm: new Date(),
    });

    const resultado = await service.alterarAtivacao(
      'empresa-1',
      false,
    );

    expect(resultado.ativo).toBe(false);
    expect(prisma.empresa.update).toHaveBeenCalledWith({
      where: { id: 'empresa-1' },
      data: { ativo: false },
    });
  });

  it('deve remover espaços extras do nome no cadastro', async () => {
    prisma.empresa.create.mockResolvedValue({
      id: 'empresa-1',
      nome: 'Mercado Exemplo',
      cnpj: '11222333000181',
      ativo: true,
      criadoEm: new Date(),
    });

    await service.criar({
      nome: '  Mercado Exemplo  ',
      cnpj: '11222333000181',
    });

    expect(prisma.empresa.create).toHaveBeenCalledWith({
      data: {
        nome: 'Mercado Exemplo',
        cnpj: '11222333000181',
      },
    });
  });

  it('deve rejeitar CNPJ inválido na atualização', async () => {
    await expect(
      service.atualizar('empresa-1', {
        cnpj: '11.111.111/1111-11',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(prisma.empresa.update).not.toHaveBeenCalled();
  });

  it('deve remover espaços extras do nome na atualização', async () => {
    prisma.empresa.update.mockResolvedValue({
      id: 'empresa-1',
      nome: 'Mercado Exemplo',
      cnpj: '11222333000181',
      ativo: true,
      criadoEm: new Date(),
    });

    await service.atualizar('empresa-1', {
      nome: '  Mercado Exemplo  ',
    });

    expect(prisma.empresa.update).toHaveBeenCalledWith({
      where: { id: 'empresa-1' },
      data: { nome: 'Mercado Exemplo' },
    });
  });

  it('deve permitir reativar uma empresa', async () => {
    prisma.empresa.update.mockResolvedValue({
      id: 'empresa-1',
      nome: 'Mercado Exemplo',
      cnpj: '11222333000181',
      ativo: true,
      criadoEm: new Date(),
    });

    const resultado = await service.alterarAtivacao(
      'empresa-1',
      true,
    );

    expect(resultado.ativo).toBe(true);
    expect(prisma.empresa.update).toHaveBeenCalledWith({
      where: { id: 'empresa-1' },
      data: { ativo: true },
    });
  });
});
