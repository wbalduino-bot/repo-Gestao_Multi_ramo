import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { AuditoriaService } from '../auditoria/auditoria.service.js';
import { reprocessarNotaVazia, versaoPrevia } from './reprocessar-nota-vazia.js';

vi.mock('node:child_process', () => ({ execFile: vi.fn() }));

describe('Reprocessamento explicito de previa vazia', () => {
  const empresaId = '11111111-1111-4111-8111-111111111111';
  const usuarioId = '22222222-2222-4222-8222-222222222222';
  const arquivoId = '33333333-3333-4333-8333-333333333333';
  const conteudo = Buffer.from('%PDF-documento-de-teste');
  const anterior = { modoExtracao: 'OCR_PILOTO', itens: [], fornecedorNome: 'Leitura antiga' };
  const nova = {
    modoExtracao: 'OCR_PILOTO', fornecedorCnpj: '69158285000351', destinatarioCnpj: '66804456000112',
    numeroNota: '000386331', serieNota: '1', aptoParaConfirmacaoAutomatica: false,
    emitidaEm: null, valorTotalProdutos: null,
    itens: [{ codigoFornecedor: 'TESTE', descricaoNota: 'Produto de teste', quantidadeNota: '2',
      unidadeNota: 'CX', valorUnitarioNota: '10.0000', valorTotalItemNota: '20.00', valoresConferem: true }],
  };
  let pasta: string;
  let registro: { id: string; empresaId: string; status: string; extracao: unknown; nomeOriginal: string; sha256: string; tamanhoBytes: number };
  let duranteOcr: () => void;
  let saida: unknown;
  const tx = {
    usuario: { findFirst: vi.fn() }, empresa: { findUnique: vi.fn() },
    recebimentoCompra: { findFirst: vi.fn() }, arquivoNotaCompra: { updateMany: vi.fn() },
  };
  const db = {
    usuario: { findFirst: vi.fn() }, arquivoNotaCompra: { findFirst: vi.fn() },
    $transaction: vi.fn(),
  };
  const auditoria = { registrar: vi.fn() };
  function chamar(versao = versaoPrevia(anterior)) {
    return reprocessarNotaVazia(db as unknown as PrismaService, auditoria as unknown as AuditoriaService,
      empresaId, usuarioId, arquivoId, { justificativa: 'Atualizacao do extrator OCR.', versaoExtracao: versao });
  }
  beforeEach(async () => {
    vi.resetAllMocks();
    pasta = await mkdtemp(join(tmpdir(), 'gc-reprocessamento-'));
    await writeFile(join(pasta, 'nota.pdf'), conteudo);
    vi.stubEnv('NOTAS_COMPRA_PASTA', pasta);
    vi.stubEnv('NOTAS_COMPRA_EMPRESA_ID', empresaId);
    vi.stubEnv('NOTAS_COMPRA_PYTHON', 'python');
    vi.stubEnv('NOTAS_COMPRA_OCR_PILOTO', '1');
    registro = { id: arquivoId, empresaId, status: 'AGUARDANDO_CONFERENCIA', extracao: structuredClone(anterior),
      nomeOriginal: 'nota.pdf', tamanhoBytes: conteudo.length,
      sha256: createHash('sha256').update(conteudo).digest('hex') };
    saida = structuredClone(nova);
    duranteOcr = () => undefined;
    db.usuario.findFirst.mockResolvedValue({ id: usuarioId });
    db.arquivoNotaCompra.findFirst.mockImplementation(async () => structuredClone(registro));
    tx.usuario.findFirst.mockResolvedValue({ id: usuarioId });
    tx.empresa.findUnique.mockResolvedValue({ ativo: true, cnpj: '66804456000112' });
    tx.recebimentoCompra.findFirst.mockResolvedValue(null);
    tx.arquivoNotaCompra.updateMany.mockResolvedValue({ count: 1 });
    db.$transaction.mockImplementation(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx));
    auditoria.registrar.mockResolvedValue({ id: 'auditoria' });
    vi.mocked(execFile).mockImplementation((...args: unknown[]) => {
      const callback = args[args.length - 1] as (erro: Error | null, stdout: string) => void;
      return { stdin: { on: () => undefined, end: () => {
        duranteOcr();
        queueMicrotask(() => callback(null, JSON.stringify(saida)));
      } } } as unknown as ReturnType<typeof execFile>;
    });
  });
  afterEach(async () => { vi.unstubAllEnvs(); await rm(pasta, { recursive: true, force: true }); });

  it('preserva leitura anterior, exige versao e audita na mesma transacao sem estoque', async () => {
    await expect(chamar()).resolves.toMatchObject({ arquivoId, quantidadeItens: 1 });
    expect(tx.arquivoNotaCompra.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: arquivoId, empresaId, status: 'AGUARDANDO_CONFERENCIA', extracao: { equals: anterior } }),
      data: { extracao: expect.objectContaining({ aptoParaConfirmacaoAutomatica: false,
        reprocessamentoOcr: expect.objectContaining({ extracaoAnterior: anterior }) }) },
    }));
    expect(auditoria.registrar).toHaveBeenCalledWith(expect.objectContaining({
      acao: 'REPROCESSAR_NOTA_OCR', metadados: { leituraAnteriorPreservada: true, movimentouEstoque: false },
    }), tx);
    expect(tx.recebimentoCompra.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ empresaId, numeroNota: '000386331', serieNota: '001' }),
    }));
  });
  it('recusa nota processada antes de executar OCR', async () => {
    registro.status = 'PROCESSADO';
    await expect(chamar()).rejects.toBeInstanceOf(ConflictException);
    expect(execFile).not.toHaveBeenCalled();
  });
  it('recusa previa com itens sem apagar a conferencia', async () => {
    registro.extracao = nova;
    await expect(chamar()).rejects.toBeInstanceOf(ConflictException);
    expect(execFile).not.toHaveBeenCalled();
  });
  it('recusa revisao existente mesmo com zero itens', async () => {
    registro.extracao = { ...anterior, revisaoFiscal: { status: 'VALIDADA' } };
    await expect(chamar()).rejects.toBeInstanceOf(ConflictException);
  });
  it('recusa versao desatualizada', async () => {
    await expect(chamar('0'.repeat(64))).rejects.toBeInstanceOf(ConflictException);
    expect(execFile).not.toHaveBeenCalled();
  });
  it('isola consulta por empresa', async () => {
    db.arquivoNotaCompra.findFirst.mockResolvedValue(null);
    await expect(chamar()).rejects.toBeInstanceOf(NotFoundException);
    expect(db.arquivoNotaCompra.findFirst).toHaveBeenCalledWith({ where: { id: arquivoId, empresaId } });
  });
  it('recusa usuario operacional ou inativo', async () => {
    db.usuario.findFirst.mockResolvedValue(null);
    await expect(chamar()).rejects.toBeInstanceOf(ForbiddenException);
    expect(execFile).not.toHaveBeenCalled();
  });
  it('recusa PDF alterado sem burlar o hash', async () => {
    await writeFile(join(pasta, 'nota.pdf'), '%PDF-outros-bytes');
    await expect(chamar()).rejects.toBeInstanceOf(BadRequestException);
    expect(execFile).not.toHaveBeenCalled();
  });
  it('recusa nome contendo caminho', async () => {
    registro.nomeOriginal = '../nota.pdf';
    await expect(chamar()).rejects.toBeInstanceOf(BadRequestException);
  });
  it('nao troca a previa quando OCR ainda nao reconhece itens', async () => {
    saida = { ...nova, itens: [] };
    await expect(chamar()).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.arquivoNotaCompra.updateMany).not.toHaveBeenCalled();
  });
  it('recusa destinatario diferente da empresa', async () => {
    tx.empresa.findUnique.mockResolvedValue({ ativo: true, cnpj: '00000000000000' });
    await expect(chamar()).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.arquivoNotaCompra.updateMany).not.toHaveBeenCalled();
  });
  it('recusa identidade ja recebida', async () => {
    tx.recebimentoCompra.findFirst.mockResolvedValue({ id: 'recebido' });
    await expect(chamar()).rejects.toBeInstanceOf(ConflictException);
    expect(tx.arquivoNotaCompra.updateMany).not.toHaveBeenCalled();
  });
  it('recusa perda de permissao durante OCR', async () => {
    duranteOcr = () => { tx.usuario.findFirst.mockResolvedValue(null); };
    await expect(chamar()).rejects.toBeInstanceOf(ForbiddenException);
    expect(tx.arquivoNotaCompra.updateMany).not.toHaveBeenCalled();
  });
  it('nao sobrescreve alteracao concorrente', async () => {
    tx.arquivoNotaCompra.updateMany.mockResolvedValue({ count: 0 });
    await expect(chamar()).rejects.toBeInstanceOf(ConflictException);
    expect(auditoria.registrar).not.toHaveBeenCalled();
  });
  it('propaga falha de auditoria para abortar a transacao', async () => {
    auditoria.registrar.mockRejectedValue(new Error('Falha de auditoria'));
    await expect(chamar()).rejects.toThrow('Nao foi possivel salvar');
    expect(db.$transaction).toHaveBeenCalledWith(expect.any(Function), expect.objectContaining({ isolationLevel: 'Serializable' }));
  });
});
