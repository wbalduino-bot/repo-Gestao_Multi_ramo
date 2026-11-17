import { describe, expect, it, vi } from 'vitest';
import { CaixaService } from './caixa.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { AuditoriaService } from '../auditoria/auditoria.service.js';

describe('CaixaService', () => {
  function montar() {
    const tx = {
      usuario: { findFirst: vi.fn(async (): Promise<{ id: string } | null> => ({ id: 'gestor' })) },
      venda: { findMany: vi.fn().mockResolvedValue([]) },
      estornoVenda: { findMany: vi.fn().mockResolvedValue([]) },
      fechamentoCaixa: {
        findUnique: vi.fn(async (): Promise<{ id: string } | null> => null),
        create: vi.fn().mockResolvedValue({ id: 'fechamento-1' }),
      },
    };
    const prisma = {
      venda: tx.venda,
      estornoVenda: tx.estornoVenda,
      fechamentoCaixa: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      $transaction: vi.fn(async (funcao: (t: typeof tx) => Promise<unknown>) => funcao(tx)),
    };
    const auditoria = { registrar: vi.fn().mockResolvedValue({ id: 'auditoria-1' }) };
    const service = new CaixaService(
      prisma as unknown as PrismaService,
      auditoria as unknown as AuditoriaService,
    );
    return { service, prisma, tx, auditoria };
  }

  it('15 e 30 dias abrangem todas as datas e isolam por empresa', async () => {
    const { service, prisma } = montar();
    const quinze = await service.relatorio('empresa-a', 15, '2026-11-16');
    expect(quinze.dias).toHaveLength(15);
    expect(quinze.inicio).toBe('2026-11-02');
    expect(quinze.consolidado.faturamentoLiquido).toBe(0);
    const trinta = await service.relatorio('empresa-b', 30, '2026-11-16');
    expect(trinta.dias).toHaveLength(30);
    expect(trinta.inicio).toBe('2026-10-18');
    expect(prisma.venda.findMany).toHaveBeenLastCalledWith(expect.objectContaining({
      where: expect.objectContaining({ empresaId: 'empresa-b' }),
    }));
  });

  it('rejeita períodos indevidos ou datas futuras', async () => {
    const { service } = montar();
    await expect(service.relatorio('empresa-a', 7, '2026-11-16')).rejects.toThrow();
    await expect(service.relatorio('empresa-a', 15, '2030-11-16')).rejects.toThrow();
  });

  it('salva a fotografia comercial e auditoria na mesma transacao', async () => {
    const { service, prisma, tx, auditoria } = montar();
    const resultado = await service.fecharDia('empresa-a', 'gestor', '2026-11-16');
    expect(resultado.resumo.data).toBe('2026-11-16');
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.fechamentoCaixa.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ empresaId: 'empresa-a', usuarioId: 'gestor' }),
    }));
    expect(auditoria.registrar).toHaveBeenCalledWith(expect.objectContaining({
      modulo: 'CAIXA', acao: 'FECHAR_DIA_COMERCIAL', entidadeId: 'fechamento-1',
    }), tx);
  });

  it('bloqueia fechamento repetido antes de escrever ou auditar', async () => {
    const { service, tx, auditoria } = montar();
    tx.fechamentoCaixa.findUnique.mockResolvedValueOnce({ id: 'anterior' });
    await expect(service.fecharDia('empresa-a', 'gestor', '2026-11-16')).rejects.toThrow(/já possui fechamento/);
    expect(tx.fechamentoCaixa.create).not.toHaveBeenCalled();
    expect(auditoria.registrar).not.toHaveBeenCalled();
  });

  it('bloqueia usuario sem perfil gerencial ativo', async () => {
    const { service, tx, auditoria } = montar();
    tx.usuario.findFirst.mockResolvedValueOnce(null);
    await expect(service.fecharDia('empresa-a', 'operador', '2026-11-16')).rejects.toThrow(/Gestor ativo/);
    expect(tx.fechamentoCaixa.create).not.toHaveBeenCalled();
    expect(auditoria.registrar).not.toHaveBeenCalled();
  });
});
