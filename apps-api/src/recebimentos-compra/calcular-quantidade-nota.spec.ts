import { describe, expect, it } from 'vitest';
import { calcularQuantidadeNota } from './calcular-quantidade-nota.js';

describe('calcularQuantidadeNota', () => {
  it('converte pacotes e caixas para unidades', () => {
    expect(calcularQuantidadeNota('10.000', 'PC', 'UN', 12)).toBe(120);
    expect(calcularQuantidadeNota('30.000', 'CX', 'UND', 8)).toBe(240);
  });

  it('preserva a quantidade quando a unidade já corresponde ao estoque', () => {
    expect(calcularQuantidadeNota('2.000', 'UN', 'UN')).toBe(2);
    expect(calcularQuantidadeNota('1.125', 'KG', 'KG')).toBe(1.125);
  });

  it('recusa fator ausente ou inválido e unidade incompatível', () => {
    expect(calcularQuantidadeNota('10.000', 'PC', 'UN')).toBeNull();
    expect(calcularQuantidadeNota('10.000', 'PC', 'UN', 1.5)).toBeNull();
    expect(calcularQuantidadeNota('30.000', 'CX', 'CX', 8)).toBeNull();
    expect(calcularQuantidadeNota('2.000', 'UN', 'KG')).toBeNull();
    expect(calcularQuantidadeNota('2.000', 'UN', 'UN', 12)).toBeNull();
  });

  it('recusa quantidade fora da precisão ou do limite do estoque', () => {
    expect(calcularQuantidadeNota('0.125', 'CX', 'UN', 12)).toBeNull();
    expect(calcularQuantidadeNota('99999999999.999', 'CX', 'UN', 12)).toBeNull();
    expect(calcularQuantidadeNota('1.0001', 'KG', 'KG')).toBeNull();
  });
});
