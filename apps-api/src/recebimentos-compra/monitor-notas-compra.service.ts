import {
  HttpException,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import type { Stats } from 'node:fs';
import { lstat, open, readdir } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { PrismaService } from '../prisma/prisma.service.js';
import { RecebimentosCompraService } from './recebimentos-compra.service.js';
import { SimuladorNotasCompraService } from './simulador-notas-compra.service.js';

const INTERVALO_MS = 3000;
const LIMITE_BYTES = 20 * 1024 * 1024;
const EXTENSAO_ACEITA = /\.(pdf|jpe?g|png|webp)$/i;
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

type Observacao = {
  assinatura: string;
  enfileirado: boolean;
};

function assinatura(arquivo: Stats) {
  return [arquivo.dev, arquivo.ino, arquivo.size, arquivo.mtimeMs, arquivo.ctimeMs].join(':');
}

@Injectable()
export class MonitorNotasCompraService
  implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(MonitorNotasCompraService.name);
  private readonly observados = new Map<string, Observacao>();
  private temporizador?: NodeJS.Timeout;
  private varredura?: Promise<void>;
  private encerrado = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly simulador: SimuladorNotasCompraService,
    private readonly recebimentos: RecebimentosCompraService,
  ) {}

  onApplicationBootstrap() {
    if (process.env.NODE_ENV === 'test') return;

    const pasta = process.env.NOTAS_COMPRA_PASTA?.trim();
    const empresaId = process.env.NOTAS_COMPRA_EMPRESA_ID?.trim();

    if (!pasta && !empresaId) return;
    if (!pasta || !isAbsolute(pasta) || !empresaId || !UUID.test(empresaId)) {
      this.logger.warn('Informe uma pasta absoluta e um ID de empresa válido para o monitor de notas.');
      return;
    }

    this.logger.log('Monitor de notas de compra ativado.');
    this.agendar(pasta, empresaId, 0);
  }

  async onModuleDestroy() {
    this.encerrado = true;
    clearTimeout(this.temporizador);
    await this.varredura;
  }

  private agendar(pasta: string, empresaId: string, atraso: number) {
    this.temporizador = setTimeout(() => {
      this.varredura = this.verificarPasta(pasta, empresaId)
        .catch(() => {
          this.logger.warn('Não foi possível consultar a pasta de notas de compra.');
        })
        .finally(() => {
          if (!this.encerrado) this.agendar(pasta, empresaId, INTERVALO_MS);
        });
    }, atraso);
    this.temporizador.unref();
  }

  private async verificarPasta(pasta: string, empresaId: string) {
    const entradas = await readdir(pasta, { withFileTypes: true });
    const presentes = new Set<string>();

    for (const entrada of entradas) {
      if (this.encerrado) return;
      if (!entrada.isFile() || !EXTENSAO_ACEITA.test(entrada.name)) continue;

      presentes.add(entrada.name);

      try {
        await this.verificarArquivo(pasta, empresaId, entrada.name);
      } catch {
        this.logger.warn('Não foi possível preparar um arquivo de compra. Nova tentativa na próxima verificação.');
      }
    }

    for (const nome of this.observados.keys()) {
      if (!presentes.has(nome)) this.observados.delete(nome);
    }
  }

  private async verificarArquivo(pasta: string, empresaId: string, nome: string) {
    const caminho = join(pasta, nome);
    const inicial = await lstat(caminho);

    if (!inicial.isFile() || inicial.size === 0 || inicial.size > LIMITE_BYTES) {
      this.observados.delete(nome);
      return;
    }

    const atual = assinatura(inicial);
    const anterior = this.observados.get(nome);

    if (anterior?.assinatura !== atual) {
      this.observados.set(nome, { assinatura: atual, enfileirado: false });
      return;
    }
    if (anterior.enfileirado) return;

    const arquivo = await open(caminho, 'r');
    try {
      if (assinatura(await arquivo.stat()) !== atual) return;

      const hash = createHash('sha256');
      const python = process.env.NOTAS_COMPRA_PYTHON?.trim();
      const permiteExtracao = /\.pdf$/i.test(nome) ||
        (process.env.NOTAS_COMPRA_OCR_PILOTO === '1' &&
          /\.(jpe?g|png|webp)$/i.test(nome));
      const blocosPdf: Buffer[] | null = python && permiteExtracao ? [] : null;
      let tamanhoLido = 0;
      const leitura = arquivo.createReadStream({
        start: 0,
        end: inicial.size - 1,
        autoClose: false,
      });

      for await (const bloco of leitura) {
        hash.update(bloco);
        blocosPdf?.push(bloco);
        tamanhoLido += bloco.length;
      }

      if (tamanhoLido !== inicial.size || assinatura(await lstat(caminho)) !== atual) {
        return;
      }

      const sha256 = hash.digest('hex');
      await this.prisma.arquivoNotaCompra.createMany({
        data: [{
          empresaId,
          nomeOriginal: nome,
          sha256,
          tamanhoBytes: tamanhoLido,
        }],
        skipDuplicates: true,
      });

      if (python && blocosPdf) {
        await this.extrairPdf(
          python,
          empresaId,
          sha256,
          Buffer.concat(blocosPdf, tamanhoLido),
        );
      }

      const entradaAutomatica = process.env.NOTAS_COMPRA_ENTRADA_AUTOMATICA === '1';
      const somenteSimulacao = process.env.NOTAS_COMPRA_SIMULAR_AUTOMACAO === '1';
      if ((somenteSimulacao || entradaAutomatica) && /\.pdf$/i.test(nome)) {
        try {
          const plano = await this.simulador.simular(empresaId, sha256);
          if (plano && entradaAutomatica && !somenteSimulacao) {
            const usuarioId = process.env.NOTAS_COMPRA_USUARIO_RESPONSAVEL_ID?.trim();
            if (!usuarioId || !UUID.test(usuarioId)) {
              this.logger.warn('Entrada automática sem usuário responsável válido na configuração.');
            } else {
              const recebimento = await this.recebimentos.confirmarNotaAgente(
                empresaId, usuarioId, plano.arquivoId, { itens: plano.itens }, plano.extracao,
              );
              this.logger.log('Entrada automática concluída. Recebimento: ' + recebimento.id);
            }
          }
        } catch (erro) {
          const mensagem = erro instanceof HttpException
            ? erro.message
            : 'Falha ao preparar ou gravar a entrada.';
          this.logger.warn('Nota mantida para conferência: ' + mensagem);
        }
      }

      this.observados.set(nome, { assinatura: atual, enfileirado: true });
    } finally {
      await arquivo.close();
    }
  }

  private async extrairPdf(
    python: string,
    empresaId: string,
    sha256: string,
    conteudo: Buffer,
  ) {
    const pendente = { empresaId, sha256, status: 'PENDENTE' as const };
    const atualizarDestinatario = process.env.NOTAS_COMPRA_ENTRADA_AUTOMATICA === '1';
    const registro = await this.prisma.arquivoNotaCompra.findFirst({
      where: atualizarDestinatario
        ? { empresaId, sha256, status: { in: ['PENDENTE', 'AGUARDANDO_CONFERENCIA'] } }
        : pendente,
      select: { id: true, status: true, extracao: true },
    });
    if (!registro) return;

    const previa = registro.extracao;
    if (registro.status === 'AGUARDANDO_CONFERENCIA' &&
        (!previa || typeof previa !== 'object' || Array.isArray(previa) || previa.destinatarioCnpj)) {
      return;
    }

    const saida = await new Promise<string>((resolve, reject) => {
      const leitor = execFile(
        python,
        ['-X', 'utf8', join(process.cwd(), 'scripts', 'extrair-nota-compra.py')],
        { encoding: 'utf8', timeout: process.env.NOTAS_COMPRA_OCR_PILOTO === '1' ? 180000 : 15000, maxBuffer: 512 * 1024, windowsHide: true },
        (erro, stdout) => {
          if (erro) reject(erro);
          else resolve(stdout);
        },
      );
      // A callback do processo informa falhas de execução, inclusive saída antecipada.
      leitor.stdin?.on('error', () => undefined);
      leitor.stdin?.end(conteudo);
    });

    const extracao = JSON.parse(saida) as Prisma.InputJsonObject | null;
    if (extracao === null) return;

    if (registro.status === 'AGUARDANDO_CONFERENCIA') {
      if (!previa || typeof previa !== 'object' || Array.isArray(previa) ||
          typeof extracao.destinatarioCnpj !== 'string') return;

      await this.prisma.arquivoNotaCompra.updateMany({
        where: { id: registro.id, empresaId, status: registro.status, extracao: { equals: previa } },
        data: { extracao: { ...previa, destinatarioCnpj: extracao.destinatarioCnpj } },
      });
      return;
    }


    const { count } = await this.prisma.arquivoNotaCompra.updateMany({
      where: { ...pendente, id: registro.id },
      data: { extracao, status: 'AGUARDANDO_CONFERENCIA' },
    });
    if (count > 0) {
      this.logger.log('Prévia de nota de compra disponível para conferência.');
    }
  }
}
