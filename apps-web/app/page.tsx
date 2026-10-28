"use client";

// Importa o recurso do React usado para guardar e atualizar informações da tela.
import { useState } from "react";

// Importa o roteador do Next.js para navegar entre as páginas.
import { useRouter } from "next/navigation";

// Endereço do backend configurável por variável de ambiente.
// Caso a variável não esteja definida, utiliza o endereço local padrão.
const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5433";

// Componente principal da página de login.
export default function Home() {
  // Controla a navegação entre as páginas do sistema.
  const router = useRouter();

  // Guarda o identificador da empresa digitado pelo usuário.
  const [empresaId, setEmpresaId] = useState("");

  // Guarda o e-mail digitado no formulário.
  const [email, setEmail] = useState("");

  // Guarda a senha digitada no formulário.
  const [senha, setSenha] = useState("");

  // Controla se a senha aparece como texto ou fica oculta.
  const [mostrarSenha, setMostrarSenha] = useState(false);

  // Informa se a requisição de login está em andamento.
  const [carregando, setCarregando] = useState(false);

  // Guarda a mensagem de sucesso ou erro para exibir na tela.
  const [mensagem, setMensagem] = useState("");

  // Envia os dados preenchidos para o endpoint de autenticação.
  async function fazerLogin(evento: React.FormEvent<HTMLFormElement>) {
    // Impede que o navegador recarregue a página ao enviar o formulário.
    evento.preventDefault();

    // Limpa a mensagem anterior antes de iniciar uma nova tentativa.
    setMensagem("");

    // Ativa o carregamento para evitar envios repetidos.
    setCarregando(true);

    try {
      // Faz uma requisição POST para a API de autenticação.
      const resposta = await fetch(`${API_URL}/auth/login`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },

        // Envia os campos esperados pelo backend.
        body: JSON.stringify({
          empresaId,
          email,
          senha,
        }),
      });

      // Converte a resposta da API para JSON.
      const dados = await resposta.json();

      // Se a API informar erro, apresenta a mensagem recebida.
      if (!resposta.ok) {
        const erro = Array.isArray(dados.message)
          ? dados.message.join(", ")
          : dados.message;

        setMensagem(
          typeof erro === "string"
            ? erro
            : "Não foi possível entrar. Confira seus dados."
        );

        return;
      }

      // Verifica se a API retornou o token de autenticação esperado.
      const token = dados?.accessToken;

      if (typeof token !== "string" || token.length === 0) {
        setMensagem(
          "A API respondeu ao login, mas não retornou um token válido."
        );

        return;
      }

      // Armazena o token durante a sessão atual do navegador.
      // O token será utilizado posteriormente nas requisições autenticadas.
      // Não armazenamos a senha do usuário.
      sessionStorage.setItem("gestao.accessToken", token);

      // Guarda os dados básicos do usuário para utilização na interface.
      if (dados.usuario) {
        sessionStorage.setItem(
          "gestao.usuario",
          JSON.stringify(dados.usuario)
        );
      } else {
        // Evita manter os dados de um usuário de uma sessão anterior.
        sessionStorage.removeItem("gestao.usuario");
      }

      // Redireciona o usuário para o painel principal após o login.
      router.replace("/dashboard");
    } catch {
      // Informa quando não é possível concluir a comunicação com a API.
      // Isso pode ocorrer quando o backend está desligado,
      // existe um problema de rede ou a resposta não pôde ser processada.
      setMensagem(
        "Não foi possível concluir o login. Verifique se o backend está ativo e tente novamente."
      );
    } finally {
      // Desativa o carregamento mesmo quando ocorre algum erro.
      setCarregando(false);
    }
  }

  return (
    // Elemento principal que envolve a tela de login.
    <main className="login-page">
      {/* Painel institucional exibido no lado esquerdo. */}
      <section className="login-brand">
        <div className="brand-content">
          {/* Identidade visual do sistema. */}
          <div className="brand-logo">
            <span className="brand-logo-icon">GC</span>

            <span>
              GESTÃO
              <span className="brand-light">COMERCIAL</span>
            </span>
          </div>

          {/* Mensagem de apresentação do sistema. */}
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

          {/* Frase institucional no rodapé do painel. */}
          <div className="brand-footer">
            CONTROLE · ORGANIZAÇÃO · RESULTADOS
          </div>
        </div>
      </section>

      {/* Área que contém o formulário de acesso. */}
      <section className="login-area">
        <div className="login-card">
          {/* Marca alternativa para telas menores. */}
          <div className="mobile-brand">
            <span className="brand-logo-icon">GC</span>
            <span>GESTÃO COMERCIAL</span>
          </div>

          {/* Título e instruções do formulário. */}
          <div className="login-heading">
            <span className="welcome-label">BEM-VINDO DE VOLTA</span>
            <h2>Acesse sua conta</h2>
            <p>Informe seus dados para entrar no sistema.</p>
          </div>

          {/* Formulário conectado à função de autenticação. */}
          <form className="login-form" onSubmit={fazerLogin}>
            {/* Campo que identifica a empresa do usuário. */}
            <div className="form-field">
              <label htmlFor="empresaId">
                Identificador da empresa
              </label>

              <input
                id="empresaId"
                name="empresaId"
                type="text"
                placeholder="Identificador da empresa"
                value={empresaId}
                onChange={(evento) => setEmpresaId(evento.target.value)}
                autoComplete="organization"
                required
              />
            </div>

            {/* Campo de e-mail. */}
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
                required
              />
            </div>

            {/* Campo de senha com controle de visibilidade. */}
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
                  required
                />

                {/* Botão para mostrar ou ocultar a senha. */}
                <button
                  type="button"
                  className="password-toggle"
                  onClick={() => setMostrarSenha(!mostrarSenha)}
                  aria-label={
                    mostrarSenha ? "Ocultar senha" : "Mostrar senha"
                  }
                >
                  {mostrarSenha ? "Ocultar" : "Mostrar"}
                </button>
              </div>
            </div>

            {/* Exibe mensagens de erro da autenticação. */}
            {mensagem && (
              <p role="status" aria-live="polite">
                {mensagem}
              </p>
            )}

            {/* Botão responsável por enviar o formulário à API. */}
            <button
              type="submit"
              className="login-button"
              disabled={carregando}
            >
              {carregando ? "Entrando..." : "Entrar no sistema"}
              <span aria-hidden="true">→</span>
            </button>
          </form>

          {/* Aviso sobre o acesso restrito. */}
          <div className="login-security">
            <span className="security-icon" aria-hidden="true">
              ✓
            </span>

            <span>Acesso destinado a usuários autorizados.</span>
          </div>

          {/* Rodapé informativo da página. */}
          <footer className="login-footer">
            Gestão Comercial · Ambiente de acesso
          </footer>
        </div>
      </section>
    </main>
  );
}