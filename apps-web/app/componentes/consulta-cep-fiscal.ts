"use client";

import { useEffect, useState } from "react";

export const UFS_BRASIL = [
  "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO",
  "MA", "MT", "MS", "MG", "PA", "PB", "PR", "PE", "PI",
  "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO",
] as const;

export const CAMPOS_ENDERECO_POR_CEP = [
  "logradouro",
  "bairro",
  "nomeMunicipio",
  "uf",
  "codigoMunicipio",
] as const;

type EnderecoPorCep = Partial<Record<(typeof CAMPOS_ENDERECO_POR_CEP)[number], string>>;

export function normalizarCepFiscal(valor: string): string {
  return valor.trim().replace(/^(\d{5})-(\d{3})$/, "$1$2");
}

type ConsultaCepFiscal = {
  cep: string;
  situacao: "encontrado" | "naoEncontrado" | "indisponivel";
  endereco?: EnderecoPorCep;
};

const MENSAGENS_CEP_FISCAL = {
  encontrado: "Confira o endereço preenchido e complete os campos necessários.",
  naoEncontrado: "CEP não encontrado. Confira o CEP ou preencha o endereço manualmente.",
  indisponivel: "Consulta de CEP indisponível. Você pode preencher o endereço manualmente.",
} as const;

/** Converte apenas os campos de endereço da resposta do ViaCEP. */
async function consultarEnderecoCep(
  cep: string,
  signal: AbortSignal,
): Promise<EnderecoPorCep | null> {
  const resposta = await fetch("https://viacep.com.br/ws/" + cep + "/json/", {
    signal,
    credentials: "omit",
    referrerPolicy: "no-referrer",
  });
  if (!resposta.ok) throw new Error("Consulta de CEP indisponível.");

  const conteudo: unknown = await resposta.json();
  if (!conteudo || typeof conteudo !== "object" || Array.isArray(conteudo)) {
    throw new Error("Resposta de CEP inválida.");
  }

  const dados = conteudo as Record<string, unknown>;
  if (dados.erro === true || dados.erro === "true") return null;

  const { cep: cepRetornado, logradouro, bairro, localidade, uf, ibge } = dados;
  if (
    typeof cepRetornado !== "string" ||
    normalizarCepFiscal(cepRetornado) !== cep ||
    typeof localidade !== "string" ||
    !localidade.trim() ||
    typeof uf !== "string" ||
    !UFS_BRASIL.some((sigla) => sigla === uf)
  ) {
    throw new Error("Resposta de CEP inválida.");
  }

  const endereco: EnderecoPorCep = { nomeMunicipio: localidade.trim(), uf };
  if (typeof logradouro === "string" && logradouro.trim()) endereco.logradouro = logradouro.trim();
  if (typeof bairro === "string" && bairro.trim()) endereco.bairro = bairro.trim();
  if (typeof ibge === "string" && /^\d{7}$/.test(ibge)) endereco.codigoMunicipio = ibge;
  return endereco;
}

export function useConsultaCepFiscal(cepFiscal: string, habilitada: boolean) {
  const [consultaCep, setConsultaCep] = useState<ConsultaCepFiscal | null>(null);
  const consultarCep = habilitada && /^\d{8}$/.test(cepFiscal);
  const consultaAtual = consultarCep && consultaCep?.cep === cepFiscal ? consultaCep : null;
  const consultandoCep = consultarCep && !consultaAtual;
  const mensagemCep = consultandoCep
    ? "Consultando endereço pelo CEP..."
    : consultaAtual ? MENSAGENS_CEP_FISCAL[consultaAtual.situacao] : "";

  useEffect(() => {
    if (!consultarCep) return;

    const controle = new AbortController();
    let ativa = true;

    async function consultar() {
      const limite = window.setTimeout(() => controle.abort(), 6_000);
      try {
        const endereco = await consultarEnderecoCep(cepFiscal, controle.signal);
        if (ativa) {
          setConsultaCep(endereco
            ? { cep: cepFiscal, situacao: "encontrado", endereco }
            : { cep: cepFiscal, situacao: "naoEncontrado" });
        }
      } catch {
        if (ativa) setConsultaCep({ cep: cepFiscal, situacao: "indisponivel" });
      } finally {
        window.clearTimeout(limite);
      }
    }

    // Espera a digitação estabilizar e descarta a consulta se o CEP mudar.
    const espera = window.setTimeout(() => void consultar(), 350);
    return () => {
      ativa = false;
      window.clearTimeout(espera);
      controle.abort();
    };
  }, [cepFiscal, consultarCep]);

  return {
    endereco: consultaAtual?.endereco,
    consultandoCep,
    mensagemCep,
    limparConsultaCep: () => setConsultaCep(null),
  };
}
