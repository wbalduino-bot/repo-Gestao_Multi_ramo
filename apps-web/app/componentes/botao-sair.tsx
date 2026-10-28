"use client";

/**
 * Botão reutilizável para encerrar a sessão local do usuário.
 *
 * Remove o token e os dados básicos da sessão antes de
 * encaminhar o usuário para a tela de login.
 *
 * O encerramento remove a sessão do navegador. Como o backend
 * utiliza JWT, a invalidação imediata de um token já emitido
 * exige um mecanismo adicional no servidor.
 */

import { useRouter } from "next/navigation";
import type { ReactNode } from "react";

type BotaoSairProps = {
  children: ReactNode;
  className?: string;
};

export function BotaoSair({
  children,
  className,
}: BotaoSairProps) {
  const router = useRouter();

  // Encerra a sessão armazenada neste navegador.
  function sair() {
    sessionStorage.removeItem("gestao.accessToken");
    sessionStorage.removeItem("gestao.usuario");

    // Retorna à tela de login sem manter a sessão no navegador.
    router.replace("/");
  }

  return (
    <button
      type="button"
      className={className}
      onClick={sair}
      style={{
        background: "transparent",
        border: 0,
        font: "inherit",
        color: "inherit",
        width: "100%",
        textAlign: "left",
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}