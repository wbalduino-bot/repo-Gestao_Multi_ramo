"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

function mensagemDaApi(dados: unknown, padrao: string): string {
  if (!dados || typeof dados !== "object" || !("message" in dados)) {
    return padrao;
  }

  const mensagem = Array.isArray(dados.message)
    ? dados.message.filter((item) => typeof item === "string").join(", ")
    : dados.message;

  return typeof mensagem === "string" && mensagem ? mensagem : padrao;
}

export default function Home() {
  const router = useRouter();

  const [empresaId, setEmpresaId] = useState("");
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [mostrarSenha, setMostrarSenha] = useState(false);
  const [carregando, setCarregando] = useState(false);
  const [mensagem, setMensagem] = useState("");

  // A autorização temporária fica apenas na memória desta página.
  const [tokenPrimeiroAcesso, setTokenPrimeiroAcesso] = useState<string | null>(null);
  const [novaSenha, setNovaSenha] = useState("");
  const [confirmacaoSenha, setConfirmacaoSenha] = useState("");
  const primeiroAcesso = tokenPrimeiroAcesso !== null;

  function voltarAoLogin(aviso = "") {
    setTokenPrimeiroAcesso(null);
    setNovaSenha("");
    setConfirmacaoSenha("");
    setMensagem(aviso);
  }

  async function fazerLogin(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    if (carregando) return;

    setMensagem("");
    setCarregando(true);

    try {
      const resposta = await fetch(`${API_URL}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ empresaId, email, senha }),
      });
      const dados = await resposta.json();

      if (!resposta.ok) {
        setMensagem(mensagemDaApi(dados, "Não foi possível entrar. Confira seus dados."));
        return;
      }

      if (dados?.requerTrocaSenha === true) {
        const token = dados.tokenPrimeiroAcesso;
        if (typeof token !== "string" || !token) {
          setMensagem("Não foi possível iniciar a troca de senha. Tente entrar novamente.");
          return;
        }

        sessionStorage.removeItem("gestao.accessToken");
        sessionStorage.removeItem("gestao.usuario");
        setSenha("");
        setMostrarSenha(false);
        setTokenPrimeiroAcesso(token);
        return;
      }

      const token = dados?.accessToken;
      if (typeof token !== "string" || !token) {
        setMensagem("A API respondeu ao login, mas não retornou um token válido.");
        return;
      }

      sessionStorage.setItem("gestao.accessToken", token);
      if (dados.usuario) {
        sessionStorage.setItem("gestao.usuario", JSON.stringify(dados.usuario));
      } else {
        sessionStorage.removeItem("gestao.usuario");
      }

      router.replace("/dashboard");
    } catch {
      setMensagem(
        "Não foi possível concluir o login. Verifique se o backend está ativo e tente novamente.",
      );
    } finally {
      setCarregando(false);
    }
  }

  async function trocarSenha(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    if (carregando || !tokenPrimeiroAcesso) return;

    if (novaSenha !== confirmacaoSenha) {
      setMensagem("A confirmação deve ser igual à nova senha.");
      return;
    }

    setMensagem("");
    setCarregando(true);

    try {
      const resposta = await fetch(`${API_URL}/auth/primeiro-acesso`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${tokenPrimeiroAcesso}`,
        },
        body: JSON.stringify({ novaSenha }),
      });

      if (resposta.status === 204) {
        voltarAoLogin("Senha alterada com sucesso. Entre com sua nova senha.");
        return;
      }

      if (resposta.status === 401) {
        voltarAoLogin("A autorização de primeiro acesso expirou ou já foi usada. Entre novamente.");
        return;
      }

      const dados = await resposta.json().catch(() => null);
      setMensagem(mensagemDaApi(dados, "Não foi possível alterar a senha. Tente novamente."));
    } catch {
      setMensagem("Não foi possível confirmar a troca de senha. Verifique sua conexão e tente novamente.");
    } finally {
      setCarregando(false);
    }
  }

  return (
    <main className="login-page">
      <section className="login-brand">
        <div className="brand-content">
          <div className="brand-logo">
            <span className="brand-logo-icon">GC</span>
            <span>
              GESTÃO
              <span className="brand-light">COMERCIAL</span>
            </span>
          </div>

          <div className="brand-message">
            <span className="brand-tag">GESTÃO INTELIGENTE</span>
            <h1>
              Seu negócio.
              <br />
              Sob seu controle.
            </h1>
            <p>
              Organize sua operação, acompanhe seus resultados
              e tome decisões com mais segurança.
            </p>
          </div>

          <div className="brand-footer">
            CONTROLE · ORGANIZAÇÃO · RESULTADOS
          </div>
        </div>
      </section>

      <section className="login-area">
        <div className="login-card">
          <div className="mobile-brand">
            <span className="brand-logo-icon">GC</span>
            <span>GESTÃO COMERCIAL</span>
          </div>

          <div className="login-heading">
            <span className="welcome-label">
              {primeiroAcesso ? "PRIMEIRO ACESSO" : "BEM-VINDO DE VOLTA"}
            </span>
            <h2>{primeiroAcesso ? "Crie sua nova senha" : "Acesse sua conta"}</h2>
            <p>
              {primeiroAcesso
                ? "Escolha uma senha de 15 a 64 caracteres, diferente da senha temporária."
                : "Informe seus dados para entrar no sistema."}
            </p>
          </div>

          <form
            key={primeiroAcesso ? "primeiro-acesso" : "login"}
            className="login-form"
            onSubmit={primeiroAcesso ? trocarSenha : fazerLogin}
          >
            {primeiroAcesso ? (
              <>
                <div className="form-field">
                  <label htmlFor="novaSenha">Nova senha</label>
                  <input
                    id="novaSenha"
                    name="novaSenha"
                    type="password"
                    value={novaSenha}
                    onChange={(evento) => setNovaSenha(evento.target.value)}
                    autoComplete="new-password"
                    disabled={carregando}
                    required
                  />
                </div>
                <div className="form-field">
                  <label htmlFor="confirmacaoSenha">Confirmar senha</label>
                  <input
                    id="confirmacaoSenha"
                    name="confirmacaoSenha"
                    type="password"
                    value={confirmacaoSenha}
                    onChange={(evento) => setConfirmacaoSenha(evento.target.value)}
                    autoComplete="new-password"
                    disabled={carregando}
                    required
                  />
                </div>
              </>
            ) : (
              <>
                <div className="form-field">
                  <label htmlFor="empresaId">Identificador da empresa</label>
                  <input
                    id="empresaId"
                    name="empresaId"
                    type="text"
                    placeholder="Identificador da empresa"
                    value={empresaId}
                    onChange={(evento) => setEmpresaId(evento.target.value)}
                    autoComplete="organization"
                    disabled={carregando}
                    required
                  />
                </div>

                <div className="form-field">
                  <label htmlFor="email">E-mail</label>
                  <input
                    id="email"
                    name="email"
                    type="email"
                    placeholder="voce@empresa.com.br"
                    value={email}
                    onChange={(evento) => setEmail(evento.target.value)}
                    autoComplete="username"
                    disabled={carregando}
                    required
                  />
                </div>

                <div className="form-field">
                  <div className="password-label">
                    <label htmlFor="senha">Senha</label>
                  </div>
                  <div className="password-input">
                    <input
                      id="senha"
                      name="senha"
                      type={mostrarSenha ? "text" : "password"}
                      placeholder="Digite sua senha"
                      value={senha}
                      onChange={(evento) => setSenha(evento.target.value)}
                      autoComplete="current-password"
                      disabled={carregando}
                      required
                    />
                    <button
                      type="button"
                      className="password-toggle"
                      onClick={() => setMostrarSenha(!mostrarSenha)}
                      aria-label={mostrarSenha ? "Ocultar senha" : "Mostrar senha"}
                    >
                      {mostrarSenha ? "Ocultar" : "Mostrar"}
                    </button>
                  </div>
                </div>
              </>
            )}

            <button type="submit" className="login-button" disabled={carregando}>
              {primeiroAcesso
                ? (carregando ? "Salvando..." : "Salvar nova senha")
                : (carregando ? "Entrando..." : "Entrar no sistema")}
              <span aria-hidden="true">→</span>
            </button>

            {primeiroAcesso && (
              <button
                type="button"
                disabled={carregando}
                onClick={() => voltarAoLogin()}
              >
                Voltar ao login
              </button>
            )}
          </form>

          <div role="status" aria-live="polite">
            {mensagem && <p>{mensagem}</p>}
          </div>

          <div className="login-security">
            <span className="security-icon" aria-hidden="true">✓</span>
            <span>Acesso destinado a usuários autorizados.</span>
          </div>
          novaSenha deve ser entre 8 e 15 caracteres, diferente da senha temporária.
          <footer className="login-footer">
            Gestão Comercial · Ambiente de acesso
          </footer>
        </div>
      </section>
    </main>
  );
}
