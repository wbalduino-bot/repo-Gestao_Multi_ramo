import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditoriaService } from '../auditoria/auditoria.service.js';
import { CategoriasService } from './categorias.service.js';

/** Mocks garantem testes sem escrita no PostgreSQL. */
describe('CategoriasService', () => {
  const tx = { categoria: { findFirst: vi.fn(), create: vi.fn(), updateMany: vi.fn() } };
  const prisma = {
    categoria: { findMany: vi.fn() },
    $transaction: vi.fn((fn: (arg: typeof tx) => unknown) => fn(tx)),
  };
  const auditoria = { registrar: vi.fn() };
  let service: CategoriasService;
  beforeEach(() => {
    vi.resetAllMocks();
    prisma.$transaction.mockImplementation((fn: (arg: typeof tx) => unknown) => fn(tx));
    tx.categoria.findFirst.mockResolvedValue(null);
    tx.categoria.create.mockResolvedValue({ id: 'categoria-nova', nome: 'Bebidas', categoriaPaiId: null });
    tx.categoria.updateMany.mockResolvedValue({ count: 1 });
    auditoria.registrar.mockResolvedValue({ id: 'log-1' });
    service = new CategoriasService(prisma as unknown as PrismaService, auditoria as unknown as AuditoriaService);
  });

  it('lista exclusivamente categorias da empresa autenticada', async () => {
    prisma.categoria.findMany.mockResolvedValue([]);
    await service.listar('empresa-A');
    expect(prisma.categoria.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { empresaId: 'empresa-A' } }));
    expect(auditoria.registrar).not.toHaveBeenCalled();
  });

  it('rejeita categoria pai de outra empresa', async () => {
    await expect(service.criar('empresa-A', 'usuario-A', { nome: 'Bebidas', categoriaPaiId: 'categoria-outra-empresa' }))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(tx.categoria.create).not.toHaveBeenCalled();
  });

  it('cadastra categoria e registra auditoria na mesma transação', async () => {
    const resposta = await service.criar('empresa-A', 'usuario-A', { nome: 'Bebidas' });
    expect(resposta.id).toBe('categoria-nova');
    expect(tx.categoria.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ empresaId: 'empresa-A' }) }));
    expect(auditoria.registrar).toHaveBeenCalledWith(expect.objectContaining({ empresaId: 'empresa-A', atorId: 'usuario-A', acao: 'CRIAR' }), tx);
  });

  it('recusa cadastro duplicado no mesmo nível', async () => {
    tx.categoria.findFirst.mockResolvedValue({ id: 'categoria-existente' });
    await expect(service.criar('empresa-A', 'usuario-A', { nome: 'Bebidas' }))
      .rejects.toBeInstanceOf(ConflictException);
    expect(tx.categoria.create).not.toHaveBeenCalled();
  });

  it('não confirma cadastro quando auditoria falha', async () => {
    auditoria.registrar.mockRejectedValue(new Error('Falha de auditoria'));
    await expect(service.criar('empresa-A', 'usuario-A', { nome: 'Bebidas' })).rejects.toThrow('Falha de auditoria');
  });

  describe('editar', () => {
    const anterior = { id: 'categoria-A', nome: 'Cerveja Amstel 350ml', categoriaPaiId: null };

    it('não edita categoria inexistente ou pertencente a outra empresa', async () => {
      tx.categoria.findFirst.mockResolvedValue(null);
      await expect(service.editar('empresa-A', 'usuario-A', 'categoria-A', { nome: 'Cervejas' }))
        .rejects.toBeInstanceOf(NotFoundException);
      expect(tx.categoria.findFirst).toHaveBeenCalledWith(expect.objectContaining({
        where: { id: 'categoria-A', empresaId: 'empresa-A' },
      }));
      expect(tx.categoria.updateMany).not.toHaveBeenCalled();
    });

    it('atualiza nome e registra valores anteriores e posteriores na transação', async () => {
      tx.categoria.findFirst.mockResolvedValueOnce(anterior).mockResolvedValueOnce(null);
      const resultado = await service.editar('empresa-A', 'usuario-A', 'categoria-A', { nome: 'Cervejas' });
      expect(resultado.nome).toBe('Cervejas');
      expect(tx.categoria.updateMany).toHaveBeenCalledWith({
        where: { id: 'categoria-A', empresaId: 'empresa-A' },
        data: { nome: 'Cervejas', categoriaPaiId: null },
      });
      expect(auditoria.registrar).toHaveBeenCalledWith(expect.objectContaining({
        empresaId: 'empresa-A', atorId: 'usuario-A', acao: 'ATUALIZAR',
        dadosAnteriores: { nome: anterior.nome, categoriaPaiId: null },
        dadosPosteriores: { nome: 'Cervejas', categoriaPaiId: null },
      }), tx);
    });

    it('rejeita uma categoria como sua própria categoria-pai', async () => {
      tx.categoria.findFirst.mockResolvedValueOnce(anterior);
      await expect(service.editar('empresa-A', 'usuario-A', 'categoria-A', { categoriaPaiId: 'categoria-A' }))
        .rejects.toBeInstanceOf(BadRequestException);
      expect(tx.categoria.updateMany).not.toHaveBeenCalled();
    });

    it('rejeita escolher uma categoria descendente como pai', async () => {
      tx.categoria.findFirst
        .mockResolvedValueOnce(anterior)
        .mockResolvedValueOnce({ id: 'categoria-filha', categoriaPaiId: 'categoria-A' });
      await expect(service.editar('empresa-A', 'usuario-A', 'categoria-A', { categoriaPaiId: 'categoria-filha' }))
        .rejects.toBeInstanceOf(BadRequestException);
      expect(tx.categoria.updateMany).not.toHaveBeenCalled();
    });

    it('rejeita categoria-pai de outra empresa', async () => {
      tx.categoria.findFirst.mockResolvedValueOnce(anterior).mockResolvedValueOnce(null);
      await expect(service.editar('empresa-A', 'usuario-A', 'categoria-A', { categoriaPaiId: 'outra-categoria' }))
        .rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejeita nome duplicado no mesmo nível', async () => {
      tx.categoria.findFirst.mockResolvedValueOnce(anterior).mockResolvedValueOnce({ id: 'outra-categoria' });
      await expect(service.editar('empresa-A', 'usuario-A', 'categoria-A', { nome: 'Bebidas' }))
        .rejects.toBeInstanceOf(ConflictException);
    });

    it('não confirma atualização se a auditoria falhar', async () => {
      tx.categoria.findFirst.mockResolvedValueOnce(anterior).mockResolvedValueOnce(null);
      auditoria.registrar.mockRejectedValue(new Error('Falha de auditoria'));
      await expect(service.editar('empresa-A', 'usuario-A', 'categoria-A', { nome: 'Cervejas' }))
        .rejects.toThrow('Falha de auditoria');
    });
  });
});
