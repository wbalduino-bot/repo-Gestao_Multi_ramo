"use client";

/**
 * Componente reutilizável para controlar o acesso visual
 * às páginas que exigem uma sessão autenticada.
 *
 * O componente verifica se existe um token na sessão do navegador.
 * Caso não exista, redireciona o usuário para a página de login.
 *
 * Importante:
 * Esta verificação não substitui a validação do token pela API.
 * O backend continua responsável por autorizar cada requisição.
 */

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";

type ProtecaoSessaoProps = {
  children: ReactNode;
};

export function ProtecaoSessao({
  children,
}: ProtecaoSessaoProps) {
  // Controla a navegação para a página de login.
  const router = useRouter();

  // Impede que o conteúdo protegido apareça antes da verificação.
  const [autorizado, setAutorizado] = useState(false);

  useEffect(() => {
    // O sessionStorage só pode ser consultado no navegador.
    const token = sessionStorage.getItem("gestao.accessToken");

    // Sem token, o usuário deve retornar à página de login.
    if (!token) {
      router.replace("/");
      return;
    }

    // Existe um token armazenado; permite exibir a página.
    // A validade real do token será confirmada pelo backend
    // quando a aplicação fizer uma requisição autenticada.
    setAutorizado(true);
  }, [router]);

  // Exibe uma tela neutra enquanto a sessão é verificada.
  if (!autorizado) {
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
        Verificando sessão...
      </main>
    );
  }

  // Somente renderiza o conteúdo após encontrar o token.
  return <>{children}</>;
}