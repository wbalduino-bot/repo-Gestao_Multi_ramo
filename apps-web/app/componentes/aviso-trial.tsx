"use client";

import { useEffect, useState } from "react";

/** Aviso compartilhado das telas empresariais, atualizado pelo servidor. */
export function AvisoTrial() {
  const [trial, setTrial] = useState<{ terminaEm: string; diasRestantes: number } | null>(null);
  const [bloqueado, setBloqueado] = useState(false);

  useEffect(() => {
    const controle = new AbortController();
    let consultando = false;
    const apiUrl = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001").replace(/\/$/, "");
    async function consultar() {
      if (consultando || document.visibilityState === "hidden") return;
      const token = sessionStorage.getItem("gestao.accessToken");
      if (!token) return;
      consultando = true;
      try {
        const resposta = await fetch(`${apiUrl}/usuarios/me`, {
          headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: controle.signal,
        });
        const dados = await resposta.json().catch(() => null);
        if (controle.signal.aborted) return;
        if (resposta.status === 401 && dados?.codigo === "TRIAL_EXPIRADO") {
          setBloqueado(true);
          return;
        }
        if (!resposta.ok) return;
        setBloqueado(false);
        const valor = dados?.trial;
        setTrial(valor && typeof valor.terminaEm === "string" &&
          Number.isFinite(Date.parse(valor.terminaEm)) && Number.isInteger(valor.diasRestantes)
          ? valor : null);
      } catch {
        // Uma falha temporaria preserva o aviso; a API autoriza cada operacao.
      } finally { consultando = false; }
    }
    void consultar();
    const temporizador = window.setInterval(() => void consultar(), 60_000);
    const atualizar = () => void consultar();
    window.addEventListener("focus", atualizar);
    document.addEventListener("visibilitychange", atualizar);
    return () => {
      controle.abort(); window.clearInterval(temporizador);
      window.removeEventListener("focus", atualizar);
      document.removeEventListener("visibilitychange", atualizar);
    };
  }, []);

  if (bloqueado) return (
    <div role="alertdialog" aria-modal="true" aria-labelledby="titulo-trial-vencido"
      style={{ position: "fixed", inset: 0, zIndex: 10000, background: "#102338f5", color: "#fff", display: "grid", placeItems: "center", padding: 24 }}>
      <section style={{ maxWidth: 520 }}>
        <h2 id="titulo-trial-vencido">Período de teste encerrado</h2>
        <p>Entre em contato com o administrador do sistema para liberar o acesso. Seus dados estão preservados.</p>
        <button type="button" onClick={() => window.location.reload()}>Verificar liberação</button>
        <a href="/" style={{ color: "#fff", marginLeft: 16 }}>Voltar ao login</a>
      </section>
    </div>
  );
  if (!trial || trial.diasRestantes < 1 || trial.diasRestantes > 8) return null;
  return (
    <section role="status" aria-live="polite" aria-label="Prazo da versão trial"
      style={{ background: "#fff3cd", color: "#533f03", border: "1px solid #e3be54", borderRadius: 8, padding: 12, margin: "12px 8px", fontSize: 14, lineHeight: 1.5 }}>
      <strong>Sua versão trial vence em {trial.diasRestantes} {trial.diasRestantes === 1 ? "dia" : "dias"}.</strong>
      <p style={{ margin: "6px 0 0" }}>Entre em contato com o administrador do sistema para liberar o uso definitivo e evitar o bloqueio.</p>
      <small>Vencimento: {new Date(trial.terminaEm).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })} (Brasília).</small>
    </section>
  );
}
