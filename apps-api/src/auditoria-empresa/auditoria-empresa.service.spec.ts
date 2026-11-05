import { BadRequestException } from '@nestjs/common';
import { ResultadoAuditoria, TipoAtorAuditoria } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditoriaEmpresaService } from './auditoria-empresa.service.js';

/** Verifica isolamento de empresas, minimização e ausência de autoauditoria. */
describe('AuditoriaEmpresaService', () => {
  const prisma = {
    eventoAuditoria: { findMany: vi.fn(), count: vi.fn() },
    usuario: { findMany: vi.fn() },
    $transaction: vi.fn(async (promessas: Promise<unknown>[]) => Promise.all(promessas)),
  };
  let service: AuditoriaEmpresaService;
  beforeEach(() => {
    vi.resetAllMocks();
    prisma.eventoAuditoria.findMany.mockResolvedValue([]);
    prisma.eventoAuditoria.count.mockResolvedValue(0);
    prisma.usuario.findMany.mockResolvedValue([]);
    prisma.$transaction.mockImplementation(async (promessas: Promise<unknown>[]) => Promise.all(promessas));
    service = new AuditoriaEmpresaService(prisma as unknown as PrismaService);
  });

  it('restringe todas as consultas à empresa autenticada e exclui eventos SaaS', async () => {
    await service.listar('empresa-a', {});
    const where = prisma.eventoAuditoria.findMany.mock.calls[0][0].where;
    expect(where.AND).toEqual(expect.arrayContaining([
      { empresaId: 'empresa-a' },
      { OR: [
        { tipoAtor: TipoAtorAuditoria.USUARIO_EMPRESA },
        { tipoAtor: TipoAtorAuditoria.ANONIMO, modulo: 'AUTH', acao: 'LOGIN' },
      ] },
    ]));
    expect(prisma.eventoAuditoria.count.mock.calls[0][0].where).toEqual(where);
  });

  it('não retorna payload sensível e resolve nomes apenas dentro da empresa', async () => {
    prisma.eventoAuditoria.findMany.mockResolvedValue([{
      id: 'evento-1', atorId: 'usuario-1', tipoAtor: TipoAtorAuditoria.USUARIO_EMPRESA,
      modulo: 'VENDAS', acao: 'CRIAR', resultado: ResultadoAuditoria.SUCESSO,
      criadoEm: new Date(), motivo: null, requestId: null, entidade: 'VENDA', entidadeId: 'venda-1',
    }]);
    prisma.usuario.findMany.mockResolvedValue([{ id: 'usuario-1', nome: 'Caixa 01' }]);
    const resposta = await service.listar('empresa-a', {});
    expect(prisma.usuario.findMany).toHaveBeenCalledWith({
      where: { empresaId: 'empresa-a', id: { in: ['usuario-1'] } },
      select: { id: true, nome: true },
    });
    expect(resposta.dados[0].responsavel).toBe('Caixa 01');
    expect(prisma.eventoAuditoria.findMany.mock.calls[0][0].select).not.toHaveProperty('metadados');
    expect(prisma.eventoAuditoria.findMany.mock.calls[0][0].select).not.toHaveProperty('dadosAnteriores');
    expect(prisma.eventoAuditoria.findMany.mock.calls[0][0].select).not.toHaveProperty('dadosPosteriores');
  });

  it('não gera auditoria automaticamente ao consultar auditoria', async () => {
    await service.listar('empresa-a', {});
    expect(prisma.eventoAuditoria.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.usuario.findMany).not.toHaveBeenCalled();
  });

  it('rejeita paginação e períodos inválidos antes de consultar o banco', async () => {
    await expect(service.listar('empresa-a', { limite: 51 })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.listar('empresa-a', {
      inicio: '2025-01-01T00:00:00Z', fim: '2026-01-01T00:00:00Z',
    })).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.eventoAuditoria.findMany).not.toHaveBeenCalled();
  });

  it('suporta filtros de responsável, módulo e resultado', async () => {
    await service.listar('empresa-a', {
      atorId: 'usuario-1', modulo: 'ESTOQUE', resultado: ResultadoAuditoria.FALHA,
    });
    expect(prisma.eventoAuditoria.findMany.mock.calls[0][0].where.AND).toEqual(
      expect.arrayContaining([
        { atorId: 'usuario-1' }, { modulo: 'ESTOQUE' },
        { resultado: ResultadoAuditoria.FALHA },
      ]),
    );
  });
});
