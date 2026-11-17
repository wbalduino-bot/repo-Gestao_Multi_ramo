"""Segundo leiaute OCR assistido. Nao acessa banco nem autoriza automacao."""
import io
import os
import re
import subprocess
import time
import unicodedata
from collections import Counter
from datetime import datetime
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path

from PIL import Image, ImageOps


def normalizar(texto):
    return ''.join(c for c in unicodedata.normalize('NFD', texto.upper())
                   if unicodedata.category(c) != 'Mn')


def pos(linha):
    return int(linha.get('x', -1)), int(linha.get('y', -1))


def reconhece(linhas):
    # Geometria e rotulos do documento; nao depende de razao social/fantasia.
    tabela = any('DADOS DO PRODUTO' in normalizar(l.get('texto', ''))
                 and 2000 <= pos(l)[1] <= 2200 for l in linhas)
    destinatario = any('DESTINAT' in normalizar(l.get('texto', ''))
                       and 950 <= pos(l)[1] <= 1040 for l in linhas)
    codigos = [l for l in linhas if 230 <= pos(l)[0] <= 330
               and 2230 <= pos(l)[1] <= 3100
               and re.fullmatch(r'\d{4,12}', l.get('texto', '').strip())]
    return tabela and destinatario and len(codigos) >= 2


def dinheiro(texto):
    texto = re.sub(r'\s+', '', texto)
    if re.fullmatch(r'\d{1,3}(?:\.\d{3})+,\d{2,6}', texto):
        texto = texto.replace('.', '').replace(',', '.')
    elif re.fullmatch(r'\d+[.,]\d{2,6}', texto):
        texto = texto.replace(',', '.')
    else:
        return None
    return Decimal(texto)


class Leitor:
    def __init__(self, imagem):
        self.imagem = imagem
        self.inicio = time.monotonic()
        windows = Path(r'C:\Program Files\Tesseract-OCR\tesseract.exe')
        self.exe = str(windows) if os.name == 'nt' and windows.is_file() else 'tesseract'
        r = subprocess.run([self.exe, '--list-langs'], capture_output=True,
                           timeout=8, check=True)
        idiomas = r.stdout.decode('utf-8', errors='replace').splitlines()
        self.idioma = 'por+eng' if 'por' in idiomas and 'eng' in idiomas else 'eng'

    def ler(self, limites, psm=7, caracteres=None, limiar=None):
        restante = 110 - (time.monotonic() - self.inicio)
        if restante <= 0:
            raise TimeoutError('Limite de tempo do segundo leiaute atingido.')
        c = ImageOps.autocontrast(ImageOps.grayscale(self.imagem.crop(limites)))
        if limiar is not None:
            # Recorte pequeno, sem bordas da tabela. Apenas binarizacao;
            # nao converte letras/barras em algarismos.
            c = c.point(lambda p: 0 if p < limiar else 255)
            caixa = ImageOps.invert(c).getbbox()
            if caixa is None:
                return ''
            c = c.crop(caixa)
        c = c.resize((c.width * 4, c.height * 4), Image.Resampling.LANCZOS)
        c = ImageOps.expand(c, 40, 255)
        buffer = io.BytesIO()
        c.save(buffer, format='PNG')
        # Campos numericos usam o mesmo modelo eng no Windows e no teste local.
        # por+eng pode selecionar formas diferentes para digitos isolados.
        idioma = 'eng' if caracteres else self.idioma
        args = [self.exe, 'stdin', 'stdout', '-l', idioma, '--psm', str(psm)]
        if caracteres:
            args += ['-c', 'tessedit_char_whitelist=' + caracteres]
        r = subprocess.run(args, input=buffer.getvalue(), capture_output=True,
                           timeout=min(8, restante), check=True)
        return r.stdout.decode('utf-8-sig', errors='replace').strip()

    def inteiro(self, limites):
        leituras = [self.ler(limites, 8, '0123456789', limiar=t)
                    for t in (130, 160, 200)]
        valores = [s for s in leituras if re.fullmatch(r'[1-9]\d{0,5}', s)]
        frequencias = Counter(valores)
        if len(frequencias) == 1 and next(iter(frequencias.values())) >= 2:
            return next(iter(frequencias))
        return None


def extrair(caminho, linhas, parser):
    if not reconhece(linhas):
        raise ValueError('Leiaute de tabela CX nao reconhecido.')
    imagem = parser.carregar_imagem(caminho)
    leitor = Leitor(imagem)
    avisos = ['OCR assistido: revisar todos os campos no documento original.',
              'Conferir unidade CX e fator de embalagem por produto; nao multiplicar automaticamente.',
              'Descricoes OCR exigem revisao.']

    # CNPJ por funcao documental. Nunca procurar o primeiro CNPJ da pagina.
    cnpjs_emitente = set()
    leituras_emitente = []
    for psm, limiar in ((7, None), (7, 150), (8, 130), (8, 160), (8, 200)):
        texto = leitor.ler((2000, 925, 2500, 980), psm, '0123456789./-', limiar)
        leituras_emitente.append(texto)
        cnpjs_emitente.update(parser.extrair_cnpj(texto))
        # Esta regiao contem apenas o CNPJ do emitente, sem outro campo.
        # OCR pode omitir pontos ou inserir espacos. Normalizar separadores
        # nao corrige/adiciona digitos: exigir 14 e ambos verificadores.
        digitos = re.sub(r'\D', '', texto)
        if len(digitos) == 14 and parser.cnpj_valido(digitos):
            cnpjs_emitente.add(digitos)
    fornecedor = next(iter(cnpjs_emitente)) if len(cnpjs_emitente) == 1 else None
    destinatarios = set()
    for l in linhas:
        x, y = pos(l)
        if 2200 <= x <= 2650 and 1040 <= y <= 1125:
            # Tolerar espacos entre grupos, sem substituir digitos.
            bruto = re.sub(r'\D', '', l.get('texto', ''))
            if len(bruto) == 14 and parser.cnpj_valido(bruto):
                destinatarios.add(bruto)
    destinatario = next(iter(destinatarios)) if len(destinatarios) == 1 else None
    if not fornecedor:
        avisos.append('CNPJ do emitente nao identificado com seguranca.')
    if not destinatario or destinatario == fornecedor:
        destinatario = None
        avisos.append('CNPJ destinatario exige conferencia.')

    nome = ' '.join(l.get('texto', '').strip() for l in sorted(linhas, key=lambda l: pos(l)[1])
                    if 900 <= pos(l)[0] <= 1100 and 350 <= pos(l)[1] <= 450) or None
    numeros = set()
    for l in linhas:
        x, y = pos(l)
        if 1490 <= x <= 1580 and 570 <= y <= 660:
            numeros.update(re.findall(r'\b\d{5,9}\b', l.get('texto', '')))
    numero = next(iter(numeros)) if len(numeros) == 1 else None
    serie = leitor.inteiro((1640, 680, 1715, 742))
    if not numero or not serie:
        avisos.append('Numero ou serie exige conferencia; nao inferir de letras/barras.')

    # Data e total: aceitar apenas leitura documental concordante; nunca usar
    # data do arquivo, soma dos itens ou total geral como substitutos.
    datas = []
    for psm in (7, 8):
        texto = leitor.ler((2680, 1060, 2940, 1130), psm, '0123456789/')
        if re.fullmatch(r'\d{2}/\d{2}/\d{4}', texto):
            try:
                datas.append(datetime.strptime(texto, '%d/%m/%Y').date().isoformat())
            except ValueError:
                pass
    emissao = datas[0] if len(datas) == 2 and len(set(datas)) == 1 else None
    if not emissao:
        avisos.append('Data de emissao exige conferencia no documento.')
    totais = [dinheiro(leitor.ler((2730, 1600, 2950, 1665), p, '0123456789.,'))
              for p in (7, 8)]
    total = totais[0] if all(t is not None for t in totais) and totais[0] == totais[1] else None

    codigos = sorted([l for l in linhas if 230 <= pos(l)[0] <= 330
                      and 2230 <= pos(l)[1] <= 3100
                      and re.fullmatch(r'\d{4,12}', l.get('texto', '').strip())],
                     key=lambda l: pos(l)[1])
    if len({l['texto'].strip() for l in codigos}) != len(codigos):
        raise ValueError('Codigos OCR repetidos; requer conferencia do leiaute.')
    itens = []
    for indice, l in enumerate(codigos):
        codigo, y = l['texto'].strip(), pos(l)[1]
        proximo = pos(codigos[indice + 1])[1] if indice + 1 < len(codigos) else y + 55
        descricao = ' '.join(p.get('texto', '').strip()
                             for p in sorted(linhas, key=lambda p: (pos(p)[1], pos(p)[0]))
                             if 430 <= pos(p)[0] <= 1080 and y - 25 <= pos(p)[1] < proximo - 25)
        def celula(x1, x2):
            candidatos = [p for p in linhas if x1 <= pos(p)[0] <= x2
                          and abs(pos(p)[1] - y) <= 24]
            return candidatos[0]['texto'].strip() if len(candidatos) == 1 else None
        u, t = celula(1770, 1950), celula(2000, 2165)
        unitario, total_item = dinheiro(u) if u else None, dinheiro(t) if t else None
        quantidade = leitor.inteiro((1640, y - 25, 1720, y + 25))
        unidade = celula(1450, 1550)
        unidade = unidade.upper() if unidade and unidade.upper() == 'CX' else None
        if not unidade:
            texto = leitor.ler((1465, y - 25, 1550, y + 25), 7)
            unidade = 'CX' if texto.strip().upper() == 'CX' else None
        completo = all(v is not None for v in (quantidade, unitario, total_item, unidade))
        consistente = bool(completo and (Decimal(quantidade) * unitario).quantize(
            Decimal('.01'), rounding=ROUND_HALF_UP) == total_item)
        if not completo:
            avisos.append('Item ' + codigo + ': campo ilegivel; preencher na revisao, sem inferir valores.')
        elif not consistente:
            avisos.append('Item ' + codigo + ': quantidade, unitario e total divergem.')
        itens.append({'codigoFornecedor': codigo, 'descricaoNota': descricao,
                      'quantidadeNota': quantidade, 'unidadeNota': unidade,
                      'valorUnitarioNota': str(unitario) if unitario is not None else None,
                      'valorTotalItemNota': str(total_item) if total_item is not None else None,
                      'valoresConferem': consistente})
    soma = sum((Decimal(i['valorTotalItemNota']) for i in itens
                if i['valorTotalItemNota'] is not None), Decimal('0'))
    total_candidato = total
    if total is None:
        avisos.append('Total dos produtos nao identificado com seguranca; conferir no documento.')
    elif any(i['valorTotalItemNota'] is None for i in itens) or total != soma:
        avisos.append('Total OCR (' + str(total) + ') diverge da soma dos itens ('
                      + str(soma) + ') ou esta incompleta; total fiscal permanece pendente.')
        total = None
    return {'modoExtracao': 'OCR_PILOTO', 'leiauteOcr': 'DANFE_TABELA_CX_V1',
            'fornecedorNome': nome, 'fornecedorCnpj': fornecedor,
            'cnpjEmitenteLeiturasOcr': leituras_emitente,
            'destinatarioCnpj': destinatario, 'numeroNota': numero, 'serieNota': serie,
            'emitidaEm': emissao, 'totalItens': len(itens),
            'valorTotalProdutos': str(total) if total is not None else None,
            'valorTotalProdutosOcrCandidato': str(total_candidato) if total_candidato is not None else None,
            'somaItensExtraidos': str(soma), 'itens': itens, 'avisos': avisos,
            'aptoParaConfirmacaoAutomatica': False}
