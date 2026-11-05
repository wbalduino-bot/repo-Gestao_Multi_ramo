"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import styles from "./admin-plataforma.module.css";
import {
  API_URL_ADMIN,
  CHAVE_ADMIN_TOKEN,
  CHAVE_ADMIN_USUARIO,
  lerMensagemErro,
} from "./sessao-admin";

type RespostaLogin = {
  accessToken?: unknown;
  administrador?: {
    id?: unknown;
    nome?: unknown;
    email?: unknown;
  };
};

/**
 * Entrada exclusiva do administrador SaaS.
 * Não solicita empresaId e nunca reutiliza o token empresarial.
 */
export default function LoginAdminPlataforma() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [mostrarSenha, setMostrarSenha] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState("");

  useEffect(() => {
    // O token é verificado efetivamente pelo backend ao abrir a listagem.
    if (sessionStorage.getItem(CHAVE_ADMIN_TOKEN)) {
      router.replace("/admin-plataforma/empresas");
    }
  }, [router]);

  async function entrar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    if (enviando) return;
    setErro("");
    setEnviando(true);

    try {
      const resposta = await fetch(`${API_URL_ADMIN}/admin-plataforma/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim().toLowerCase(), senha }),
      });

      if (!resposta.ok) {
        setErro(await lerMensagemErro(resposta, "Não foi possível autenticar o administrador."));
        return;
      }

      const dados: RespostaLogin = await resposta.json();
      if (typeof dados.accessToken !== "string" || !dados.accessToken) {
        setErro("O servidor não retornou um token administrativo válido.");
        return;
      }

      // A sessão SaaS é independente da sessão dos funcionários das empresas.
      sessionStorage.setItem(CHAVE_ADMIN_TOKEN, dados.accessToken);
      const administrador = dados.administrador;
      if (
        administrador &&
        typeof administrador.id === "string" &&
        typeof administrador.nome === "string" &&
        typeof administrador.email === "string"
      ) {
        sessionStorage.setItem(CHAVE_ADMIN_USUARIO, JSON.stringify(administrador));
      } else {
        sessionStorage.removeItem(CHAVE_ADMIN_USUARIO);
      }

      // A senha jamais é persistida no navegador.
      setSenha("");
      router.replace("/admin-plataforma/empresas");
    } catch {
      setErro("Não foi possível comunicar com a API. Verifique se o backend está ligado.");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <main className={styles.loginPagina}>
      <section className={styles.apresentacao}>
        <div className={styles.marca}>
          <span className={styles.marcaIcone}>GC</span>
          <span>GESTÃO COMERCIAL <small>PLATAFORMA</small></span>
        </div>
        <div className={styles.chamada}>
          <span className={styles.etiqueta}>ADMINISTRAÇÃO SAAS</span>
          <h1>Gestão central.<br />Acesso exclusivo.</h1>
          <p>Ambiente para administração das empresas clientes, separado do sistema operacional de cada empresa.</p>
        </div>
        <p className={styles.rodapeMarca}>Acesso restrito aos administradores da plataforma.</p>
      </section>

      <section className={styles.loginLado}>
        <div className={styles.loginCard}>
          <span className={styles.etiquetaClara}>PAINEL DA PLATAFORMA</span>
          <h2>Entrar como administrador</h2>
          <p className={styles.mutado}>Utilize suas credenciais administrativas. Não é necessário informar empresa.</p>

          <form onSubmit={entrar} className={styles.formulario}>
            <label htmlFor="admin-email">E-mail administrativo</label>
            <input
              id="admin-email"
              type="email"
              value={email}
              onChange={(evento) => setEmail(evento.target.value)}
              autoComplete="username"
              maxLength={160}
              placeholder="admin@plataforma.com.br"
              required
            />

            <label htmlFor="admin-senha">Senha</label>
            <div className={styles.campoSenha}>
              <input
                id="admin-senha"
                type={mostrarSenha ? "text" : "password"}
                value={senha}
                onChange={(evento) => setSenha(evento.target.value)}
                autoComplete="current-password"
                required
              />
              <button type="button" onClick={() => setMostrarSenha(!mostrarSenha)}>
                {mostrarSenha ? "Ocultar" : "Mostrar"}
              </button>
            </div>

            {erro && <p className={styles.mensagemErro} role="alert">{erro}</p>}
            <button type="submit" className={styles.botaoPrincipal} disabled={enviando}>
              {enviando ? "Validando acesso..." : "Acessar painel SaaS"}
            </button>
          </form>
          <p className={styles.aviso}>Este login não utiliza credenciais de funcionários das empresas.</p>
        </div>
      </section>
    </main>
  );
}
