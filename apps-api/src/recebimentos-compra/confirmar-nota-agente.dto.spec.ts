import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CriarProdutoDto } from '../produtos/dto/criar-produto.dto.js';
import {
  ConfirmarNotaAgenteDto,
  ProdutoNovoNotaDto,
} from './confirmar-nota-agente.dto.js';

describe('SKU automático no recebimento de notas', () => {
  it('aceita produto novo sem SKU', async () => {
    const dto = plainToInstance(ProdutoNovoNotaDto, {
      nome: 'Produto de teste',
    });

    const erros = await validate(dto);
    expect(erros).toEqual([]);
  });

  it('mantém SKU obrigatório no cadastro tradicional', async () => {
    const dto = plainToInstance(CriarProdutoDto, {
      nome: 'Produto de teste',
      custo: 10,
      preco: 15,
    });

    const erros = await validate(dto);
    expect(erros.some((erro) => erro.property === 'sku')).toBe(true);
  });

  it('aceita confirmação de nota com produto novo sem SKU', async () => {
    const dto = plainToInstance(ConfirmarNotaAgenteDto, {
      itens: [{
        indiceNota: 0,
        quantidadeRecebida: 12,
        produtoNovo: {
          nome: 'Produto de teste',
        },
      }],
    });

    const erros = await validate(dto);
    expect(erros).toEqual([]);
  });
});
