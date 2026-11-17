import {
  BadRequestException, ConflictException, ForbiddenException,
  HttpException, InternalServerErrorException, NotFoundException,
} from '@nestjs/common';
import { Prisma, ResultadoAuditoria, TipoAtorAuditoria } from '@prisma/client';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { lstat, open, realpath } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join } from 'node:path';
import type { AuditoriaService } from '../auditoria/auditoria.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';

export function versaoPrevia(extracao: Prisma.JsonValue | null) {
  return createHash('sha256').update(JSON.stringify(extracao) ?? 'null').digest('hex');
}

function objeto(valor: unknown): valor is Prisma.JsonObject {
  return !!valor && typeof valor === 'object' && !Array.isArray(valor);
}

function cnpjValido(valor: unknown): valor is string {
  if (typeof valor !== 'string' || !/^\d{14}$/.test(valor) || /^(\d)\1+$/.test(valor)) return false;
  for (const tamanho of [12, 13]) {
    let peso = tamanho === 12 ? 5 : 6;
    let soma = 0;
    for (const digito of valor.slice(0, tamanho)) {
      soma += Number(digito) * peso;
      peso = peso === 2 ? 9 : peso - 1;
    }
    const resto = soma % 11;
    if (Number(valor[tamanho]) !== (resto < 2 ? 0 : 11 - resto)) return false;
  }
  return true;
}

function exigirPreviaVazia(status: string, extracao: Prisma.JsonValue | null) {
  if (status !== 'AGUARDANDO_CONFERENCIA') {
    throw new ConflictException('Somente uma nota ainda aguardando conferencia pode ser reprocessada.');
  }
  if (extracao !== null && !objeto(extracao)) {
    throw new ConflictException('Previa invalida; nenhuma alteracao foi feita.');
  }
  if (objeto(extracao) && (extracao.revisaoFiscal || extracao.extracaoOriginalOcr ||
      (extracao.itens !== undefined && (!Array.isArray(extracao.itens) || extracao.itens.length > 0)))) {
    throw new ConflictException('Esta operacao atende apenas previas vazias, sem revisao fiscal.');
  }
}

async function executarExtrator(python: string, conteudo: Buffer) {
  return new Promise<Prisma.JsonObject>((resolve, reject) => {
    const processo = execFile(python,
      ['-X', 'utf8', join(process.cwd(), 'scripts', 'extrair-nota-compra.py')],
      { encoding: 'utf8', timeout: 180000, maxBuffer: 512 * 1024, windowsHide: true },
      (erro, stdout) => {
        if (erro) {
          reject(new BadRequestException('Nao foi possivel reler o documento. A previa anterior foi preservada.'));
          return;
        }
        try {
          const valor: unknown = JSON.parse(stdout);
          if (!objeto(valor) || valor.modoExtracao !== 'OCR_PILOTO' ||
              valor.aptoParaConfirmacaoAutomatica !== false || !Array.isArray(valor.itens) ||
              valor.itens.length < 1 || valor.itens.length > 100 ||
              !cnpjValido(valor.fornecedorCnpj) || !cnpjValido(valor.destinatarioCnpj) ||
              typeof valor.numeroNota !== 'string' || !/^\d{1,9}$/.test(valor.numeroNota) ||
              !/[1-9]/.test(valor.numeroNota) || typeof valor.serieNota !== 'string' ||
              !/^\d{1,3}$/.test(valor.serieNota) || valor.revisaoFiscal || valor.extracaoOriginalOcr ||
              valor.reprocessamentoOcr) {
            throw new Error('Previa incompleta.');
          }
          for (const item of valor.itens) {
            if (!objeto(item) || typeof item.codigoFornecedor !== 'string' ||
                typeof item.descricaoNota !== 'string' || !item.descricaoNota.trim() ||
                typeof item.quantidadeNota !== 'string' ||
                !/^\d{1,11}(?:\.\d{1,3})?$/.test(item.quantidadeNota) ||
                !new Prisma.Decimal(item.quantidadeNota).gt(0) ||
                typeof item.unidadeNota !== 'string' || !/^[A-Z0-9]{1,6}$/.test(item.unidadeNota) ||
                typeof item.valorUnitarioNota !== 'string' ||
                !/^\d{1,12}\.\d{1,6}$/.test(item.valorUnitarioNota) ||
                typeof item.valorTotalItemNota !== 'string' ||
                !/^\d{1,18}\.\d{2}$/.test(item.valorTotalItemNota)) {
              throw new Error('Itens incompletos.');
            }
          }
          resolve(valor);
        } catch {
          reject(new BadRequestException('A releitura nao produziu uma previa OCR completa. Nada foi substituido.'));
        }
      });
    processo.stdin?.on('error', () => undefined);
    processo.stdin?.end(conteudo);
  });
}

/** Releitura explicita de previa vazia; sem simulacao, vinculos ou estoque. */
export async function reprocessarNotaVazia(
  prisma: PrismaService, auditoria: AuditoriaService,
  empresaId: string, usuarioId: string, arquivoId: string,
  dto: { justificativa: string; versaoExtracao: string },
) {
  if (typeof dto.justificativa !== 'string' || dto.justificativa.trim().length < 10 ||
      dto.justificativa.trim().length > 500 || !/^[a-f0-9]{64}$/.test(dto.versaoExtracao)) {
    throw new BadRequestException('Informe justificativa e versao da previa.');
  }
  const pasta = process.env.NOTAS_COMPRA_PASTA?.trim();
  const python = process.env.NOTAS_COMPRA_PYTHON?.trim();
  if (!pasta || !isAbsolute(pasta) || !python || process.env.NOTAS_COMPRA_OCR_PILOTO !== '1' ||
      process.env.NOTAS_COMPRA_EMPRESA_ID?.trim() !== empresaId) {
    throw new BadRequestException('Monitor OCR nao configurado para esta empresa.');
  }
  const usuario = await prisma.usuario.findFirst({
    where: { id: usuarioId, empresaId, ativo: true, perfil: { in: ['ADMINISTRADOR', 'GERENTE'] } },
    select: { id: true },
  });
  if (!usuario) throw new ForbiddenException('Usuario sem permissao para reprocessar notas.');
  const arquivo = await prisma.arquivoNotaCompra.findFirst({ where: { id: arquivoId, empresaId } });
  if (!arquivo) throw new NotFoundException('Arquivo nao encontrado nesta empresa.');
  exigirPreviaVazia(arquivo.status, arquivo.extracao);
  if (versaoPrevia(arquivo.extracao) !== dto.versaoExtracao) {
    throw new ConflictException('A previa mudou. Atualize as notas antes de reprocessar.');
  }
  const nome = arquivo.nomeOriginal;
  if (!nome || basename(nome) !== nome || /[\\/]/.test(nome) || !/\.pdf$/i.test(nome)) {
    throw new BadRequestException('Reprocessamento limitado ao PDF original da pasta configurada.');
  }
  let conteudo: Buffer;
  try {
    const raiz = await realpath(pasta);
    const caminho = join(raiz, nome);
    const info = await lstat(caminho);
    if (!info.isFile() || info.isSymbolicLink() || info.size < 1 || info.size > 20 * 1024 * 1024 ||
        dirname(await realpath(caminho)) !== raiz) throw new Error('Arquivo invalido.');
    const handle = await open(caminho, 'r');
    try {
      const blocos: Buffer[] = [];
      let tamanho = 0;
      for await (const bloco of handle.createReadStream({ autoClose: false, start: 0, end: 20 * 1024 * 1024 })) {
        tamanho += bloco.length;
        if (tamanho > 20 * 1024 * 1024) throw new Error('Arquivo excedeu limite.');
        blocos.push(bloco);
      }
      conteudo = Buffer.concat(blocos, tamanho);
    } finally {
      await handle.close();
    }
    if (!conteudo.subarray(0, 5).equals(Buffer.from('%PDF-')) ||
        conteudo.length !== arquivo.tamanhoBytes ||
        createHash('sha256').update(conteudo).digest('hex') !== arquivo.sha256) {
      throw new Error('Conteudo diferente do original.');
    }
  } catch {
    throw new BadRequestException('PDF original ausente, alterado ou inacessivel. Nenhum registro foi modificado.');
  }
  const previa = await executarExtrator(python, conteudo);
  try {
    return await prisma.$transaction(async tx => {
      const autorizado = await tx.usuario.findFirst({
        where: { id: usuarioId, empresaId, ativo: true, perfil: { in: ['ADMINISTRADOR', 'GERENTE'] } },
        select: { id: true },
      });
      if (!autorizado) throw new ForbiddenException('Permissao alterada durante a releitura.');
      const empresa = await tx.empresa.findUnique({ where: { id: empresaId }, select: { ativo: true, cnpj: true } });
      if (!empresa?.ativo || empresa.cnpj?.replace(/\D/g, '') !== previa.destinatarioCnpj) {
        throw new BadRequestException('CNPJ destinatario nao corresponde a empresa ativa.');
      }
      const incluido = await tx.recebimentoCompra.findFirst({
        where: { empresaId, fornecedorCnpj: previa.fornecedorCnpj as string,
          numeroNota: (previa.numeroNota as string).padStart(9, '0'),
          serieNota: (previa.serieNota as string).padStart(3, '0') },
        select: { id: true },
      });
      if (incluido) throw new ConflictException('Esta nota ja possui um recebimento. Reprocessamento recusado.');
      const nova = { ...previa, aptoParaConfirmacaoAutomatica: false,
        reprocessamentoOcr: { versao: 1, reprocessadoEm: new Date().toISOString(),
          reprocessadoPorId: usuarioId, justificativa: dto.justificativa.trim(),
          extracaoAnterior: arquivo.extracao, versaoAnterior: dto.versaoExtracao },
      } as Prisma.InputJsonObject;
      const { count } = await tx.arquivoNotaCompra.updateMany({
        where: { id: arquivoId, empresaId, sha256: arquivo.sha256, status: 'AGUARDANDO_CONFERENCIA',
          extracao: arquivo.extracao === null ? { equals: Prisma.AnyNull } : { equals: arquivo.extracao } },
        data: { extracao: nova },
      });
      if (count !== 1) throw new ConflictException('Nota alterada ou recebida durante a releitura. Atualize as notas.');
      await auditoria.registrar({ empresaId, atorId: usuarioId,
        tipoAtor: TipoAtorAuditoria.USUARIO_EMPRESA, modulo: 'COMPRAS',
        acao: 'REPROCESSAR_NOTA_OCR', entidade: 'ARQUIVO_NOTA_COMPRA', entidadeId: arquivoId,
        resultado: ResultadoAuditoria.SUCESSO, justificativa: dto.justificativa.trim(),
        dadosAnteriores: { quantidadeItens: 0, versaoExtracao: dto.versaoExtracao },
        dadosPosteriores: { quantidadeItens: (previa.itens as Prisma.JsonArray).length,
          versaoExtracao: versaoPrevia(nova as Prisma.JsonObject) },
        metadados: { leituraAnteriorPreservada: true, movimentouEstoque: false },
      }, tx);
      return { arquivoId, status: 'AGUARDANDO_CONFERENCIA',
        quantidadeItens: (previa.itens as Prisma.JsonArray).length };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30000 });
  } catch (erro) {
    if (erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === 'P2034') {
      throw new ConflictException('A nota mudou durante o reprocessamento. Atualize a lista.');
    }
    if (erro instanceof HttpException) throw erro;
    throw new InternalServerErrorException('Nao foi possivel salvar a releitura. Consulte a lista antes de tentar novamente.');
  }
}
