/** Regras de prazo calculadas pelo servidor. Trinta dias equivalem a 720 horas. */
export const DIA_TRIAL_MS = 86_400_000;
export type DadosTrialEmpresa = {
  modalidadeAcesso: string;
  trialIniciadoEm: Date | null;
  trialTerminaEm: Date | null;
};

export function iniciarTrialEmpresa(agora = new Date()) {
  return {
    modalidadeAcesso: 'TRIAL' as const,
    trialIniciadoEm: agora,
    trialTerminaEm: new Date(agora.getTime() + 30 * DIA_TRIAL_MS),
  };
}

export function consultarTrialEmpresa(empresa: DadosTrialEmpresa, agora = new Date()) {
  if (empresa.modalidadeAcesso === 'DEFINITIVO') {
    return { bloqueado: false, trial: null };
  }
  const inicio = empresa.trialIniciadoEm;
  const fim = empresa.trialTerminaEm;
  if (empresa.modalidadeAcesso !== 'TRIAL' || !(inicio instanceof Date) ||
      !(fim instanceof Date) || !Number.isFinite(inicio.getTime()) ||
      !Number.isFinite(fim.getTime()) || inicio >= fim || inicio > agora) {
    return { bloqueado: true, trial: null };
  }
  const restante = fim.getTime() - agora.getTime();
  return {
    bloqueado: restante <= 0,
    trial: {
      terminaEm: fim.toISOString(),
      diasRestantes: Math.max(0, Math.ceil(restante / DIA_TRIAL_MS)),
    },
  };
}
