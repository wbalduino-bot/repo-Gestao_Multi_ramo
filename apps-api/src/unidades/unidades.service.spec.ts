import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditoriaService } from '../auditoria/auditoria.service.js';
import { UnidadesService } from './unidades.service.js';

/** Testa operações sem depender do banco de dados real. */
describe('UnidadesService', () => {
  const tx = { unidade: { create: vi.fn(), findFirst: vi.fn(), updateMany: vi.fn() }, produto: { count: vi.fn() } };
  const prisma = {
    unidade: { findMany: vi.fn() },
    $transaction: vi.fn((fn: (arg: typeof tx) => unknown) => fn(tx)),
  };
  const auditoria = { registrar: vi.fn() };
  let service: UnidadesService;
  beforeEach(() => {
    vi.resetAllMocks();
    prisma.$transaction.mockImplementation((fn: (arg: typeof tx) => unknown) => fn(tx));
    tx.unidade.create.mockResolvedValue({ id: 'unidade-nova', codigo: 'UN', nome: 'Unidade' });
    tx.unidade.findFirst.mockResolvedValue(null);
    tx.unidade.updateMany.mockResolvedValue({ count: 1 });
    tx.produto.count.mockResolvedValue(0);
    auditoria.registrar.mockResolvedValue({ id: 'log-1' });
    service = new UnidadesService(prisma as unknown as PrismaService, auditoria as unknown as AuditoriaService);
  });

  it('lista somente unidades da empresa autenticada', async () => {
    prisma.unidade.findMany.mockResolvedValue([]);
    await service.listar('empresa-A');
    expect(prisma.unidade.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { empresaId: 'empresa-A' } }));
    expect(auditoria.registrar).not.toHaveBeenCalled();
  });

  it('cadastra com empresa do JWT e registra auditoria na mesma transação', async () => {
    const resultado = await service.criar('empresa-A', 'usuario-A', { codigo: 'UN', nome: 'Unidade' });
    expect(resultado.codigo).toBe('UN');
    expect(tx.unidade.create).toHaveBeenCalledWith(expect.objectContaining({ data: { empresaId: 'empresa-A', codigo: 'UN', nome: 'Unidade' } }));
    expect(auditoria.registrar).toHaveBeenCalledWith(expect.objectContaining({ empresaId: 'empresa-A', atorId: 'usuario-A', acao: 'CRIAR' }), tx);
  });

  it('recusa resultado sem auditoria confirmada', async () => {
    auditoria.registrar.mockRejectedValue(new Error('Falha de auditoria'));
    await expect(service.criar('empresa-A', 'usuario-A', { codigo: 'UN', nome: 'Unidade' })).rejects.toThrow('Falha de auditoria');
  });

  describe('editar', () => {
    const anterior = { id: 'unidade-A', codigo: 'ML', nome: 'ml' };

    it('rejeita unidade inexistente ou pertencente a outra empresa', async () => {
      await expect(service.editar('empresa-A', 'usuario-A', 'unidade-A', { nome: 'Mililitro' }))
        .rejects.toBeInstanceOf(NotFoundException);
      expect(tx.unidade.findFirst).toHaveBeenCalledWith(expect.objectContaining({
        where: { id: 'unidade-A', empresaId: 'empresa-A' },
      }));
      expect(tx.unidade.updateMany).not.toHaveBeenCalled();
    });

    it('corrige a descrição mantendo código e registra auditoria transacional', async () => {
      tx.unidade.findFirst.mockResolvedValueOnce(anterior);
      const resultado = await service.editar('empresa-A', 'usuario-A', 'unidade-A', { nome: 'Mililitro' });
      expect(resultado).toEqual({ id: 'unidade-A', codigo: 'ML', nome: 'Mililitro' });
      expect(tx.produto.count).not.toHaveBeenCalled();
      expect(tx.unidade.updateMany).toHaveBeenCalledWith({
        where: { id: 'unidade-A', empresaId: 'empresa-A' },
        data: { codigo: 'ML', nome: 'Mililitro' },
      });
      expect(auditoria.registrar).toHaveBeenCalledWith(expect.objectContaining({
        empresaId: 'empresa-A', atorId: 'usuario-A', acao: 'ATUALIZAR',
        dadosAnteriores: { codigo: 'ML', nome: 'ml' },
        dadosPosteriores: { codigo: 'ML', nome: 'Mililitro' },
      }), tx);
    });

    it('permite corrigir o código de uma unidade ainda não utilizada', async () => {
      tx.unidade.findFirst.mockResolvedValueOnce(anterior).mockResolvedValueOnce(null);
      const resultado = await service.editar('empresa-A', 'usuario-A', 'unidade-A', { codigo: 'L' });
      expect(resultado.codigo).toBe('L');
      expect(tx.produto.count).toHaveBeenCalledWith({ where: { empresaId: 'empresa-A', unidadeId: 'unidade-A' } });
    });

    it('impede mudar código quando existem produtos vinculados', async () => {
      tx.unidade.findFirst.mockResolvedValueOnce(anterior);
      tx.produto.count.mockResolvedValueOnce(1);
      await expect(service.editar('empresa-A', 'usuario-A', 'unidade-A', { codigo: 'KG' }))
        .rejects.toBeInstanceOf(ConflictException);
      expect(tx.unidade.updateMany).not.toHaveBeenCalled();
      expect(auditoria.registrar).not.toHaveBeenCalled();
    });

    it('impede código duplicado dentro da empresa', async () => {
      tx.unidade.findFirst.mockResolvedValueOnce(anterior).mockResolvedValueOnce({ id: 'outra-unidade' });
      await expect(service.editar('empresa-A', 'usuario-A', 'unidade-A', { codigo: 'UN' }))
        .rejects.toBeInstanceOf(ConflictException);
      expect(tx.unidade.updateMany).not.toHaveBeenCalled();
    });

    it('recusa edição sem alterações', async () => {
      tx.unidade.findFirst.mockResolvedValueOnce(anterior);
      await expect(service.editar('empresa-A', 'usuario-A', 'unidade-A', { nome: 'ml' }))
        .rejects.toBeInstanceOf(BadRequestException);
    });

    it('não confirma atualização quando a auditoria falha', async () => {
      tx.unidade.findFirst.mockResolvedValueOnce(anterior);
      auditoria.registrar.mockRejectedValueOnce(new Error('Falha de auditoria'));
      await expect(service.editar('empresa-A', 'usuario-A', 'unidade-A', { nome: 'Mililitro' }))
        .rejects.toThrow('Falha de auditoria');
    });
  });
});
