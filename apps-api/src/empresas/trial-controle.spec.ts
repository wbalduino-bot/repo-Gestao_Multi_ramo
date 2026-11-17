import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EmpresasService } from './empresas.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { AuditoriaService } from '../auditoria/auditoria.service.js';

describe('Administracao individual do trial', () => {
  const tx = {
    administradorPlataforma: { findFirst: vi.fn() },
    empresa: { findUnique: vi.fn(), updateMany: vi.fn(), findUniqueOrThrow: vi.fn() },
  };
  const prisma = { $transaction: vi.fn() };
  const auditoria = { registrar: vi.fn() };
  const anterior = { id: 'E', ativo: true, modalidadeAcesso: 'DEFINITIVO', versaoAcesso: 4, trialIniciadoEm: null, trialTerminaEm: null };
  let service: EmpresasService;
  beforeEach(() => {
    vi.resetAllMocks();
    prisma.$transaction.mockImplementation(async fn => fn(tx));
    tx.administradorPlataforma.findFirst.mockResolvedValue({ id: 'A' });
    tx.empresa.findUnique.mockResolvedValue(anterior);
    tx.empresa.updateMany.mockResolvedValue({ count: 1 });
    tx.empresa.findUniqueOrThrow.mockResolvedValue({ ...anterior, versaoAcesso: 5 });
    auditoria.registrar.mockResolvedValue({});
    service = new EmpresasService(prisma as unknown as PrismaService, auditoria as unknown as AuditoriaService);
  });
  const dto = { modalidade: 'TRIAL' as const, versaoAcesso: 4, justificativa: 'Inicio do piloto assistido' };
  it('grava prazo, comparacao de versao e auditoria na mesma transacao', async () => {
    await service.alterarTrial('A', 'E', dto);
    const escrita = tx.empresa.updateMany.mock.calls[0][0];
    expect(escrita.where).toEqual({ id: 'E', versaoAcesso: 4 });
    expect(escrita.data.modalidadeAcesso).toBe('TRIAL');
    expect(escrita.data.trialTerminaEm - escrita.data.trialIniciadoEm).toBe(30 * 86400000);
    expect(escrita.data).not.toHaveProperty('ativo');
    expect(auditoria.registrar).toHaveBeenCalledWith(expect.objectContaining({ atorId: 'A', entidadeId: 'E', acao: 'ATIVAR_TRIAL', justificativa: dto.justificativa }), tx);
  });
  it('remove prazo sem modificar ativacao administrativa', async () => {
    await service.alterarTrial('A', 'E', { ...dto, modalidade: 'DEFINITIVO' });
    expect(tx.empresa.updateMany.mock.calls[0][0].data).toEqual({ modalidadeAcesso: 'DEFINITIVO', trialIniciadoEm: null, trialTerminaEm: null, versaoAcesso: { increment: 1 } });
  });
  it('recusa administrador inativo antes de modificar a empresa', async () => {
    tx.administradorPlataforma.findFirst.mockResolvedValue(null);
    await expect(service.alterarTrial('A', 'E', dto)).rejects.toThrow();
    expect(tx.empresa.updateMany).not.toHaveBeenCalled();
  });
  it('recusa empresa inexistente', async () => {
    tx.empresa.findUnique.mockResolvedValue(null);
    await expect(service.alterarTrial('A', 'E', dto)).rejects.toThrow('Empresa nao encontrada');
  });
  it('recusa versao antiga e perda na comparacao de escrita', async () => {
    await expect(service.alterarTrial('A', 'E', { ...dto, versaoAcesso: 3 })).rejects.toThrow('Atualize');
    expect(tx.empresa.updateMany).not.toHaveBeenCalled();
    tx.empresa.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.alterarTrial('A', 'E', dto)).rejects.toThrow('Atualize');
    expect(auditoria.registrar).not.toHaveBeenCalled();
  });
  it('propaga falha da auditoria para abortar transacao', async () => {
    auditoria.registrar.mockRejectedValue(new Error('Auditoria indisponivel'));
    await expect(service.alterarTrial('A', 'E', dto)).rejects.toThrow('Auditoria indisponivel');
  });
  it('recusa justificativa curta antes de iniciar transacao', async () => {
    await expect(service.alterarTrial('A', 'E', { ...dto, justificativa: 'curta' })).rejects.toThrow();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
