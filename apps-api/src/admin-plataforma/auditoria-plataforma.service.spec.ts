import { BadRequestException } from '@nestjs/common';
import { ResultadoAuditoria, TipoAtorAuditoria } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditoriaPlataformaService } from './auditoria-plataforma.service.js';

/** Testes isolados da API de consulta, sem acessar PostgreSQL. */
describe('AuditoriaPlataformaService', () => {
  const prisma = {
    eventoAuditoria: {
      findMany: vi.fn(),
      count: vi.fn(),
    },
  };
  const auditoria = { registrar: vi.fn() };
  let service: AuditoriaPlataformaService;

  beforeEach(() => {
    vi.resetAllMocks();
    prisma.eventoAuditoria.findMany.mockResolvedValue([]);
    prisma.eventoAuditoria.count.mockResolvedValue(0);
    auditoria.registrar.mockResolvedValue({ id: 'evento-auditoria' });
    service = new AuditoriaPlataformaService(
      prisma as unknown as PrismaService,
    );
  });

  it('restringe eventos a atores SaaS ou logins anônimos da plataforma', async () => {
    await service.listar('admin-saas-1', { pagina: 1, limite: 20 });

    const argumento = prisma.eventoAuditoria.findMany.mock.calls[0][0];
    expect(argumento.where.AND).toEqual(expect.arrayContaining([
      {
        OR: [
          { tipoAtor: TipoAtorAuditoria.ADMIN_PLATAFORMA },
          {
            tipoAtor: TipoAtorAuditoria.ANONIMO,
            modulo: 'ADMIN_PLATAFORMA',
          },
        ],
      },
    ]));
    expect(argumento.take).toBe(20);
    expect(argumento.select).not.toHaveProperty('dadosAnteriores');
    expect(argumento.select).not.toHaveProperty('dadosPosteriores');
    expect(argumento.select).not.toHaveProperty('ipOrigem');
    // Consultas rotineiras não registram novos eventos de auditoria.
    expect(auditoria.registrar).not.toHaveBeenCalled();
  });

  it('não revela metadados brutos no retorno', async () => {
    prisma.eventoAuditoria.findMany.mockResolvedValue([{
      id: 'evento-1',
      criadoEm: new Date(),
      tipoAtor: TipoAtorAuditoria.ADMIN_PLATAFORMA,
      atorId: 'admin-saas-1',
      modulo: 'USUARIOS',
      acao: 'PROVISIONAR_ADMINISTRADOR',
      entidade: 'USUARIO',
      entidadeId: 'usuario-1',
      resultado: ResultadoAuditoria.SUCESSO,
      motivo: null,
      requestId: null,
      metadados: {
        empresaAlvoId: 'empresa-1',
        valorNaoExposto: 'DADO_PRIVADO',
      },
    }]);

    const resposta = await service.listar('admin-saas-1', {});
    expect(resposta.dados[0].empresaAlvoId).toBe('empresa-1');
    expect(resposta.dados[0]).not.toHaveProperty('metadados');
    expect(JSON.stringify(resposta.dados[0])).not.toContain('DADO_PRIVADO');
  });

  it('rejeita paginação inválida e períodos excessivos', async () => {
    await expect(service.listar('admin-saas-1', { limite: 51 }))
      .rejects.toBeInstanceOf(BadRequestException);
    await expect(service.listar('admin-saas-1', {
      inicio: '2020-01-01T00:00:00.000Z',
      fim: '2021-01-01T00:00:00.000Z',
    })).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.eventoAuditoria.findMany).not.toHaveBeenCalled();
  });

  it('não grava evento nem depende da disponibilidade da escrita de auditoria', async () => {
    // A consulta é somente leitura; falhas de escrita em auditoria não bloqueiam o painel.
    auditoria.registrar.mockRejectedValue(new Error('Auditoria indisponível'));
    const resultado = await service.listar('admin-saas-1', {});
    expect(resultado.dados).toEqual([]);
    expect(auditoria.registrar).not.toHaveBeenCalled();
  });
});
