
/**
 * Testes unitários do EmpresasService.
 *
 * Objetivos:
 * - Validar cadastro e atualização de empresas.
 * - Verificar a normalização de nomes e CNPJs.
 * - Testar CNPJs numéricos e alfanuméricos.
 * - Validar paginação, filtros e consulta de empresas.
 * - Conferir ativação e desativação.
 * - Garantir o tratamento adequado dos erros do Prisma.
 * - Assegurar que erros inesperados não sejam ocultados.
 *
 * O PrismaService é simulado com mocks. Assim, os testes não
 * precisam acessar o banco de dados real.
 */

import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';

import { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PrismaService } from '../prisma/prisma.service.js';
import { EmpresasService } from './empresas.service.js';

describe('EmpresasService', () => {
  let service: EmpresasService;

  /**
   * Simula os métodos do Prisma utilizados pelo serviço.
   * Cada teste configura o resultado esperado para o cenário.
   */
  const prisma = {
    empresa: {
      create: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    $transaction: vi.fn(),
  };

  beforeEach(() => {
    // Limpa o histórico das chamadas antes de cada teste.
    vi.clearAllMocks();

    // Injeta o Prisma simulado no serviço sob teste.
    service = new EmpresasService(
      prisma as unknown as PrismaService,
    );
  });

  // ============================================================
  // CADASTRO DE EMPRESAS
  // ============================================================

  it('deve cadastrar empresa com CNPJ válido', async () => {
    const empresa = {
      id: 'empresa-1',
      nome: 'Mercado Exemplo',
      cnpj: '11222333000181',
      ativo: true,
      criadoEm: new Date(),
    };

    prisma.empresa.create.mockResolvedValue(empresa);

    await expect(
      service.criar({
        nome: 'Mercado Exemplo',
        cnpj: '11.222.333/0001-81',
      }),
    ).resolves.toEqual(empresa);

    // Confirma que o CNPJ é normalizado antes da gravação.
    expect(prisma.empresa.create).toHaveBeenCalledWith({
      data: {
        nome: 'Mercado Exemplo',
        cnpj: '11222333000181',
      },
    });
  });

  it('deve rejeitar CNPJ inválido', async () => {
    await expect(
      service.criar({
        nome: 'Mercado Exemplo',
        cnpj: '11.111.111/1111-11',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    // Não deve tentar gravar uma empresa com CNPJ inválido.
    expect(prisma.empresa.create).not.toHaveBeenCalled();
  });

  it('deve remover espaços extras do nome no cadastro', async () => {
    prisma.empresa.create.mockResolvedValue({
      id: 'empresa-1',
      nome: 'Mercado Exemplo',
      cnpj: '11222333000181',
      ativo: true,
      criadoEm: new Date(),
    });

    await service.criar({
      nome: '  Mercado Exemplo  ',
      cnpj: '11222333000181',
    });

    // O nome deve ser armazenado sem espaços nas extremidades.
    expect(prisma.empresa.create).toHaveBeenCalledWith({
      data: {
        nome: 'Mercado Exemplo',
        cnpj: '11222333000181',
      },
    });
  });

  it('deve cadastrar um CNPJ alfanumérico válido conforme o exemplo oficial', async () => {
    /**
     * Exemplo de CNPJ alfanumérico documentado pela Receita Federal:
     * 12.ABC.345/01DE-35.
     *
     * As letras da base são convertidas conforme a regra oficial
     * para o cálculo dos dígitos verificadores.
     */
    const empresa = {
      id: 'empresa-alfanumerica-1',
      nome: 'Empresa Exemplo',
      cnpj: '12ABC34501DE35',
      ativo: true,
      criadoEm: new Date(),
    };

    prisma.empresa.create.mockResolvedValue(empresa);

    await expect(
      service.criar({
        nome: 'Empresa Exemplo',
        cnpj: '12.ABC.345/01DE-35',
      }),
    ).resolves.toEqual(empresa);

    // A pontuação deve ser removida antes da gravação.
    expect(prisma.empresa.create).toHaveBeenCalledWith({
      data: {
        nome: 'Empresa Exemplo',
        cnpj: '12ABC34501DE35',
      },
    });
  });

  it('deve rejeitar CNPJ alfanumérico com dígito verificador incorreto', async () => {
    await expect(
      service.criar({
        nome: 'Empresa Exemplo',
        cnpj: '12.ABC.345/01DE-34',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    // Um CNPJ inválido deve ser rejeitado antes de acessar o banco.
    expect(prisma.empresa.create).not.toHaveBeenCalled();
  });

  it('deve converter CNPJ duplicado em erro de conflito', async () => {
    /**
     * P2002 é o código Prisma para violação de unicidade.
     * O serviço deve convertê-lo em ConflictException.
     */
    const erroDuplicidade =
      new Prisma.PrismaClientKnownRequestError(
        'Unique constraint failed',
        {
          code: 'P2002',
          clientVersion: 'test',
        },
      );

    prisma.empresa.create.mockRejectedValue(erroDuplicidade);

    // Captura a exceção para conferir seu tipo e sua mensagem.
    const resultado = await service
      .criar({
        nome: 'Mercado Exemplo',
        cnpj: '11222333000181',
      })
      .then(
        () => null,
        (erro: unknown) => erro,
      );

    expect(resultado).toBeInstanceOf(ConflictException);

    expect(resultado).toHaveProperty(
      'message',
      'Já existe uma empresa cadastrada com este CNPJ.',
    );
  });

  it('deve propagar erros inesperados durante o cadastro', async () => {
    // Erros não reconhecidos devem continuar sendo propagados.
    const erroInesperado = new Error(
      'Falha inesperada no banco',
    );

    prisma.empresa.create.mockRejectedValue(erroInesperado);

    await expect(
      service.criar({
        nome: 'Mercado Exemplo',
        cnpj: '11222333000181',
      }),
    ).rejects.toBe(erroInesperado);
  });

  // ============================================================
  // CONSULTA E PAGINAÇÃO
  // ============================================================

  it('deve retornar erro quando empresa não existir', async () => {
    // Simula uma consulta sem registro correspondente.
    prisma.empresa.findUnique.mockResolvedValue(null);

    await expect(
      service.buscarPorId('id-inexistente'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('deve listar empresas com paginação e filtro por situação', async () => {
    const empresas = [
      {
        id: 'empresa-1',
        nome: 'Mercado Exemplo',
        cnpj: '11222333000181',
        ativo: true,
      },
    ];

    /**
     * A transação retorna os registros da página e a contagem total.
     * O exemplo simula 41 empresas, com limite de 10 por página.
     */
    prisma.$transaction.mockResolvedValue([empresas, 41]);

    const resultado = await service.listar({
      pagina: 2,
      limite: 10,
      ativo: true,
    });

    // Confirma filtro, ordenação e limites da consulta.
    expect(prisma.empresa.findMany).toHaveBeenCalledWith({
      where: { ativo: true },
      orderBy: { criadoEm: 'desc' },
      skip: 10,
      take: 10,
    });

    // A contagem deve utilizar o mesmo filtro da listagem.
    expect(prisma.empresa.count).toHaveBeenCalledWith({
      where: { ativo: true },
    });

    // 41 registros com limite de 10 resultam em 5 páginas.
    expect(resultado).toEqual({
      dados: empresas,
      total: 41,
      pagina: 2,
      limite: 10,
      totalPaginas: 5,
    });
  });

  // ============================================================
  // ATUALIZAÇÃO DE EMPRESAS
  // ============================================================

  it('deve rejeitar CNPJ inválido na atualização', async () => {
    await expect(
      service.atualizar('empresa-1', {
        cnpj: '11.111.111/1111-11',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    // A atualização não deve ocorrer com CNPJ inválido.
    expect(prisma.empresa.update).not.toHaveBeenCalled();
  });

  it('deve remover espaços extras do nome na atualização', async () => {
    prisma.empresa.update.mockResolvedValue({
      id: 'empresa-1',
      nome: 'Mercado Exemplo',
      cnpj: '11222333000181',
      ativo: true,
      criadoEm: new Date(),
    });

    await service.atualizar('empresa-1', {
      nome: '  Mercado Exemplo  ',
    });

    // Somente o campo enviado deve ser incluído na atualização.
    expect(prisma.empresa.update).toHaveBeenCalledWith({
      where: { id: 'empresa-1' },
      data: { nome: 'Mercado Exemplo' },
    });
  });

  it('deve retornar empresa não encontrada ao atualizar um ID inexistente', async () => {
    /**
     * P2025 indica que o registro necessário à operação
     * não foi encontrado pelo Prisma.
     */
    const erroRegistroInexistente =
      new Prisma.PrismaClientKnownRequestError(
        'Record to update not found',
        {
          code: 'P2025',
          clientVersion: 'test',
        },
      );

    prisma.empresa.update.mockRejectedValue(
      erroRegistroInexistente,
    );

    await expect(
      service.atualizar('id-inexistente', {
        nome: 'Mercado Atualizado',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  // ============================================================
  // ATIVAÇÃO E DESATIVAÇÃO DE EMPRESAS
  // ============================================================

  it('deve permitir desativar uma empresa', async () => {
    prisma.empresa.update.mockResolvedValue({
      id: 'empresa-1',
      nome: 'Mercado Exemplo',
      cnpj: '11222333000181',
      ativo: false,
      criadoEm: new Date(),
    });

    const resultado = await service.alterarAtivacao(
      'empresa-1',
      false,
    );

    expect(resultado.ativo).toBe(false);

    expect(prisma.empresa.update).toHaveBeenCalledWith({
      where: { id: 'empresa-1' },
      data: { ativo: false },
    });
  });

  it('deve permitir reativar uma empresa', async () => {
    prisma.empresa.update.mockResolvedValue({
      id: 'empresa-1',
      nome: 'Mercado Exemplo',
      cnpj: '11222333000181',
      ativo: true,
      criadoEm: new Date(),
    });

    const resultado = await service.alterarAtivacao(
      'empresa-1',
      true,
    );

    expect(resultado.ativo).toBe(true);

    expect(prisma.empresa.update).toHaveBeenCalledWith({
      where: { id: 'empresa-1' },
      data: { ativo: true },
    });
  });

  it('deve retornar empresa não encontrada ao alterar a ativação de um ID inexistente', async () => {
    // Simula a tentativa de atualizar um registro inexistente.
    const erroRegistroInexistente =
      new Prisma.PrismaClientKnownRequestError(
        'Record to update not found',
        {
          code: 'P2025',
          clientVersion: 'test',
        },
      );

    prisma.empresa.update.mockRejectedValue(
      erroRegistroInexistente,
    );

    await expect(
      service.alterarAtivacao('id-inexistente', false),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
