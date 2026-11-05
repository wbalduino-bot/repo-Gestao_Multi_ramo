import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PerfilAcesso, ResultadoAuditoria, TipoAtorAuditoria } from '@prisma/client';
import * as argon2 from 'argon2';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditoriaService } from '../auditoria/auditoria.service.js';
import { EmpresasService } from './empresas.service.js';

/**
 * Testes isolados do provisionamento empresarial pelo administrador SaaS.
 * Não utilizam PostgreSQL nem criam empresas de verdade.
 */
describe('EmpresasService - provisionamento SaaS', () => {
  const transacao = {
    empresa: { create: vi.fn(), findUnique: vi.fn() },
    usuario: { create: vi.fn() },
  };

  const prisma = {
    $transaction: vi.fn(),
    empresa: { findUnique: vi.fn() },
    usuario: { findMany: vi.fn() },
  };
  const auditoria = { registrar: vi.fn() };
  let service: EmpresasService;

  beforeEach(() => {
    vi.resetAllMocks();
    prisma.$transaction.mockImplementation(async (fn) => fn(transacao));
    auditoria.registrar.mockResolvedValue({ id: 'auditoria-1' });
    service = new EmpresasService(
      prisma as unknown as PrismaService,
      auditoria as unknown as AuditoriaService,
    );
  });

  it('cria empresa e dois administradores vinculados na mesma transação', async () => {
    transacao.empresa.create.mockResolvedValue({
      id: 'empresa-1', nome: 'Mercado Central', cnpj: '11222333000181', ativo: true,
    });
    transacao.usuario.create
      .mockImplementation(async ({ data }) => ({
        id: data.email === 'ana@teste.com' ? 'usuario-1' : 'usuario-2',
        nome: data.nome,
        email: data.email,
        perfil: data.perfil,
        ativo: true,
      }));

    const resultado = await service.criarComAdministradores('saas-1', {
      nome: 'Mercado Central', cnpj: '11.222.333/0001-81',
      administradores: [
        { nome: 'Ana Silva', email: 'ANA@TESTE.COM', senha: 'SenhaSegura123!' },
        { nome: 'João Costa', email: 'joao@teste.com', senha: 'OutraSenha123!' },
      ],
    });

    expect(resultado?.empresa.id).toBe('empresa-1');
    expect(resultado?.administradores).toHaveLength(2);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(transacao.usuario.create).toHaveBeenCalledTimes(2);
    expect(auditoria.registrar).toHaveBeenCalledTimes(3);

    const primeiraCriacao = transacao.usuario.create.mock.calls[0][0];
    expect(primeiraCriacao.data.empresaId).toBe('empresa-1');
    expect(primeiraCriacao.data.perfil).toBe(PerfilAcesso.ADMINISTRADOR);
    expect(primeiraCriacao.data.email).toBe('ana@teste.com');
    expect(primeiraCriacao.data.hashSenha).not.toBe('SenhaSegura123!');
    expect(await argon2.verify(primeiraCriacao.data.hashSenha, 'SenhaSegura123!')).toBe(true);
    expect(primeiraCriacao.select).not.toHaveProperty('hashSenha');
    expect(auditoria.registrar).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        tipoAtor: TipoAtorAuditoria.ADMIN_PLATAFORMA,
        resultado: ResultadoAuditoria.SUCESSO,
        metadados: expect.objectContaining({ empresaAlvoId: 'empresa-1' }),
        acao: 'PROVISIONAR_ADMINISTRADOR',
      }),
      transacao,
    );

    // O administrador SaaS executa a operação, mas não
    // pertence à empresa cliente que está sendo provisionada.
    const eventoSaas = auditoria.registrar.mock.calls[1]?.[0];

    expect(eventoSaas).toMatchObject({
      atorId: 'saas-1',
      tipoAtor: 'ADMIN_PLATAFORMA',
      metadados: {
        empresaAlvoId: 'empresa-1',
      },
    });

    expect(eventoSaas).not.toHaveProperty('empresaId');

  });

  it('rejeita administradores com e-mails duplicados antes da transação', async () => {
    await expect(service.criarComAdministradores('saas-1', {
      nome: 'Mercado Central', cnpj: '11.222.333/0001-81',
      administradores: [
        { nome: 'Ana Silva', email: 'ANA@TESTE.COM', senha: 'SenhaSegura123!' },
        { nome: 'Ana Silva', email: 'ana@teste.com', senha: 'SenhaSegura123!' },
      ],
    })).rejects.toThrow();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('adiciona administrador de empresa existente com auditoria transacional', async () => {
    transacao.empresa.findUnique.mockResolvedValue({ id: 'empresa-1' });
    transacao.usuario.create.mockResolvedValue({
      id: 'usuario-3', nome: 'Carlos', email: 'carlos@teste.com',
      perfil: PerfilAcesso.ADMINISTRADOR, ativo: true,
    });

    const resultado = await service.adicionarAdministradorEmpresa(
      'saas-1', 'empresa-1',
      { nome: 'Carlos', email: 'carlos@teste.com', senha: 'SenhaSegura123!' },
    );
    expect(resultado?.perfil).toBe(PerfilAcesso.ADMINISTRADOR);
    expect(transacao.empresa.findUnique).toHaveBeenCalledWith({
      where: { id: 'empresa-1' }, select: { id: true },
    });
    expect(transacao.usuario.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ empresaId: 'empresa-1', perfil: PerfilAcesso.ADMINISTRADOR }),
    }));
    expect(auditoria.registrar).toHaveBeenCalledWith(
      expect.objectContaining({ metadados: expect.objectContaining({ empresaAlvoId: 'empresa-1' }), atorId: 'saas-1' }),
      transacao,
    );

    // O administrador SaaS executa a operação, mas não
    // pertence à empresa cliente que está sendo provisionada.
    const eventoSaas = auditoria.registrar.mock.calls[0]?.[0];

    expect(eventoSaas).toMatchObject({
      atorId: 'saas-1',
      tipoAtor: 'ADMIN_PLATAFORMA',
      metadados: {
        empresaAlvoId: 'empresa-1',
      },
    });

    expect(eventoSaas).not.toHaveProperty('empresaId');

  });

  it('consulta somente administradores da empresa solicitada, sem hash de senha', async () => {
    prisma.empresa.findUnique.mockResolvedValue({ id: 'empresa-1' });
    prisma.usuario.findMany.mockResolvedValue([{
      id: 'usuario-1', nome: 'Ana', email: 'ana@teste.com',
      perfil: PerfilAcesso.ADMINISTRADOR, ativo: true,
    }]);

    const resultado = await service.listarAdministradoresEmpresa('saas-1', 'empresa-1');
    expect(resultado).toHaveLength(1);
    expect(prisma.usuario.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { empresaId: 'empresa-1', perfil: PerfilAcesso.ADMINISTRADOR },
      select: expect.not.objectContaining({ hashSenha: true }),
    }));
    expect(auditoria.registrar).toHaveBeenCalledWith(expect.objectContaining({
      modulo: 'USUARIOS', acao: 'CONSULTAR_LISTA', metadados: expect.objectContaining({ empresaAlvoId: 'empresa-1' }),
    }));

    // O administrador SaaS executa a operação, mas não
    // pertence à empresa cliente que está sendo provisionada.
    const eventoSaas = auditoria.registrar.mock.calls[0]?.[0];

    expect(eventoSaas).toMatchObject({
      atorId: 'saas-1',
      tipoAtor: 'ADMIN_PLATAFORMA',
      metadados: {
        empresaAlvoId: 'empresa-1',
      },
    });

    expect(eventoSaas).not.toHaveProperty('empresaId');

  });

  it('não entrega a lista quando o registro de auditoria falhar', async () => {
    prisma.empresa.findUnique.mockResolvedValue({ id: 'empresa-1' });
    prisma.usuario.findMany.mockResolvedValue([]);
    auditoria.registrar.mockRejectedValue(new Error('Auditoria indisponível'));

    await expect(
      service.listarAdministradoresEmpresa('saas-1', 'empresa-1'),
    ).rejects.toThrow('Auditoria indisponível');
  });
});
