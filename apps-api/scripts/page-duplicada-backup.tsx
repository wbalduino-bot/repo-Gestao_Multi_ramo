
"use client";

// Importa os recursos do React que vamos utilizar na tela.
import { useState } from "react";

// Endereço da API de autenticação.
// O backend precisa estar em execução na porta 5433.
const API_URL = "http://localhost:5433";

export default function PaginaLogin() {
  // Guarda os valores digitados pelo usuário.
  const [empresaId, setEmpresaId] = useState("");
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");

  // Controla a exibição da senha, o carregamento e as mensagens.
  const [mostrarSenha, setMostrarSenha] = useState(false);
  const [carregando, setCarregando] = useState(false);
  const [mensagem, setMensagem] = useState("");

  // Executa quando o usuário envia o formulário.
  async function fazerLogin(evento: React.FormEvent<HTMLFormElement>) {
    evento.preventDefault();
        // Diagnóstico: confirma se o formulário foi enviado.
    console.log("FORMULÁRIO ENVIADO");
    console.log("API:", `${API_URL}/auth/login`);
    setMensagem("");
    setCarregando(true);

    try {
      // Envia as credenciais para o endpoint de login existente.
      const resposta = await fetch(`${API_URL}/auth/login`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          empresaId,
          email,
          senha,
        }),
      });

      // Converte a resposta da API em um objeto JavaScript.
      const dados = await resposta.json();

      // Se a API rejeitar o login, apresenta uma mensagem.
      if (!resposta.ok) {
        setMensagem(
          typeof dados.message === "string"
            ? dados.message
            : "Não foi possível entrar. Confira seus dados."
        );
        return;
      }

      // Confirma que a autenticação foi aceita.
      // Ainda vamos implementar a navegação para a área interna.
      setMensagem("Login realizado com sucesso!");

      // Por segurança, não armazenamos o token no navegador nesta etapa.
      console.log("Autenticação concluída.");
    } catch {
      // Informa quando o navegador não consegue acessar a API.
      setMensagem(
        "Não foi possível conectar ao servidor. Verifique se o backend está rodando."
      );
    } finally {
      // Libera o botão mesmo quando ocorre algum erro.
      setCarregando(false);
    }
  }

  return (
    <main className="login-page">
      <section className="login-brand">
        <div className="brand-content">
          <p className="brand-label">GESTÃO INTELIGENTE</p>
          <h1>Gestão Comercial</h1>
          <p>
            Controle e organização para simplificar a gestão do seu negócio.
          </p>
        </div>
      </section>

      <section className="login-area">
        <div className="login-card">
          <p className="form-label">BEM-VINDO</p>
          <h2>Acesse sua conta</h2>
          <p className="form-description">
            Informe seus dados para continuar.
          </p>

          <form onSubmit={fazerLogin}>
            <label htmlFor="empresaId">Identificador da empresa</label>
            <input
              id="empresaId"
              type="text"
              value={empresaId}
              onChange={(evento) => setEmpresaId(evento.target.value)}
              placeholder="Identificador da empresa"
              required
            />

            <label htmlFor="email">E-mail</label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(evento) => setEmail(evento.target.value)}
              placeholder="seu@email.com"
              autoComplete="username"
              required
            />

            <label htmlFor="senha">Senha</label>
            <div className="password-wrapper">
              <input
                id="senha"
                type={mostrarSenha ? "text" : "password"}
                value={senha}
                onChange={(evento) => setSenha(evento.target.value)}
                placeholder="Digite sua senha"
                autoComplete="current-password"
                required
              />

              <button
                className="password-toggle"
                type="button"
                onClick={() => setMostrarSenha(!mostrarSenha)}
              >
                {mostrarSenha ? "Ocultar" : "Mostrar"}
              </button>
            </div>

            {mensagem && (
              <p role="status" aria-live="polite">
                {mensagem}
              </p>
            )}

        {/* Botão para enviar o formulário de login */}
        <button
        className="login-button"
        type="submit"
        disabled={carregando}
        onClick={() => {
        console.log("O botão Entrar foi clicado");
        }}
        >
        {carregando ? "Entrando..." : "Entrar"}
        </button>
          </form>
        </div>
      </section>
    </main>
  );
}
