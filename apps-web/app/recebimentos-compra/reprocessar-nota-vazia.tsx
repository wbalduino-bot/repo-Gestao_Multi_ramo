"use client";

import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import styles from "../configuracao-fiscal/configuracao-fiscal.module.css";

export function ReprocessarNotaVazia({ apiUrl, arquivoId, versaoExtracao, bloqueado, aoOcupar, aoConcluir }: {
  apiUrl: string;
  arquivoId: string;
  versaoExtracao: string;
  bloqueado: boolean;
  aoOcupar: (ocupado: boolean) => void;
  aoConcluir: () => void;
}) {
  const router = useRouter();
  const trava = useRef(false);
  const [aberto, setAberto] = useState(false);
  const [justificativa, setJustificativa] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState("");
  const [recarregar, setRecarregar] = useState(false);
  function fechar() { setAberto(false); aoOcupar(false); }
  async function reprocessar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    if (trava.current || recarregar) return;
    const token = sessionStorage.getItem("gestao.accessToken");
    if (!token) { router.replace("/"); return; }
    trava.current = true;
    setEnviando(true);
    setErro("");
    try {
      const resposta = await fetch(`${apiUrl}/recebimentos-compra/notas-pendentes/${encodeURIComponent(arquivoId)}/reprocessar`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ justificativa: justificativa.trim(), versaoExtracao }),
      });
      if (resposta.status === 401) {
        sessionStorage.removeItem("gestao.accessToken");
        sessionStorage.removeItem("gestao.usuario");
        router.replace("/");
        return;
      }
      if (!resposta.ok) {
        const dados: unknown = await resposta.json().catch(() => null);
        const mensagem = dados && typeof dados === "object" && "message" in dados ? dados.message : null;
        if (resposta.status === 409 || resposta.status >= 500) setRecarregar(true);
        throw new Error(typeof mensagem === "string" ? mensagem : "Não foi possível reprocessar. Atualize a lista antes de tentar novamente.");
      }
      setAberto(false);
      aoConcluir();
    } catch (falha) {
      if (falha instanceof TypeError) {
        setRecarregar(true);
        setErro("A resposta não chegou. Feche e atualize as notas para consultar o resultado antes de reenviar.");
      } else setErro(falha instanceof Error ? falha.message : "Não foi possível reprocessar.");
    } finally {
      trava.current = false;
      setEnviando(false);
    }
  }
  if (!aberto) return <button type="button" className={styles.secundario} disabled={bloqueado}
    onClick={() => { setAberto(true); aoOcupar(true); }}>Reprocessar leitura</button>;
  return <form onSubmit={reprocessar} aria-label="Reprocessar prévia vazia">
    <p>Relê o PDF original e preserva a leitura anterior. Não confirma entrada no estoque.</p>
    <label className={styles.campo}>Motivo do reprocessamento
      <input required minLength={10} maxLength={500} disabled={enviando || recarregar}
        value={justificativa} onChange={e => setJustificativa(e.target.value)} />
    </label>
    <button type="submit" className={styles.primario} disabled={enviando || recarregar}>
      {enviando ? "Relendo documento…" : "Reprocessar PDF"}
    </button>
    <button type="button" className={styles.secundario} disabled={enviando} onClick={fechar}>Fechar</button>
    {erro && <p role="alert">{erro}</p>}
  </form>;
}
