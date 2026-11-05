/**
 * Configuração compartilhada apenas pela área administrativa SaaS.
 * Mantém a sessão da plataforma separada do login empresarial existente.
 */
export const API_URL_ADMIN = (
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5433"
).replace(/\/$/, "");

export const CHAVE_ADMIN_TOKEN = "gestao.admin.accessToken";
export const CHAVE_ADMIN_USUARIO = "gestao.admin.usuario";

/** Remove somente a autenticação administrativa, sem afetar o caixa ou a empresa. */
export function limparSessaoAdmin(): void {
  sessionStorage.removeItem(CHAVE_ADMIN_TOKEN);
  sessionStorage.removeItem(CHAVE_ADMIN_USUARIO);
}

/** Extrai respostas de erro do NestJS sem exibir detalhes internos inesperados. */
export async function lerMensagemErro(
  resposta: Response,
  mensagemPadrao: string,
): Promise<string> {
  try {
    const dados: unknown = await resposta.json();
    if (typeof dados !== "object" || dados === null || !("message" in dados)) {
      return mensagemPadrao;
    }
    const mensagem = dados.message;
    if (typeof mensagem === "string" && mensagem.trim()) {
      return mensagem;
    }
    if (Array.isArray(mensagem)) {
      const partes = mensagem.filter((item): item is string => typeof item === "string");
      return partes.length ? partes.join(", ") : mensagemPadrao;
    }
  } catch {
    // Respostas não JSON também recebem uma mensagem segura e legível.
  }
  return mensagemPadrao;
}
