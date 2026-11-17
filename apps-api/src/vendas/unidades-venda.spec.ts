import { describe, expect, it, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service.js';
import { consultarUnidadesVenda, validarUnidadeEQuantidadeVenda } from './unidades-venda.js';

describe('Unidades nas vendas do hortifruti', () => {
  const unidades = new Map([['peso', 'KG'], ['peca', 'UN'], ['litro', 'L']]);
  it('aceita 1,250 KG e a menor fracao de 0,001 KG', () => {
    expect(() => validarUnidadeEQuantidadeVenda('Tomate', 'peso', unidades, 1.250)).not.toThrow();
    expect(() => validarUnidadeEQuantidadeVenda('Tomate', 'peso', unidades, 0.001)).not.toThrow();
  });
  it('aceita unidades inteiras e recusa meia unidade', () => {
    expect(() => validarUnidadeEQuantidadeVenda('Alface', 'peca', unidades, 2)).not.toThrow();
    expect(() => validarUnidadeEQuantidadeVenda('Alface', 'peca', unidades, 0.5)).toThrow(BadRequestException);
  });
  it.each([0, -1, NaN, Infinity, 0.0001, 1.2345, 100000000000])('recusa quantidade invalida %s', q => {
    expect(() => validarUnidadeEQuantidadeVenda('Tomate', 'peso', unidades, q)).toThrow(BadRequestException);
  });
  it('aceita o limite de precisao da coluna decimal(14,3)', () => {
    expect(() => validarUnidadeEQuantidadeVenda('Tomate', 'peso', unidades, 99999999999.999)).not.toThrow();
  });
  it('recusa unidade nao encontrada na empresa', () => {
    expect(() => validarUnidadeEQuantidadeVenda('Produto', 'outra-empresa', unidades, 1)).toThrow(BadRequestException);
  });
  it('preserva produtos antigos sem unidade e outros codigos, sem supor UN', () => {
    expect(() => validarUnidadeEQuantidadeVenda('Antigo', null, unidades, 0.5)).not.toThrow();
    expect(() => validarUnidadeEQuantidadeVenda('Leite', 'litro', unidades, 0.5)).not.toThrow();
  });
  it('consulta unidades por empresa e ids unicos; normaliza o codigo', async () => {
    const findMany = vi.fn().mockResolvedValue([{ id: 'peso', codigo: ' kg ' }]);
    const prisma = { unidade: { findMany } } as unknown as Pick<PrismaService, 'unidade'>;
    const mapa = await consultarUnidadesVenda(prisma, 'empresa-A', ['peso', 'peso', null]);
    expect(findMany).toHaveBeenCalledWith({ where: { empresaId: 'empresa-A', id: { in: ['peso'] } }, select: { id: true, codigo: true } });
    expect(mapa.get('peso')).toBe('KG');
  });
  it('nao consulta unidades quando nenhum produto possui vinculo', async () => {
    const findMany = vi.fn();
    const prisma = { unidade: { findMany } } as unknown as Pick<PrismaService, 'unidade'>;
    expect((await consultarUnidadesVenda(prisma, 'empresa', [null, undefined])).size).toBe(0);
    expect(findMany).not.toHaveBeenCalled();
  });
});
