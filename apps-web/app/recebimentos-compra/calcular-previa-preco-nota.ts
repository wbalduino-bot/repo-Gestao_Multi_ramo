export function calcularPreviaPrecoNota(
  valorTotal: string | undefined,
  quantidade: number,
  percentual: string | number | null | undefined,
) {
  if (!valorTotal || !/^\d{1,18}\.\d{2}$/.test(valorTotal) ||
      !Number.isFinite(quantidade) || quantidade <= 0) return null;

  const partes = /^(\d{1,5})(?:\.(\d{1,2}))?$/.exec(String(percentual ?? 43));
  if (!partes) return null;

  const totalCentavos = BigInt(valorTotal.replace(".", ""));
  const quantidadeMilesimos = BigInt(quantidade.toFixed(3).replace(".", ""));
  if (quantidadeMilesimos === BigInt(0)) return null;
  const percentualCentesimos =
    BigInt(partes[1]) * BigInt(100) + BigInt((partes[2] ?? "").padEnd(2, "0"));
  const arredondar = (numerador: bigint, denominador: bigint) =>
    (numerador * BigInt(2) + denominador) / (denominador * BigInt(2));

  const custo = arredondar(totalCentavos * BigInt(1000), quantidadeMilesimos);
  const preco = arredondar(custo * (BigInt(10000) + percentualCentesimos), BigInt(10000));
  if (custo <= BigInt(0) || preco > BigInt("999999999999")) return null;

  return {
    custo: Number(custo) / 100,
    preco: Number(preco) / 100,
    percentual: Number(percentualCentesimos) / 100,
  };
}
