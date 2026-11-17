"use client";

/**
 * Proteção compartilhada das páginas empresariais.
 *
 * A existência de um token no navegador não comprova
 * uma sessão válida: a identidade é confirmada pela API.
 *
 * O backend continua responsável por autorizar cada
 * operação e restringir o acesso conforme o perfil.
 */

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";

type ProtecaoSessaoProps = {
  children: ReactNode;
};

type EstadoSessao =
  | "verificando"
  | "autorizado"
  | "indisponivel";

type Identidade = {
  usuarioId: string;
  empresaId: string;
  perfil: string;
};

const API_URL = (
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001"
).replace(/\/$/, "");

/**
 * Confirma se a resposta apresenta os campos
 * mínimos esperados da identidade empresarial.
 */
function identidadeValida(valor: unknown): valor is Identidade {
  if (typeof valor !== "object" || valor === null) {
    return false;
  }

  const dados = valor as Record<string, unknown>;

  return (
    typeof dados.usuarioId === "string" &&
    dados.usuarioId.length > 0 &&
    typeof dados.empresaId === "string" &&
    dados.empresaId.length > 0 &&
    typeof dados.perfil === "string" &&
    dados.perfil.length > 0
  );
}

/**
 * Verifica a sessão no backend antes de permitir
 * a renderização do conteúdo protegido.
 */
export function ProtecaoSessao({
  children,
}: ProtecaoSessaoProps) {
  const router = useRouter();

  const [estado, setEstado] =
    useState<EstadoSessao>("verificando");

  // Permite repetir a consulta após uma falha de rede.
  const [tentativa, setTentativa] = useState(0);

  useEffect(() => {
    const controlador = new AbortController();
    let ativo = true;

    /**
     * Remove apenas a sessão empresarial.
     * A autenticação do administrador SaaS é independente.
     */
    function encerrarSessao() {
      if (!ativo) return;

      sessionStorage.removeItem("gestao.accessToken");
      sessionStorage.removeItem("gestao.usuario");

      router.replace("/");
    }

    async function verificarSessao() {
      setEstado("verificando");

      const token = sessionStorage.getItem(
        "gestao.accessToken"
      );

      if (!token) {
        encerrarSessao();
        return;
      }

      try {
        const resposta = await fetch(
          `${API_URL}/usuarios/me`,
          {
            method: "GET",
            headers: {
              Authorization: `Bearer ${token}`,
            },
            cache: "no-store",
            signal: controlador.signal,
          }
        );

        if (!ativo) return;

        // Somente uma rejeição de autenticação ou
        // autorização encerra a sessão armazenada.
        if (resposta.status === 401 ||
            resposta.status === 403) {
          encerrarSessao();
          return;
        }

        // Erros temporários não devem apagar o token.
        if (!resposta.ok) {
          setEstado("indisponivel");
          return;
        }

        const identidade: unknown = await resposta.json();

        if (!ativo) return;

        // Respostas inesperadas nunca liberam a página.
        if (!identidadeValida(identidade)) {
          setEstado("indisponivel");
          return;
        }

        setEstado("autorizado");
      } catch {
        // Uma tentativa cancelada não deve atualizar
        // o estado de um componente desmontado.
        if (!ativo) return;

        setEstado("indisponivel");
      }
    }

    void verificarSessao();

    return () => {
      ativo = false;
      controlador.abort();
    };
  }, [router, tentativa]);

  if (estado === "autorizado") {
    return <>{children}</>;
  }

  return (
    <main
      role="status"
      aria-live="polite"
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        padding: "24px",
      }}
    >
      {estado === "verificando" ? (
        <p>Verificando sessão...</p>
      ) : (
        <div style={{ textAlign: "center" }}>
          <p>
            Não foi possível validar sua sessão.
            Verifique a conexão com o servidor.
          </p>

          <button
            type="button"
            onClick={() => setTentativa((valor) => valor + 1)}
          >
            Tentar novamente
          </button>
        </div>
      )}
    </main>
  );
}
