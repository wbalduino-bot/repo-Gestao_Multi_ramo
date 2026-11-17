"""Extrai uma prévia do leiaute DANFE validado no piloto."""
import io
import json
import re
import sys
from datetime import datetime
from decimal import Decimal

import pdfplumber
from pdfplumber.utils.exceptions import PdfminerException


class FormatoNaoReconhecido(ValueError):
    pass


def campo(padrao, texto):
    resultado = re.search(padrao, texto, re.MULTILINE)
    if resultado is None:
        raise FormatoNaoReconhecido()
    return resultado[1].strip()


def decimal_nota(valor):
    return Decimal(valor.replace(".", "").replace(",", "."))


def extrair(conteudo):
    with pdfplumber.open(io.BytesIO(conteudo)) as pdf:
        texto = "\n".join(pagina.extract_text(layout=True) or "" for pagina in pdf.pages)

    emitente = campo(
        r"IDENTIFICAÇÃO DO EMITENTE\s+([\s\S]+?)DESTINATÁRIO", texto
    )
    dinheiro = r"(?:\d{1,3}(?:\.\d{3})+|\d+),\d{2}"
    padrao_item = (
        r"^[ \t]*(\d+)[ \t]+(.+?)[ \t]+\d{8}[ \t]+\d{2,3}[ \t]+\d{4}"
        r"[ \t]+([A-Z0-9]{1,6})[ \t]+((?:\d{1,3}(?:\.\d{3})+|\d+),\d{3})"
        rf"[ \t]+({dinheiro})[ \t]+({dinheiro})(?=[ \t]|$)"
    )

    itens = []
    soma = Decimal(0)
    for codigo, descricao, unidade, quantidade, unitario, total in re.findall(
        padrao_item, texto, re.MULTILINE
    ):
        itens.append({
            "codigoFornecedor": codigo,
            "descricaoNota": descricao.strip(),
            "unidadeNota": unidade,
            "quantidadeNota": str(decimal_nota(quantidade)),
            "valorUnitarioNota": str(decimal_nota(unitario)),
            "valorTotalItemNota": str(decimal_nota(total)),
        })
        soma += decimal_nota(total)

    total_produtos = campo(
        rf"VALOR TOTAL DOS PRODUTOS[ \t]*\n[ \t]*(?:{dinheiro}[ \t]+){{4}}({dinheiro})",
        texto,
    )
    if not itens or soma != decimal_nota(total_produtos):
        raise FormatoNaoReconhecido()

    destinatario = re.search(
        r"^[ \t]*DESTINATÁRIO[ \t]*/[ \t]*REMETENTE[ \t]*\n"
        r"[^\n]*CNPJ[ \t]*/[ \t]*CPF[^\n]*\n([^\n]+)",
        texto,
        re.MULTILINE,
    )
    documento = re.search(
        r"\b(\d{2}\.\d{3}\.\d{3}/\d{4}-\d{2}|\d{14})\b",
        destinatario[1] if destinatario else "",
    )
    destinatario_cnpj = re.sub(r"\D", "", documento[1]) if documento else None

    data = campo(r"DATA DE EMISSÃO:[ \t]*(\d{2}/\d{2}/\d{4})", texto)
    try:
        emissao = datetime.strptime(data, "%d/%m/%Y").date().isoformat()
    except ValueError as erro:
        raise FormatoNaoReconhecido() from erro

    return {
        "fornecedorNome": campo(r"RECEBEMOS DE[ \t]+(.+?)[ \t]+OS PRODUTOS", texto),
        "fornecedorCnpj": campo(r"(\d{2}\.\d{3}\.\d{3}/\d{4}-\d{2})", emitente),
        "numeroNota": campo(r"N[º°][ \t]*\.?(\d+)", texto),
        "serieNota": campo(r"SERIE[ \t]+(\d+)", texto),
        "emitidaEm": emissao,
        "destinatarioCnpj": destinatario_cnpj,
        "totalItens": len(itens),
        "itens": itens,
    }


if __name__ == "__main__":
    import os
    from importlib.util import (
        module_from_spec,
        spec_from_file_location,
    )
    from pathlib import Path

    conteudo = sys.stdin.buffer.read()

    try:
        if not conteudo.startswith(b"%PDF-"):
            raise FormatoNaoReconhecido()
        previa = extrair(conteudo)

    except (FormatoNaoReconhecido, PdfminerException):
        previa = None

        # OCR piloto: ativacao explicita para PDF ou imagem validada pelo Pillow.
        if (
            os.environ.get("NOTAS_COMPRA_OCR_PILOTO") == "1"
            and (
                conteudo.startswith(b"%PDF-")
                or conteudo.startswith(b"\x89PNG\r\n\x1a\n")
                or conteudo.startswith(b"\xff\xd8\xff")
                or (
                    conteudo.startswith(b"RIFF")
                    and conteudo[8:12] == b"WEBP"
                )
            )
        ):
            try:
                caminho = Path(__file__).with_name(
                    "extrair-nota-compra-ocr.py"
                )

                spec = spec_from_file_location(
                    "extrator_ocr_piloto",
                    caminho,
                )

                if spec is None or spec.loader is None:
                    raise RuntimeError(
                        "Extrator OCR indisponivel."
                    )

                modulo = module_from_spec(spec)
                spec.loader.exec_module(modulo)

                previa = modulo.extrair(conteudo)

                # O piloto jamais pode autorizar entrada
                # automatica de estoque.
                if (
                    not isinstance(previa, dict)
                    or previa.get(
                        "aptoParaConfirmacaoAutomatica"
                    ) is not False
                ):
                    raise ValueError(
                        "Previa OCR sem bloqueio de seguranca."
                    )

            except Exception as erro:
                print(
                    "OCR piloto nao concluiu: "
                    + type(erro).__name__,
                    file=sys.stderr,
                )
                previa = None

    print(json.dumps(previa, ensure_ascii=True))
