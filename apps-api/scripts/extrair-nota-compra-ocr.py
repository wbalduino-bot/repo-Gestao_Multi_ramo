"""Extrator OCR piloto a partir dos bytes da nota. Sem banco."""

import importlib.util
import json
import re
import sys
import tempfile
from decimal import Decimal
from pathlib import Path

BASE = Path(__file__).resolve().parent
LIMITE_BYTES = 20 * 1024 * 1024


def modulo(nome, caminho):
    if not caminho.is_file():
        raise FileNotFoundError(str(caminho))

    spec = importlib.util.spec_from_file_location(nome, caminho)
    if spec is None or spec.loader is None:
        raise RuntimeError("Modulo nao pode ser carregado.")

    instancia = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(instancia)
    return instancia


def extrair(conteudo):
    if not conteudo:
        raise ValueError("Documento vazio.")

    if len(conteudo) > LIMITE_BYTES:
        raise ValueError("Documento excede 20 MB.")

    ocr = modulo(
        "ocr_piloto",
        BASE / "testar-ocr-nota-compra.py",
    )
    parser = modulo(
        "parser_piloto",
        BASE / "testar-parser-ocr-nota-compra.py",
    )

    extensao = ".pdf" if conteudo.startswith(b"%PDF-") else ".png"

    # Arquivo temporario removido automaticamente.
    with tempfile.TemporaryDirectory(prefix="agc-ocr-") as pasta:
        caminho = Path(pasta) / ("entrada" + extensao)
        caminho.write_bytes(conteudo)

        resultado = ocr.processar(caminho)

        paginas = resultado.get("paginas", [])
        if len(paginas) != 1:
            raise ValueError("Piloto exige uma pagina.")

        linhas = paginas[0]["linhas"]
        # Segundo leiaute OCR assistido (tabela CX).
        segundo = modulo("ocr_tabela_cx", BASE / "ocr-danfe-tabela-cx.py")
        if segundo.reconhece(linhas):
            return segundo.extrair(caminho, linhas, parser)
        imagem = parser.carregar_imagem(caminho)

        emitente = parser.reler_regiao(
            imagem, (120, 730, 1550, 1180)
        )
        identificacao = parser.reler_regiao(
            imagem, (1550, 730, 3200, 1180)
        )
        destinatario = parser.reler_regiao(
            imagem, (120, 1190, 3200, 1460)
        )

    cnj_emitente = parser.extrair_cnpj(emitente)
    cnj_destinatario = parser.extrair_cnpj(destinatario)

    nomes = [
        linha.strip()
        for linha in emitente.splitlines()
        if re.search(
            r"\b(?:S\.?A\.?|LTDA|EIRELI)\b",
            linha,
            re.IGNORECASE,
        )
        and 5 <= len(linha.strip()) <= 120
    ]

    numero = re.search(
        r"N[º°o]?\s*[°º]?\s*(\d{5,9})",
        identificacao,
        re.IGNORECASE,
    )

    serie = re.search(
        r"S[EÉ]RIE\s*(\d{1,3})",
        identificacao,
        re.IGNORECASE,
    )

    itens, avisos = parser.extrair_itens(linhas)

    soma = sum(
        (Decimal(i["valorTotalItemNota"]) for i in itens),
        Decimal("0"),
    )

    candidatos_total = [
        linha.get("texto", "").strip()
        for linha in linhas
        if 2870 <= int(linha.get("x", -1)) <= 3150
        and 2200 <= int(linha.get("y", -1)) <= 2255
        and re.fullmatch(
            r"\d+,\d{2}",
            linha.get("texto", "").strip(),
        )
    ]

    total_declarado = (
        parser.decimal_ocr(candidatos_total[0])
        if len(candidatos_total) == 1
        else None
    )

    if total_declarado is None:
        avisos.append("Total dos produtos exige conferencia.")
    elif soma != total_declarado:
        avisos.append("Soma dos itens diverge do total fiscal.")

    if len(cnj_emitente) != 1:
        avisos.append("CNPJ do emitente exige conferencia.")

    if len(cnj_destinatario) != 1:
        avisos.append("CNPJ destinatario exige conferencia.")

    if not nomes:
        avisos.append("Nome do fornecedor exige conferencia.")

    if not numero or not serie:
        avisos.append("Numero ou serie exige conferencia.")

    avisos.extend([
        "Data de emissao exige conferencia.",
        "Unidades e embalagens exigem conferencia.",
        "Descricoes OCR exigem revisao.",
    ])

    return {
        "modoExtracao": "OCR_PILOTO",
        "fornecedorNome": nomes[0] if nomes else None,
        "fornecedorCnpj": (
            cnj_emitente[0] if len(cnj_emitente) == 1 else None
        ),
        "destinatarioCnpj": (
            cnj_destinatario[0]
            if len(cnj_destinatario) == 1 else None
        ),
        "numeroNota": numero.group(1) if numero else None,
        "serieNota": serie.group(1) if serie else None,
        "emitidaEm": None,
        "totalItens": len(itens),
        "valorTotalProdutos": (
            str(total_declarado)
            if total_declarado is not None else None
        ),
        "somaItensExtraidos": str(soma),
        "itens": itens,
        "avisos": avisos,
        "aptoParaConfirmacaoAutomatica": False,
    }


if __name__ == "__main__":
    try:
        conteudo = sys.stdin.buffer.read(LIMITE_BYTES + 1)
        resultado = extrair(conteudo)
        print(json.dumps(resultado, ensure_ascii=True, indent=2))
    except Exception as erro:
        print(
            "Falha no extrator OCR piloto: "
            + type(erro).__name__
            + ": " + str(erro),
            file=sys.stderr,
        )
        sys.exit(1)
