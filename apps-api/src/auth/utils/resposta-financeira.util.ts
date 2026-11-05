/**
 * Utilitários para autorização e filtragem de respostas financeiras.
 *
 * A filtragem é uma camada adicional: a autorização das rotas
 * gerenciais permanece sob responsabilidade dos guards.
 */

const CAMPOS_FINANCEIROS = new Set<string>([
  'custo',
  'custoUnitario',
  'custoTotal',
  'custoHistoricoDisponivel',
  'lucroBruto',
  'lucroBrutoTotal',
  'lucroBrutoUnitario',
  'margemBrutaPercentual',
  'markup',
  'markupPercentual',
]);

/** Somente administradores e gerentes consultam dados gerenciais. */
export function perfilTemAcessoGerencial(
  perfil: string | null | undefined,
): boolean {
  return perfil === 'ADMINISTRADOR' || perfil === 'GERENTE';
}

/**
 * Remove campos financeiros recursivamente, sem modificar a resposta
 * original. Objetos especiais, como Date e Decimal, são preservados.
 */
export function removerDadosFinanceiros<T>(valor: T): T {
  if (Array.isArray(valor)) {
    return valor.map((item) => removerDadosFinanceiros(item)) as T;
  }

  if (valor === null || typeof valor !== 'object') {
    return valor;
  }

  const prototipo = Object.getPrototypeOf(valor);

  if (prototipo !== Object.prototype && prototipo !== null) {
    return valor;
  }

  const resultado: Record<string, unknown> = {};

  for (const [campo, conteudo] of Object.entries(
    valor as Record<string, unknown>,
  )) {
    if (CAMPOS_FINANCEIROS.has(campo)) {
      continue;
    }

    resultado[campo] = removerDadosFinanceiros(conteudo);
  }

  return resultado as T;
}
