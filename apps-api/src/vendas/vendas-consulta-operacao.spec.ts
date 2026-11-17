import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { AuditoriaService } from '../auditoria/auditoria.service.js';
import { VendasService } from './vendas.service.js';
import type { LoginRateLimitService } from '../auth/login-rate-limit.service.js';

describe('Consulta do resultado por chave de operacao', () => {
  const chave = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const db = { usuario: { findFirst: vi.fn() }, venda: { findFirst: vi.fn() } };
  let service: VendasService;
  const buscar = vi.fn();
  beforeEach(() => {
    vi.resetAllMocks();
    db.usuario.findFirst.mockResolvedValue({ id: 'usuario-A' });
    db.venda.findFirst.mockResolvedValue(null);
    service = new VendasService(db as unknown as PrismaService, {} as AuditoriaService, {} as LoginRateLimitService);
    buscar.mockResolvedValue({ id: 'venda', total: 10 });
    vi.spyOn(service, 'buscarPorId').mockImplementation(buscar);
  });
  it('consulta somente a empresa e o usuario autenticados', async () => {
    await expect(service.buscarPorOperacao('empresa-A', 'usuario-A', chave)).resolves.toEqual({ situacao: 'NAO_LOCALIZADA' });
    expect(db.venda.findFirst).toHaveBeenCalledWith({ where: { empresaId: 'empresa-A', usuarioId: 'usuario-A', chaveOperacao: chave }, select: { id: true } });
  });
  it('recupera os valores historicos sem criar venda ou movimentar estoque', async () => {
    db.venda.findFirst.mockResolvedValue({ id: 'venda' });
    await expect(service.buscarPorOperacao('empresa-A', 'usuario-A', chave)).resolves.toEqual({ situacao: 'CONCLUIDA', venda: { id: 'venda', total: 10 } });
    expect(buscar).toHaveBeenCalledWith('empresa-A', 'venda');
  });
  it('recusa usuario inativo antes de consultar a venda', async () => {
    db.usuario.findFirst.mockResolvedValue(null);
    await expect(service.buscarPorOperacao('empresa-A', 'usuario-A', chave)).rejects.toBeInstanceOf(ForbiddenException);
    expect(db.venda.findFirst).not.toHaveBeenCalled();
  });
  it('recusa chave invalida em chamada direta do servico', async () => {
    await expect(service.buscarPorOperacao('empresa-A', 'usuario-A', 'invalida')).rejects.toBeInstanceOf(BadRequestException);
  });
});
