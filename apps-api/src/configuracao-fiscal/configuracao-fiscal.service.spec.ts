import {
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { Prisma, ResultadoAuditoria } from '@prisma/client';
import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import { PrismaService } from '../prisma/prisma.service.js';
import { AuditoriaService } from '../auditoria/auditoria.service.js';
import { ConfiguracaoFiscalService } from './configuracao-fiscal.service.js';

describe('ConfiguracaoFiscalService', () => {
  const empresaId = 'empresa-1';
  const atorId = 'usuario-1';

  // Simula as operações executadas dentro da transação Prisma.
  const transacao = {
    configuracaoFiscalEmpresa: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
  };

  // Simula as consultas e a abertura de transações.
  const prisma = {
    configuracaoFiscalEmpresa: {
      findUnique: vi.fn(),
    },
    $transaction: vi.fn(),
  };

  // Permite verificar as chamadas de auditoria sem acessar o banco.
  const auditoria = {
    registrar: vi.fn(),
  };

  const service = new ConfiguracaoFiscalService(
    prisma as unknown as PrismaService,
    auditoria as unknown as AuditoriaService,
  );

  const configuracao = {
    id: 'configuracao-1',
    empresaId,
    razaoSocial: 'Empresa Exemplo Ltda',
    uf: 'SP',
  };

  beforeEach(() => {
    vi.resetAllMocks();

    // Executa o callback transacional com o cliente simulado.
    prisma.$transaction.mockImplementation(
      async (callback) => callback(transacao),
    );

    auditoria.registrar.mockResolvedValue({
      id: 'auditoria-1',
    });
  });

  it('deve consultar somente a configuração da empresa autenticada', async () => {
    prisma.configuracaoFiscalEmpresa.findUnique
      .mockResolvedValue(configuracao);

    const resultado = await service.consultar(
      empresaId,
      atorId,
    );

    expect(resultado).toEqual(configuracao);

    expect(
      prisma.configuracaoFiscalEmpresa.findUnique,
    ).toHaveBeenCalledWith({
      where: { empresaId },
    });

    expect(auditoria.registrar).toHaveBeenCalledWith(
      expect.objectContaining({
        empresaId,
        atorId,
        acao: 'CONSULTAR',
        resultado: ResultadoAuditoria.SUCESSO,
      }),
    );
  });

  it('deve retornar null quando a empresa ainda não tiver configuração', async () => {
    prisma.configuracaoFiscalEmpresa.findUnique
      .mockResolvedValue(null);

    await expect(
      service.consultar(empresaId, atorId),
    ).resolves.toBeNull();
  });

  it('deve criar a primeira configuração com auditoria na mesma transação', async () => {
    transacao.configuracaoFiscalEmpresa.findUnique
      .mockResolvedValue(null);

    transacao.configuracaoFiscalEmpresa.create
      .mockResolvedValue(configuracao);

    const resultado = await service.salvar(
      empresaId,
      atorId,
      { razaoSocial: 'Empresa Exemplo Ltda' },
    );

    expect(resultado).toEqual(configuracao);

    expect(
      transacao.configuracaoFiscalEmpresa.create,
    ).toHaveBeenCalledWith({
      data: {
        empresaId,
        razaoSocial: 'Empresa Exemplo Ltda',
      },
    });

    expect(auditoria.registrar).toHaveBeenCalledWith(
      expect.objectContaining({
        empresaId,
        atorId,
        acao: 'CRIAR',
        resultado: ResultadoAuditoria.SUCESSO,
        metadados: {
          camposInformados: ['razaoSocial'],
        },
      }),
      transacao,
    );

    expect(prisma.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      {
        isolationLevel:
          Prisma.TransactionIsolationLevel.Serializable,
      },
    );
  });

  it('deve atualizar somente os campos informados', async () => {
    transacao.configuracaoFiscalEmpresa.findUnique
      .mockResolvedValue(configuracao);

    transacao.configuracaoFiscalEmpresa.update
      .mockResolvedValue({
        ...configuracao,
        nomeFantasia: 'Loja Exemplo',
      });

    await service.salvar(
      empresaId,
      atorId,
      { nomeFantasia: 'Loja Exemplo' },
    );

    expect(
      transacao.configuracaoFiscalEmpresa.update,
    ).toHaveBeenCalledWith({
      where: { empresaId },
      data: {
        nomeFantasia: 'Loja Exemplo',
      },
    });

    expect(
      transacao.configuracaoFiscalEmpresa.create,
    ).not.toHaveBeenCalled();

    expect(auditoria.registrar).toHaveBeenCalledWith(
      expect.objectContaining({
        acao: 'ATUALIZAR',
        resultado: ResultadoAuditoria.SUCESSO,
      }),
      transacao,
    );
  });

  it('deve permitir limpar um campo explicitamente enviado como null', async () => {
    transacao.configuracaoFiscalEmpresa.findUnique
      .mockResolvedValue(configuracao);

    transacao.configuracaoFiscalEmpresa.update
      .mockResolvedValue({
        ...configuracao,
        complemento: null,
      });

    await service.salvar(
      empresaId,
      atorId,
      { complemento: null },
    );

    expect(
      transacao.configuracaoFiscalEmpresa.update,
    ).toHaveBeenCalledWith({
      where: { empresaId },
      data: { complemento: null },
    });
  });

  it('deve rejeitar uma atualização sem campos informados', async () => {
    await expect(
      service.salvar(empresaId, atorId, {}),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('deve propagar falha da auditoria transacional', async () => {
    transacao.configuracaoFiscalEmpresa.findUnique
      .mockResolvedValue(null);

    transacao.configuracaoFiscalEmpresa.create
      .mockResolvedValue(configuracao);

    // Primeira chamada: auditoria de sucesso falha.
    // Segunda chamada: auditoria da tentativa fracassada funciona.
    auditoria.registrar
      .mockRejectedValueOnce(new Error('Falha simulada'))
      .mockResolvedValueOnce({ id: 'auditoria-falha' });

    await expect(
      service.salvar(
        empresaId,
        atorId,
        { razaoSocial: 'Empresa Exemplo Ltda' },
      ),
    ).rejects.toThrow('Falha simulada');

    expect(auditoria.registrar).toHaveBeenCalledWith(
      expect.objectContaining({
        resultado: ResultadoAuditoria.FALHA,
        acao: 'CRIAR',
      }),
    );
  });

  it.each([
    ['P2002'],
    ['P2034'],
  ])('deve tratar o conflito Prisma %s', async (codigo) => {
    const erro = new Prisma.PrismaClientKnownRequestError(
      'Conflito simulado',
      {
        code: codigo,
        clientVersion: '6.19.3',
      },
    );

    prisma.$transaction.mockRejectedValue(erro);

    await expect(
      service.salvar(
        empresaId,
        atorId,
        { razaoSocial: 'Empresa Exemplo Ltda' },
      ),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(auditoria.registrar).toHaveBeenCalledWith(
      expect.objectContaining({
        resultado: ResultadoAuditoria.FALHA,
      }),
    );
  });

  it('deve preservar o erro original se a auditoria de falha também falhar', async () => {
    const erroOriginal = new Error(
      'Erro original da operação',
    );

    prisma.$transaction.mockRejectedValue(erroOriginal);
    auditoria.registrar.mockRejectedValue(
      new Error('Falha secundária de auditoria'),
    );

    await expect(
      service.salvar(
        empresaId,
        atorId,
        { uf: 'SP' },
      ),
    ).rejects.toBe(erroOriginal);
  });
});
