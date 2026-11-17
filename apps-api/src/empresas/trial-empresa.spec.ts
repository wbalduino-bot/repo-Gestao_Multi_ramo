import { describe, expect, it } from 'vitest';
import { consultarTrialEmpresa, iniciarTrialEmpresa, DIA_TRIAL_MS } from './trial-empresa.js';

describe('Prazo trial da empresa', () => {
  const inicio = new Date('2026-11-15T15:00:00Z');
  const dados = iniciarTrialEmpresa(inicio);
  it('inicia 30 dias exatos no relogio do servidor', () => {
    expect(dados.trialTerminaEm.getTime() - inicio.getTime()).toBe(30 * DIA_TRIAL_MS);
  });
  it('permite acesso definitivo sem datas de trial', () => {
    expect(consultarTrialEmpresa({ modalidadeAcesso: 'DEFINITIVO', trialIniciadoEm: null, trialTerminaEm: null }, inicio)).toEqual({ bloqueado: false, trial: null });
  });
  for (const dias of [8, 7, 6, 5, 4, 3, 2, 1]) {
    it(`informa ${dias} dia(s) para o aviso`, () => {
      const agora = new Date(dados.trialTerminaEm.getTime() - dias * DIA_TRIAL_MS);
      expect(consultarTrialEmpresa(dados, agora)).toMatchObject({ bloqueado: false, trial: { diasRestantes: dias } });
    });
  }
  it('mantem um dia restante ate o ultimo milissegundo', () => {
    expect(consultarTrialEmpresa(dados, new Date(dados.trialTerminaEm.getTime() - 1))).toMatchObject({ bloqueado: false, trial: { diasRestantes: 1 } });
  });
  it('bloqueia exatamente no vencimento e depois', () => {
    for (const atraso of [0, 1, DIA_TRIAL_MS]) {
      expect(consultarTrialEmpresa(dados, new Date(dados.trialTerminaEm.getTime() + atraso)).bloqueado).toBe(true);
    }
  });
  it('recusa trial sem datas ou com inicio futuro', () => {
    expect(consultarTrialEmpresa({ ...dados, trialTerminaEm: null }, inicio).bloqueado).toBe(true);
    expect(consultarTrialEmpresa(dados, new Date(inicio.getTime() - 1)).bloqueado).toBe(true);
  });
});
