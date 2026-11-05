import { describe, expect, it } from 'vitest';

import {
  perfilTemAcessoGerencial,
  removerDadosFinanceiros,
} from './resposta-financeira.util.js';

describe('resposta-financeira.util', () => {
  it('permite acesso gerencial somente a ADMINISTRADOR e GERENTE', () => {
    expect(perfilTemAcessoGerencial('ADMINISTRADOR')).toBe(true);
    expect(perfilTemAcessoGerencial('GERENTE')).toBe(true);
    expect(perfilTemAcessoGerencial('CAIXA')).toBe(false);
    expect(perfilTemAcessoGerencial('ATENDENTE')).toBe(false);
    expect(perfilTemAcessoGerencial('GARCOM')).toBe(false);
    expect(perfilTemAcessoGerencial(undefined)).toBe(false);
  });

  it('remove campos financeiros aninhados sem alterar o original', () => {
    const original = {
      preco: 12,
      custo: 5,
      data: new Date('2026-10-28T12:00:00.000Z'),
      itens: [
        {
          subtotal: 12,
          custoUnitario: 5,
          custoTotal: 5,
          custoHistoricoDisponivel: true,
          lucroBruto: 7,
          lucroBrutoTotal: 7,
          lucroBrutoUnitario: 7,
          margemBrutaPercentual: 58.33,
          markup: 140,
          markupPercentual: 140,
        },
      ],
    };

    const resultado = removerDadosFinanceiros(original);

    expect(resultado).toHaveProperty('preco', 12);
    expect(resultado).not.toHaveProperty('custo');
    expect(resultado.data).toBeInstanceOf(Date);
    expect(resultado.itens[0]).toEqual({ subtotal: 12 });
    expect(original.custo).toBe(5);
    expect(original.itens[0].custoUnitario).toBe(5);
  });
});
