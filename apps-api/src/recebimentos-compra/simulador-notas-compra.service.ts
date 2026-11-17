import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { ConfirmarNotaAgenteDto } from './confirmar-nota-agente.dto.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { calcularQuantidadeNota, codigosUnidadeEstoqueDaNota } from './calcular-quantidade-nota.js';

function objeto(valor: unknown): Record<string, unknown> | null {
  return valor !== null && typeof valor === 'object' && !Array.isArray(valor)
    ? valor as Record<string, unknown>
    : null;
}

function nomeComparavel(nome: string): string {
  return nome.normalize('NFD').replace(/\p{M}/gu, '').toUpperCase()
    .replace(/\bC\s*\/\s*\d+\b/g, ' ')
    .replace(/\b(?:CERVEJA|LATA|CX|PC|PCT|UN)\b/g, ' ')
    .replace(/[^A-Z0-9]/g, '');
}

function fatorDaDescricao(descricao: string): number | undefined {
  const valores = new Set(Array.from(
    descricao.matchAll(/\bC\s*\/\s*([1-9]\d*)(?![\d.,])/gi),
    (ocorrencia) => Number(ocorrencia[1]),
  ));
  const fator = valores.values().next().value;
  return valores.size === 1 && Number.isSafeInteger(fator) ? fator : undefined;
}

@Injectable()
export class SimuladorNotasCompraService {
  private readonly logger = new Logger(SimuladorNotasCompraService.name);

  constructor(private readonly prisma: PrismaService) {}

  async simular(empresaId: string, sha256: string) {
    const arquivo = await this.prisma.arquivoNotaCompra.findFirst({
      where: { empresaId, sha256, status: 'AGUARDANDO_CONFERENCIA' },
      select: { id: true, extracao: true },
    });
    const nota = objeto(arquivo?.extracao);
    if (!arquivo || !nota || !Array.isArray(nota.itens) ||
        nota.itens.length < 1 || nota.itens.length > 100) return;

    const { fornecedorCnpj, numeroNota, serieNota } = nota;
    const cnpj = typeof fornecedorCnpj === 'string'
      ? fornecedorCnpj.toUpperCase().replace(/[./-]/g, '')
      : '';
    if (!/^[A-Z0-9]{12}\d{2}$/.test(cnpj) ||
        typeof numeroNota !== 'string' || !/^\d{1,9}$/.test(numeroNota) || Number(numeroNota) === 0 ||
        typeof serieNota !== 'string' || !/^\d{1,3}$/.test(serieNota)) {
      this.logger.warn('Simulação interrompida: identidade da nota incompleta.');
      return;
    }

    const recebimento = await this.prisma.recebimentoCompra.findFirst({
      where: {
        empresaId, fornecedorCnpj: cnpj,
        numeroNota: numeroNota.padStart(9, '0'),
        serieNota: serieNota.padStart(3, '0'),
      },
      select: { id: true },
    });
    if (recebimento) {
      this.logger.log('Simulação ignorada: a identidade fiscal já consta em um recebimento.');
      return;
    }

    const [produtos, unidades, vinculos] = await Promise.all([
      this.prisma.produto.findMany({
        where: { empresaId },
        select: { id: true, sku: true, nome: true, unidadeId: true, ativo: true, perecivel: true },
      }),
      this.prisma.unidade.findMany({
        where: { empresaId },
        select: { id: true, codigo: true },
      }),
      this.prisma.vinculoProdutoFornecedorCompra.findMany({
        where: { empresaId, fornecedorCnpj: cnpj, codigoFornecedor: {
          in: nota.itens.flatMap((valor) => {
            const codigo = objeto(valor)?.codigoFornecedor;
            return typeof codigo === 'string' ? [codigo.toUpperCase()] : [];
          }),
        } },
        select: { codigoFornecedor: true, produtoId: true },
      }),
    ]);
    const porId = new Map(produtos.map((produto) => [produto.id, produto]));
    const vinculoPorCodigo = new Map(vinculos.map((vinculo) => [vinculo.codigoFornecedor, vinculo.produtoId]));
    const unidadePorId = new Map(unidades.map(({ id, codigo }) => [id, codigo]));
    const nomes = new Set(produtos.map(({ nome }) => nomeComparavel(nome)));
    const contagemCodigos = new Map<string, number>();
    for (const valor of nota.itens) {
      const codigo = objeto(valor)?.codigoFornecedor;
      if (typeof codigo === 'string') {
        const chave = codigo.toUpperCase();
        contagemCodigos.set(chave, (contagemCodigos.get(chave) ?? 0) + 1);
      }
    }

    let vinculosEncontrados = 0;
    let cadastrosSugeridos = 0;
    const pendencias: string[] = [];
    const itens: ConfirmarNotaAgenteDto['itens'] = [];
    const skusCadastrados = new Set(produtos.map(({ sku }) => sku));
    const conversoes: string[] = [];

    for (const [indice, valor] of nota.itens.entries()) {
      const linha = objeto(valor);
      const numeroLinha = indice + 1;
      if (!linha || typeof linha.codigoFornecedor !== 'string' ||
          !/^[A-Z0-9]{1,64}$/i.test(linha.codigoFornecedor) ||
          typeof linha.descricaoNota !== 'string' || !linha.descricaoNota.trim() ||
          linha.descricaoNota.trim().length > 250 ||
          typeof linha.unidadeNota !== 'string' || typeof linha.quantidadeNota !== 'string') {
        pendencias.push(numeroLinha + ': dados da linha incompletos');
        continue;
      }
      const codigo = linha.codigoFornecedor.toUpperCase();
      if ((contagemCodigos.get(codigo) ?? 0) > 1) {
        pendencias.push(numeroLinha + ': código repetido na nota');
        continue;
      }

      const skuNovo = 'AGC-' + cnpj + '-' + codigo;
      const produtoId = vinculoPorCodigo.get(codigo);
      const produto = produtoId ? porId.get(produtoId) : undefined;
      const origem = linha.unidadeNota.trim().toUpperCase();
      const fator = origem === 'PC' || origem === 'CX'
        ? fatorDaDescricao(linha.descricaoNota)
        : undefined;
      const unidade = produto
        ? unidadePorId.get(produto.unidadeId ?? '')
        : codigosUnidadeEstoqueDaNota(origem)[0];
      const quantidade = unidade
        ? calcularQuantidadeNota(linha.quantidadeNota, origem, unidade, fator)
        : null;

      if (quantidade === null) {
        pendencias.push(numeroLinha + ': unidade ou fator de embalagem sem confirmação');
      } else if (produto) {
        if (!produto.ativo || produto.perecivel) {
          pendencias.push(numeroLinha + ': produto inativo ou validade a conferir');
        } else {
          vinculosEncontrados++;
          itens.push({ indiceNota: indice, produtoId: produto.id,
            quantidadeRecebida: quantidade, fatorEmbalagem: fator });
          conversoes.push(numeroLinha + ': ' + quantidade + ' ' + unidade);
        }
      } else if (skusCadastrados.has(skuNovo) || nomes.has(nomeComparavel(linha.descricaoNota))) {
        pendencias.push(numeroLinha + ': possível produto existente no catálogo');
      } else if (typeof linha.valorTotalItemNota !== 'string' ||
          !/^\d{1,18}\.\d{2}$/.test(linha.valorTotalItemNota) ||
          Number(linha.valorTotalItemNota) <= 0) {
        pendencias.push(numeroLinha + ': valor total da linha indisponível');
      } else {
        cadastrosSugeridos++;
        nomes.add(nomeComparavel(linha.descricaoNota));
        itens.push({ indiceNota: indice, quantidadeRecebida: quantidade, fatorEmbalagem: fator,
          usarPrecoDaNota: true, produtoNovo: {
            nome: linha.descricaoNota.trim().slice(0, 150), sku: skuNovo,
          } });
        conversoes.push(numeroLinha + ': ' + quantidade + ' ' + unidade);
      }
    }

    this.logger.log(
      'Simulação Agente GC: ' + nota.itens.length + ' linhas, ' +
      vinculosEncontrados + ' com vínculo reconhecido, ' +
      cadastrosSugeridos + ' cadastros sugeridos, ' + pendencias.length + ' pendências.',
    );
    if (conversoes.length) this.logger.log('Quantidades sugeridas por linha: ' + conversoes.join(' | '));
    if (pendencias.length) {
      this.logger.log('Pendências da simulação por linha: ' + pendencias.join(' | '));
      return;
    }
    return { arquivoId: arquivo.id, extracao: nota as Prisma.JsonObject, itens };
  }
}
