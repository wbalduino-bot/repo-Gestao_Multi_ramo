"use client";

import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import styles from "../configuracao-fiscal/configuracao-fiscal.module.css";
import type { NotaAgente } from "./formulario-recebimento";

type Linha = {
  indiceNota: number;
  descricaoNota: string;
  quantidadeNota: string;
  unidadeNota: string;
  valorUnitarioNota: string;
  valorTotalItemNota: string;
};

// Mantem os decimais como texto, inclusive os seis digitos do unitario.
function decimal(valor: string, casas: number, inteiros: number, minimo: number) {
  const texto = valor.trim().replace(",", ".");
  const padrao = new RegExp(`^\\d{1,${inteiros}}(?:\\.\\d{1,${casas}})?$`);
  if (!padrao.test(texto)) throw new Error("Confira os valores numéricos de todos os itens.");
  const [parte, fracao = ""] = texto.split(".");
  return parte + (fracao || minimo ? "." + fracao.padEnd(minimo, "0") : "");
}

function mensagem(dados: unknown) {
  if (dados && typeof dados === "object" && "message" in dados) {
    if (typeof dados.message === "string") return dados.message;
    if (Array.isArray(dados.message)) return dados.message.filter(v => typeof v === "string").join(" ");
  }
  return "Não foi possível salvar a revisão. Confira os dados e tente novamente.";
}

export function RevisaoNotaOcr({ apiUrl, notaId, nota, aoSalvar, aoFechar }: {
  apiUrl: string;
  notaId: string;
  nota: NotaAgente;
  aoSalvar: () => void;
  aoFechar: () => void;
}) {
  const router = useRouter();
  const enviando = useRef(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const [conflito, setConflito] = useState(false);
  const [emitidaEm, setEmitidaEm] = useState(nota.emitidaEm?.slice(0, 10) ?? "");
  const [justificativa, setJustificativa] = useState("");
  const [totalProdutos, setTotalProdutos] = useState(() => {
    const valor = (nota as NotaAgente & { valorTotalProdutos?: string | null }).valorTotalProdutos;
    return typeof valor === "string" ? valor : "";
  });
  const [linhas, setLinhas] = useState<Linha[]>(() => nota.itens.map((linha, indiceNota) => ({
    indiceNota,
    descricaoNota: linha.descricaoNota,
    quantidadeNota: (linha.quantidadeNota ?? "").replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, ""),
    unidadeNota: linha.unidadeNota ?? "",
    valorUnitarioNota: linha.valorUnitarioNota ?? "",
    valorTotalItemNota: linha.valorTotalItemNota ?? "",
  })));

  function alterar(indice: number, campo: keyof Omit<Linha, "indiceNota">, valor: string) {
    setLinhas(atuais => atuais.map((linha, i) => i === indice ? { ...linha, [campo]: valor } : linha));
  }

  async function salvar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    if (enviando.current || conflito) return;
    const token = sessionStorage.getItem("gestao.accessToken");
    if (!token) { router.replace("/"); return; }
    setErro("");
    enviando.current = true;
    setSalvando(true);
    try {
      if (justificativa.trim().length < 10) throw new Error("Informe uma justificativa com pelo menos 10 caracteres.");
      const itens = linhas.map(linha => ({
        ...linha,
        descricaoNota: linha.descricaoNota.trim(),
        unidadeNota: linha.unidadeNota.trim().toUpperCase(),
        quantidadeNota: decimal(linha.quantidadeNota, 3, 11, 0),
        valorUnitarioNota: decimal(linha.valorUnitarioNota, 6, 12, 1),
        valorTotalItemNota: decimal(linha.valorTotalItemNota, 2, 18, 2),
      }));
      const resposta = await fetch(
        `${apiUrl}/recebimentos-compra/notas-pendentes/${encodeURIComponent(notaId)}/revisar`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ emitidaEm, valorTotalProdutos: decimal(totalProdutos, 2, 18, 2), justificativa: justificativa.trim(), itens }),
        },
      );
      if (resposta.status === 401) {
        sessionStorage.removeItem("gestao.accessToken");
        sessionStorage.removeItem("gestao.usuario");
        router.replace("/");
        return;
      }
      if (resposta.status === 409) {
        setConflito(true);
        setErro("A nota mudou durante a conferência. Feche esta revisão, atualize as notas e abra novamente antes de editar.");
        return;
      }
      if (!resposta.ok) {
        setErro(mensagem(await resposta.json().catch(() => null)));
        return;
      }
      // Reconsulta a nota salva no servidor; nao libera estoque pelo estado local.
      aoSalvar();
    } catch (falha) {
      setErro(falha instanceof TypeError
        ? "Falha de comunicação. Feche e atualize as notas para conferir se a revisão foi salva antes de reenviar."
        : falha instanceof Error ? falha.message : "Não foi possível concluir a revisão.");
    } finally {
      enviando.current = false;
      setSalvando(false);
    }
  }

  return (
    <section className={styles.cartao} aria-labelledby="titulo-revisao-ocr" style={{ marginBottom: "1rem" }}>
      <h2 id="titulo-revisao-ocr">Revisar leitura da nota {nota.numeroNota}</h2>
      <p>{nota.fornecedorNome} · Série {nota.serieNota}</p>
      <p>Confira cada campo no documento original. Salvar a revisão não cadastra produtos nem movimenta o estoque.</p>
      {!!nota.avisos?.length && <ul>{nota.avisos.map((aviso, i) => <li key={i}>{aviso}</li>)}</ul>}
      <form onSubmit={salvar}>
        <fieldset className={styles.campos} disabled={salvando || conflito}>
          <legend className={styles.legenda}>Dados conferidos no documento</legend>
          <label className={styles.campo}>Data de emissão
            <input required type="date" value={emitidaEm} onChange={e => setEmitidaEm(e.target.value)} />
          </label>
          <label className={styles.campo}>Total dos produtos no documento
            <input required inputMode="decimal" value={totalProdutos}
              onChange={e => setTotalProdutos(e.target.value)} placeholder="Sem separador de milhar" />
            <small>Leia o campo de total dos produtos na nota original. Ele pode diferir do total geral da nota.</small>
          </label>
          {linhas.map((linha, i) => (
            <fieldset key={linha.indiceNota} className={styles.campos}>
              <legend>Item {i + 1} · Código fornecedor {nota.itens[i].codigoFornecedor}</legend>
              {nota.itens[i].valoresConferem === false && <p role="status">A leitura original tem divergência de valores. Confira quantidade, unitário e total.</p>}
              <div className={styles.grade}>
                <label className={styles.campo}>Descrição
                  <input required maxLength={250} value={linha.descricaoNota} onChange={e => alterar(i, "descricaoNota", e.target.value)} />
                </label>
                <label className={styles.campo}>Quantidade na nota
                  <input required inputMode="decimal" value={linha.quantidadeNota} onChange={e => alterar(i, "quantidadeNota", e.target.value)} />
                </label>
                <label className={styles.campo}>Unidade na nota
                  <input required maxLength={6} pattern="[A-Za-z0-9]{1,6}" value={linha.unidadeNota} onChange={e => alterar(i, "unidadeNota", e.target.value)} />
                </label>
                <label className={styles.campo}>Valor unitário da nota (até 6 casas)
                  <input required inputMode="decimal" value={linha.valorUnitarioNota} onChange={e => alterar(i, "valorUnitarioNota", e.target.value)} />
                </label>
                <label className={styles.campo}>Total do item
                  <input required inputMode="decimal" value={linha.valorTotalItemNota} onChange={e => alterar(i, "valorTotalItemNota", e.target.value)} />
                </label>
              </div>
            </fieldset>
          ))}
          <label className={styles.campo}>Justificativa da revisão
            <textarea required minLength={10} maxLength={500} value={justificativa} onChange={e => setJustificativa(e.target.value)} />
          </label>
          <button className={styles.primario} type="submit">{salvando ? "Salvando revisão…" : "Salvar revisão fiscal"}</button>
        </fieldset>
        <button type="button" className={styles.secundario} disabled={salvando} onClick={aoFechar}>Fechar revisão</button>
      </form>
      {erro && <p className={styles.erro} role="alert">{erro}</p>}
    </section>
  );
}
