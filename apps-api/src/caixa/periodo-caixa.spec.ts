import { describe, expect, it } from 'vitest';
import {
  dataComercial, diasDoPeriodo, inicioDiaComercialUTC, somarDias, validarDataCaixa,
} from './periodo-caixa.js';

describe('calendario do caixa', () => {
  it('diario inclui a data selecionada', () => {
    expect(diasDoPeriodo('2026-11-16', 1)).toEqual(['2026-11-16']);
  });
  it('15 dias incluem inicio e fim sem omissoes', () => {
    const dias = diasDoPeriodo('2026-11-16', 15);
    expect([dias.length, dias[0], dias.at(-1)]).toEqual([15, '2026-11-02', '2026-11-16']);
  });
  it('30 dias atravessam corretamente o mes anterior', () => {
    const dias = diasDoPeriodo('2026-11-16', 30);
    expect([dias.length, dias[0], dias.at(-1)]).toEqual([30, '2026-10-18', '2026-11-16']);
  });
  it('ano bissexto e virada de ano', () => {
    expect(somarDias('2024-02-28', 1)).toBe('2024-02-29');
    expect(somarDias('2026-12-31', 1)).toBe('2027-01-01');
  });
  it('rejeita datas inexistentes e formatos invalidos', () => {
    expect(() => validarDataCaixa('2026-02-30')).toThrow();
    expect(() => validarDataCaixa('16/11/2026')).toThrow();
  });
  it('considera madrugada UTC como dia anterior de Brasilia', () => {
    expect(dataComercial(new Date('2026-11-17T02:59:59.000Z'))).toBe('2026-11-16');
    expect(dataComercial(new Date('2026-11-17T03:00:00.000Z'))).toBe('2026-11-17');
    expect(inicioDiaComercialUTC('2026-11-16').toISOString()).toBe('2026-11-16T03:00:00.000Z');
  });
});
