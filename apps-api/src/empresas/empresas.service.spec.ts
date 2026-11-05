import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';

import {
  Prisma,
  ResultadoAuditoria,
  TipoAtorAuditoria,
} from '@prisma/client';

import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import { PrismaService } from '../prisma/prisma.service.js';
import { AuditoriaService } from '../auditoria/auditoria.service.js';
import { EmpresasService } from './empresas.service.js';

const ADMINISTRADOR_ID =
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

describe('EmpresasService', () => {
  let service: EmpresasService;

  /**
   * Mock do cliente transacional utilizado nas operações de escrita.
   */
  const transacao = {
    empresa: {
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  };

  /**
   * Mock das operações Prisma utilizadas pelo serviço.
   */
  const prisma = {
    empresa: {
      findMany: vi.fn(),
      count: vi.fn(),
      findUnique: vi.fn(),
    },
    $transaction: vi.fn(),
  };

  /**
   * Mock da auditoria central.
   */
  const auditoria = {
    registrar: vi.fn(),
  };

  const empresaExistente = {
    id: 'empresa-1',
    nome: 'Mercado Exemplo',
    cnpj: '11222333000181',
    ativo: true,
    criadoEm: new Date(),
  };

  beforeEach(() => {
    vi.resetAllMocks();

    auditoria.registrar.mockResolvedValue({
      id: 'evento-auditoria-1',
    });

    /**
     * Simula os dois formatos utilizados pelo Prisma:
     * - transação interativa por callback;
     * - transação em lote para listagem e contagem.
     */
    prisma.$transaction.mockImplementation(
      async (operacao: unknown) => {
        if (typeof operacao === 'function') {
          return (
            operacao as (
              cliente: typeof transacao,
            ) => unknown
          )(transacao);
        }

        if (Array.isArray(operacao)) {
          return Promise.all(operacao);
        }

        throw new Error(
          'Formato de transação não reconhecido no teste.',
        );
      },
    );

    service = new EmpresasService(
      prisma as unknown as PrismaService,
      auditoria as unknown as AuditoriaService,
    );
  });

  // ============================================================
  // CADASTRO DE EMPRESAS
  // ============================================================

  it('deve cadastrar empresa com CNPJ válido', async () => {
    transacao.empresa.create.mockResolvedValue(
      empresaExistente,
    );

    await expect(
      service.criar(ADMINISTRADOR_ID, {
        nome: 'Mercado Exemplo',
        cnpj: '11.222.333/0001-81',
      }),
    ).resolves.toEqual(empresaExistente);

    expect(transacao.empresa.create).toHaveBeenCalledWith({
      data: {
        nome: 'Mercado Exemplo',
        cnpj: '11222333000181',
      },
    });

    expect(auditoria.registrar).toHaveBeenCalledWith(
      expect.objectContaining({
        atorId: ADMINISTRADOR_ID,
        tipoAtor: TipoAtorAuditoria.ADMIN_PLATAFORMA,
        modulo: 'EMPRESAS',
        acao: 'CRIAR',
        entidade: 'EMPRESA',
        entidadeId: empresaExistente.id,
        resultado: ResultadoAuditoria.SUCESSO,
      }),
      transacao,
    );

    const entradaAuditoria =
      auditoria.registrar.mock.calls[0][0];

    expect(entradaAuditoria).not.toHaveProperty(
      'empresaId',
    );
  });

  it('deve rejeitar CNPJ inválido', async () => {
    await expect(
      service.criar(ADMINISTRADOR_ID, {
        nome: 'Mercado Exemplo',
        cnpj: '11.111.111/1111-11',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(transacao.empresa.create).not.toHaveBeenCalled();

    expect(auditoria.registrar).toHaveBeenCalledWith(
      expect.objectContaining({
        atorId: ADMINISTRADOR_ID,
        tipoAtor: TipoAtorAuditoria.ADMIN_PLATAFORMA,
        modulo: 'EMPRESAS',
        acao: 'CRIAR',
        resultado: ResultadoAuditoria.FALHA,
      }),
    );
  });

  it('deve remover espaços extras do nome no cadastro', async () => {
    transacao.empresa.create.mockResolvedValue(
      empresaExistente,
    );

    await service.criar(ADMINISTRADOR_ID, {
      nome: '  Mercado Exemplo  ',
      cnpj: '11222333000181',
    });

    expect(transacao.empresa.create).toHaveBeenCalledWith({
      data: {
        nome: 'Mercado Exemplo',
        cnpj: '11222333000181',
      },
    });
  });

  it('deve cadastrar um CNPJ alfanumérico válido conforme o exemplo oficial', async () => {
    const empresa = {
      ...empresaExistente,
      id: 'empresa-alfanumerica-1',
      nome: 'Empresa Exemplo',
      cnpj: '12ABC34501DE35',
    };

    transacao.empresa.create.mockResolvedValue(empresa);

    await expect(
      service.criar(ADMINISTRADOR_ID, {
        nome: 'Empresa Exemplo',
        cnpj: '12.ABC.345/01DE-35',
      }),
    ).resolves.toEqual(empresa);

    expect(transacao.empresa.create).toHaveBeenCalledWith({
      data: {
        nome: 'Empresa Exemplo',
        cnpj: '12ABC34501DE35',
      },
    });
  });

  it('deve rejeitar CNPJ alfanumérico com dígito verificador incorreto', async () => {
    await expect(
      service.criar(ADMINISTRADOR_ID, {
        nome: 'Empresa Exemplo',
        cnpj: '12.ABC.345/01DE-34',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(transacao.empresa.create).not.toHaveBeenCalled();
  });

  it('deve converter CNPJ duplicado em erro de conflito', async () => {
    const erroDuplicidade =
      new Prisma.PrismaClientKnownRequestError(
        'Unique constraint failed',
        {
          code: 'P2002',
          clientVersion: 'test',
        },
      );

    transacao.empresa.create.mockRejectedValue(
      erroDuplicidade,
    );

    await expect(
      service.criar(ADMINISTRADOR_ID, {
        nome: 'Mercado Exemplo',
        cnpj: '11222333000181',
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(auditoria.registrar).toHaveBeenCalledWith(
      expect.objectContaining({
        acao: 'CRIAR',
        resultado: ResultadoAuditoria.FALHA,
        motivo: 'PrismaClientKnownRequestError',
      }),
    );
  });

  it('deve propagar erros inesperados durante o cadastro', async () => {
    const erroInesperado = new Error(
      'Falha inesperada no banco',
    );

    transacao.empresa.create.mockRejectedValue(
      erroInesperado,
    );

    await expect(
      service.criar(ADMINISTRADOR_ID, {
        nome: 'Mercado Exemplo',
        cnpj: '11222333000181',
      }),
    ).rejects.toBe(erroInesperado);
  });

  it('deve reverter a operação quando a auditoria de sucesso falhar', async () => {
    const erroAuditoria = new Error(
      'Falha ao registrar auditoria',
    );

    // A primeira chamada representa a auditoria de sucesso.
    // A segunda representa a tentativa de registrar a falha.
    auditoria.registrar
      .mockRejectedValueOnce(erroAuditoria)
      .mockResolvedValueOnce({
        id: 'evento-falha-1',
      });

    transacao.empresa.create.mockResolvedValue(
      empresaExistente,
    );

    await expect(
      service.criar(ADMINISTRADOR_ID, {
        nome: 'Mercado Exemplo',
        cnpj: '11222333000181',
      }),
    ).rejects.toBe(erroAuditoria);

    expect(auditoria.registrar).toHaveBeenCalledTimes(2);

    expect(auditoria.registrar).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        resultado: ResultadoAuditoria.SUCESSO,
      }),
      transacao,
    );

    expect(auditoria.registrar).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        resultado: ResultadoAuditoria.FALHA,
      }),
    );
  });

  it('deve preservar o erro original quando a auditoria da falha também falhar', async () => {
    const erroOriginal = new Error(
      'Erro original da operação',
    );

    transacao.empresa.create.mockRejectedValue(
      erroOriginal,
    );

    auditoria.registrar.mockRejectedValue(
      new Error('Auditoria indisponível'),
    );

    await expect(
      service.criar(ADMINISTRADOR_ID, {
        nome: 'Mercado Exemplo',
        cnpj: '11222333000181',
      }),
    ).rejects.toBe(erroOriginal);
  });

  // ============================================================
  // CONSULTA E PAGINAÇÃO
  // ============================================================

  it('deve retornar erro quando empresa não existir', async () => {
    prisma.empresa.findUnique.mockResolvedValue(null);

    await expect(
      service.buscarPorId(
        ADMINISTRADOR_ID,
        'id-inexistente',
      ),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(auditoria.registrar).not.toHaveBeenCalled();
  });

  it('deve buscar uma empresa pelo identificador e auditar a consulta', async () => {
    prisma.empresa.findUnique.mockResolvedValue(
      empresaExistente,
    );

    await expect(
      service.buscarPorId(
        ADMINISTRADOR_ID,
        'empresa-1',
      ),
    ).resolves.toEqual(empresaExistente);

    expect(prisma.empresa.findUnique).toHaveBeenCalledWith({
      where: { id: 'empresa-1' },
    });

    expect(auditoria.registrar).toHaveBeenCalledWith(
      expect.objectContaining({
        atorId: ADMINISTRADOR_ID,
        tipoAtor: TipoAtorAuditoria.ADMIN_PLATAFORMA,
        modulo: 'EMPRESAS',
        acao: 'CONSULTAR',
        entidade: 'EMPRESA',
        entidadeId: 'empresa-1',
        resultado: ResultadoAuditoria.SUCESSO,
      }),
    );
  });

  it('deve impedir a entrega da empresa quando a auditoria falhar', async () => {
    const erroAuditoria = new Error(
      'Falha ao registrar auditoria da consulta individual',
    );

    prisma.empresa.findUnique.mockResolvedValue(
      empresaExistente,
    );
    auditoria.registrar.mockRejectedValue(erroAuditoria);

    await expect(
      service.buscarPorId(
        ADMINISTRADOR_ID,
        'empresa-1',
      ),
    ).rejects.toBe(erroAuditoria);
  });

  it('deve listar empresas com paginação, filtro e auditoria', async () => {
    const empresas = [empresaExistente];

    prisma.empresa.findMany.mockResolvedValue(empresas);
    prisma.empresa.count.mockResolvedValue(41);

    const resultado = await service.listar(
      ADMINISTRADOR_ID,
      {
        pagina: 2,
        limite: 10,
        ativo: true,
      },
    );

    expect(prisma.empresa.findMany).toHaveBeenCalledWith({
      where: { ativo: true },
      orderBy: { criadoEm: 'desc' },
      skip: 10,
      take: 10,
    });

    expect(prisma.empresa.count).toHaveBeenCalledWith({
      where: { ativo: true },
    });

    expect(resultado).toEqual({
      dados: empresas,
      total: 41,
      pagina: 2,
      limite: 10,
      totalPaginas: 5,
    });

    // Abrir ou paginar empresas não deve produzir auditoria persistente.
    expect(auditoria.registrar).not.toHaveBeenCalled();
  });

  it('deve entregar a listagem sem gravar auditoria de leitura', async () => {
    prisma.empresa.findMany.mockResolvedValue([empresaExistente]);
    prisma.empresa.count.mockResolvedValue(1);
    // Escrita de auditoria indisponível não deve afetar consulta rotineira.
    auditoria.registrar.mockRejectedValue(new Error('Auditoria indisponível'));

    const resultado = await service.listar(ADMINISTRADOR_ID, {});
    expect(resultado.dados).toEqual([empresaExistente]);
    expect(resultado.total).toBe(1);
    expect(auditoria.registrar).not.toHaveBeenCalled();
  });

  // ============================================================
  // ATUALIZAÇÃO DE EMPRESAS
  // ============================================================

  it('deve rejeitar CNPJ inválido na atualização', async () => {
    await expect(
      service.atualizar(ADMINISTRADOR_ID, 'empresa-1', {
        cnpj: '11.111.111/1111-11',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(transacao.empresa.update).not.toHaveBeenCalled();

    expect(auditoria.registrar).toHaveBeenCalledWith(
      expect.objectContaining({
        acao: 'ATUALIZAR',
        resultado: ResultadoAuditoria.FALHA,
      }),
    );
  });

  it('deve remover espaços extras do nome na atualização', async () => {
    transacao.empresa.findUnique.mockResolvedValue(
      empresaExistente,
    );

    transacao.empresa.update.mockResolvedValue({
      ...empresaExistente,
      nome: 'Mercado Atualizado',
    });

    await service.atualizar(
      ADMINISTRADOR_ID,
      'empresa-1',
      {
        nome: '  Mercado Atualizado  ',
      },
    );

    expect(transacao.empresa.update).toHaveBeenCalledWith({
      where: { id: 'empresa-1' },
      data: { nome: 'Mercado Atualizado' },
    });

    expect(auditoria.registrar).toHaveBeenCalledWith(
      expect.objectContaining({
        atorId: ADMINISTRADOR_ID,
        tipoAtor: TipoAtorAuditoria.ADMIN_PLATAFORMA,
        modulo: 'EMPRESAS',
        acao: 'ATUALIZAR',
        entidade: 'EMPRESA',
        entidadeId: 'empresa-1',
        resultado: ResultadoAuditoria.SUCESSO,
        dadosAnteriores: {
          nome: 'Mercado Exemplo',
          ativo: true,
        },
        dadosPosteriores: {
          nome: 'Mercado Atualizado',
          ativo: true,
        },
      }),
      transacao,
    );
  });

  it('deve registrar os campos alterados sem armazenar o CNPJ nos dados da auditoria', async () => {
    transacao.empresa.findUnique.mockResolvedValue(
      empresaExistente,
    );

    transacao.empresa.update.mockResolvedValue({
      ...empresaExistente,
      cnpj: '12ABC34501DE35',
    });

    await service.atualizar(
      ADMINISTRADOR_ID,
      'empresa-1',
      {
        cnpj: '12.ABC.345/01DE-35',
      },
    );

    expect(auditoria.registrar).toHaveBeenCalledWith(
      expect.objectContaining({
        acao: 'ATUALIZAR',
        metadados: {
          camposAlterados: ['cnpj'],
          cnpjAlterado: true,
        },
      }),
      transacao,
    );

    const entradaAuditoria =
      auditoria.registrar.mock.calls[0][0];

    expect(entradaAuditoria.dadosAnteriores).not.toHaveProperty(
      'cnpj',
    );

    expect(entradaAuditoria.dadosPosteriores).not.toHaveProperty(
      'cnpj',
    );
  });

  it('deve retornar empresa não encontrada ao atualizar um ID inexistente', async () => {
    transacao.empresa.findUnique.mockResolvedValue(null);

    await expect(
      service.atualizar(
        ADMINISTRADOR_ID,
        'id-inexistente',
        {
          nome: 'Mercado Atualizado',
        },
      ),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(transacao.empresa.update).not.toHaveBeenCalled();
  });

  it('deve converter erro P2025 durante a atualização', async () => {
    const erroRegistroInexistente =
      new Prisma.PrismaClientKnownRequestError(
        'Record to update not found',
        {
          code: 'P2025',
          clientVersion: 'test',
        },
      );

    transacao.empresa.findUnique.mockResolvedValue(
      empresaExistente,
    );

    transacao.empresa.update.mockRejectedValue(
      erroRegistroInexistente,
    );

    await expect(
      service.atualizar(
        ADMINISTRADOR_ID,
        'empresa-1',
        {
          nome: 'Mercado Atualizado',
        },
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  // ============================================================
  // ATIVAÇÃO E DESATIVAÇÃO DE EMPRESAS
  // ============================================================

  it('deve permitir desativar uma empresa e registrar a auditoria', async () => {
    transacao.empresa.findUnique.mockResolvedValue(
      empresaExistente,
    );

    transacao.empresa.update.mockResolvedValue({
      ...empresaExistente,
      ativo: false,
    });

    const resultado = await service.alterarAtivacao(
      ADMINISTRADOR_ID,
      'empresa-1',
      false,
    );

    expect(resultado.ativo).toBe(false);

    expect(transacao.empresa.update).toHaveBeenCalledWith({
      where: { id: 'empresa-1' },
      data: { ativo: false },
    });

    expect(auditoria.registrar).toHaveBeenCalledWith(
      expect.objectContaining({
        atorId: ADMINISTRADOR_ID,
        tipoAtor: TipoAtorAuditoria.ADMIN_PLATAFORMA,
        modulo: 'EMPRESAS',
        acao: 'ALTERAR_ATIVACAO',
        entidade: 'EMPRESA',
        entidadeId: 'empresa-1',
        resultado: ResultadoAuditoria.SUCESSO,
        dadosAnteriores: {
          nome: 'Mercado Exemplo',
          ativo: true,
        },
        dadosPosteriores: {
          nome: 'Mercado Exemplo',
          ativo: false,
        },
      }),
      transacao,
    );
  });

  it('deve permitir reativar uma empresa', async () => {
    transacao.empresa.findUnique.mockResolvedValue({
      ...empresaExistente,
      ativo: false,
    });

    transacao.empresa.update.mockResolvedValue(
      empresaExistente,
    );

    const resultado = await service.alterarAtivacao(
      ADMINISTRADOR_ID,
      'empresa-1',
      true,
    );

    expect(resultado.ativo).toBe(true);

    expect(transacao.empresa.update).toHaveBeenCalledWith({
      where: { id: 'empresa-1' },
      data: { ativo: true },
    });
  });

  it('deve registrar falha quando a empresa não existir na alteração de ativação', async () => {
    transacao.empresa.findUnique.mockResolvedValue(null);

    await expect(
      service.alterarAtivacao(
        ADMINISTRADOR_ID,
        'id-inexistente',
        false,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(transacao.empresa.update).not.toHaveBeenCalled();

    expect(auditoria.registrar).toHaveBeenCalledWith(
      expect.objectContaining({
        atorId: ADMINISTRADOR_ID,
        tipoAtor: TipoAtorAuditoria.ADMIN_PLATAFORMA,
        modulo: 'EMPRESAS',
        acao: 'ALTERAR_ATIVACAO',
        entidadeId: 'id-inexistente',
        resultado: ResultadoAuditoria.FALHA,
      }),
    );
  });

  it('deve converter erro P2025 ao alterar ativação', async () => {
    const erroRegistroInexistente =
      new Prisma.PrismaClientKnownRequestError(
        'Record to update not found',
        {
          code: 'P2025',
          clientVersion: 'test',
        },
      );

    transacao.empresa.findUnique.mockResolvedValue(
      empresaExistente,
    );

    transacao.empresa.update.mockRejectedValue(
      erroRegistroInexistente,
    );

    await expect(
      service.alterarAtivacao(
        ADMINISTRADOR_ID,
        'empresa-1',
        false,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});