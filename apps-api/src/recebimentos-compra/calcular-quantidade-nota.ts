const MAXIMO_EM_MILESIMOS = 99_999_999_999_999;

function normalizarUnidade(unidade: string): string {
  const codigo = unidade.trim().toUpperCase();
  return ['UND', 'UNID', 'UNIDADE'].includes(codigo) ? 'UN' : codigo;
}

export function calcularQuantidadeNota(
  quantidadeNota: string,
  unidadeNota: string,
  unidadeEstoque: string,
  fatorEmbalagem?: number,
): number | null {
  const partes = /^(\d{1,11})(?:\.(\d{1,3}))?$/.exec(quantidadeNota);
  if (!partes) return null;

  const origem = normalizarUnidade(unidadeNota);
  const destino = normalizarUnidade(unidadeEstoque);
  if (!origem || !destino) return null;

  let milesimos = Number(partes[1]) * 1000 + Number((partes[2] ?? '').padEnd(3, '0'));
  const embalagem = origem === 'PC' || origem === 'CX';

  if (embalagem) {
    if (destino !== 'UN' || fatorEmbalagem === undefined ||
        !Number.isSafeInteger(fatorEmbalagem) || fatorEmbalagem < 1) {
      return null;
    }
    milesimos *= fatorEmbalagem;
  } else if (origem !== destino || fatorEmbalagem !== undefined) {
    return null;
  }

  if (milesimos <= 0 || milesimos > MAXIMO_EM_MILESIMOS ||
      (destino === 'UN' && milesimos % 1000 !== 0)) {
    return null;
  }

  return milesimos / 1000;
}

export function codigosUnidadeEstoqueDaNota(unidadeNota: string): string[] {
  const codigo = normalizarUnidade(unidadeNota);
  return ['PC', 'CX', 'UN'].includes(codigo)
    ? ['UN', 'UND', 'UNID', 'UNIDADE']
    : [codigo];
}
