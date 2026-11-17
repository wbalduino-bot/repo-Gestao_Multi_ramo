import { createHash } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  ResultadoAuditoria,
  TipoAtorAuditoria,
} from '@prisma/client';
import { AuditoriaService } from '../auditoria/auditoria.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CriarEstornoVendaDto } from './dto/criar-estorno-venda.dto.js';

const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const PERFIS = new Set(['ADMINISTRADOR', 'GERENTE']);
const ZERO = new Prisma.Decimal(0);

/** Calcula a identidade da operacao sem incluir precos calculados pelo servidor. */
export function identificarEstorno(vendaId: string, dto: CriarEstornoVendaDto) {
  if (!UUID.test(vendaId) || !UUID.test(dto.chaveOperacao ?? '')) {
    throw new BadRequestException('Identificador da venda ou chave de estorno invalido.');
  }
  const justificativa = dto.justificativa?.trim();
  if (!justificativa || justificativa.length < 10 || justificativa.length > 500) {
    throw new BadRequestException('Informe uma justificativa entre 10 e 500 caracteres.');
  }
  if (!Array.isArray(dto.itens) || dto.itens.length === 0) {
    throw new BadRequestException('Informe ao menos um item para estornar.');
  }
  const usados = new Set<string>();
  const itens = dto.itens.map((i) => {
    if (!i || !UUID.test(i.itemVendaId ?? '') || typeof i.quantidade !== 'number' ||
        !Number.isFinite(i.quantidade) || i.quantidade <= 0 ||
        !/^\d{1,11}(?:\.\d{1,3})?$/.test(String(i.quantidade))) {
      throw new BadRequestException('Produto ou quantidade invalida no estorno.');
    }
    const id = i.itemVendaId.toLowerCase();
    if (usados.has(id)) throw new BadRequestException('Item repetido no estorno.');
    usados.add(id);
    return { itemVendaId: id, quantidade: new Prisma.Decimal(i.quantidade.toString()) };
  }).sort((a, b) => a.itemVendaId.localeCompare(b.itemVendaId));
  const canonico = JSON.stringify({
    versao: 1,
    vendaId: vendaId.toLowerCase(),
    justificativa,
    itens: itens.map((i) => ({ id: i.itemVendaId, quantidade: i.quantidade.toFixed(3) })),
  });
  return {
    justificativa,
    chaveOperacao: dto.chaveOperacao.toLowerCase(),
    hashRequisicao: createHash('sha256').update(canonico).digest('hex'),
    itens,
  };
}

@Injectable()
export class EstornosVendaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditoria: AuditoriaService,
  ) {}

  private async autorizar(empresaId: string, usuarioId: string,
    transacao: Prisma.TransactionClient | PrismaService) {
    const usuario = await transacao.usuario.findFirst({
      where: { empresaId, id: usuarioId, ativo: true },
      select: { id: true, perfil: true },
    });
    if (!usuario || !PERFIS.has(usuario.perfil)) {
      throw new ForbiddenException('Somente administradores e gerentes ativos podem estornar vendas.');
    }
  }

  /** Consulta o registro da chave, inclusive apos resposta perdida na rede. */
  private async obterOperacao(
    prisma: Prisma.TransactionClient | PrismaService,
    empresaId: string,
    usuarioId: string,
    vendaId: string,
    chaveOperacao: string,
    hashRequisicao: string,
  ) {
    const existente = await prisma.estornoVenda.findUnique({
      where: { empresaId_chaveOperacao: { empresaId, chaveOperacao } },
      include: { itens: true },
    });
    if (!existente) return null;
    if (existente.usuarioId !== usuarioId || existente.vendaId !== vendaId ||
        existente.hashRequisicao !== hashRequisicao) {
      throw new ConflictException('Chave de operacao ja utilizada em outro estorno.');
    }
    return this.resumir(existente);
  }

  private resumir(estorno: {
    id: string; vendaId: string; justificativa: string; totalEstornado: Prisma.Decimal;
    criadoEm: Date; usuarioId: string; chaveOperacao: string;
    itens: { itemVendaId: string; quantidade: Prisma.Decimal; valorEstornado: Prisma.Decimal }[];
  }) {
    return {
      id: estorno.id,
      vendaId: estorno.vendaId,
      usuarioId: estorno.usuarioId,
      chaveOperacao: estorno.chaveOperacao,
      justificativa: estorno.justificativa,
      valorEstornado: Number(estorno.totalEstornado),
      criadoEm: estorno.criadoEm,
      itens: estorno.itens.map((i) => ({
        itemVendaId: i.itemVendaId,
        quantidade: Number(i.quantidade),
        valorEstornado: Number(i.valorEstornado),
      })),
      reembolsoFinanceiro: 'NAO_REGISTRADO' as const,
    };
  }

  /** Historico operacional. O valor estornado nao indica reembolso realizado. */
  async listar(empresaId: string, usuarioId: string, vendaId: string) {
    await this.autorizar(empresaId, usuarioId, this.prisma);
    const venda = await this.prisma.venda.findFirst({
      where: { empresaId, id: vendaId }, select: { id: true },
    });
    if (!venda) throw new NotFoundException('Venda nao encontrada nesta empresa.');
    const estornos = await this.prisma.estornoVenda.findMany({
      where: { empresaId, vendaId },
      include: { itens: true },
      orderBy: { criadoEm: 'asc' },
    });
    return estornos.map((e) => this.resumir(e));
  }

  async criar(empresaId: string, usuarioId: string, vendaId: string, dto: CriarEstornoVendaDto) {
    const op = identificarEstorno(vendaId, dto);
    const idVenda = vendaId.toLowerCase();
    try {
      return await this.prisma.$transaction(async (tx) => {
        await this.autorizar(empresaId, usuarioId, tx);
        const anterior = await this.obterOperacao(tx, empresaId, usuarioId, idVenda,
          op.chaveOperacao, op.hashRequisicao);
        if (anterior) return anterior;

        const venda = await tx.venda.findFirst({
          where: { empresaId, id: idVenda },
          include: { itens: true },
        });
        if (!venda) throw new NotFoundException('Venda nao encontrada nesta empresa.');
        if (venda.subtotalOriginal.lt(0) || (venda.subtotalOriginal.isZero() && venda.total.gt(0))) {
          throw new ConflictException('Venda sem subtotal positivo exige revisao antes de estorno.');
        }

        // Distribui o desconto global por item, preservando o total exato em centavos.
        const itensOrdenados = [...venda.itens].sort((a, b) => a.id.localeCompare(b.id));
        const valoresLiquidos = new Map<string, Prisma.Decimal>();
        let atribuido = ZERO;
        for (let i = 0; i < itensOrdenados.length; i++) {
          const item = itensOrdenados[i];
          const liquido = i === itensOrdenados.length - 1
            ? venda.total.minus(atribuido)
            : venda.subtotalOriginal.isZero() ? ZERO
            : venda.total.mul(item.subtotal).div(venda.subtotalOriginal).toDecimalPlaces(2);
          valoresLiquidos.set(item.id, liquido);
          atribuido = atribuido.plus(liquido);
        }

        type Plano = {
          itemVendaId: string;
          produtoId: string;
          quantidade: Prisma.Decimal;
          valorEstornado: Prisma.Decimal;
          saldoId: string;
          alocacoes: { loteId: string; quantidade: Prisma.Decimal }[];
        };
        const planos: Plano[] = [];

        for (const solicitado of op.itens) {
          const item = venda.itens.find((v) => v.id === solicitado.itemVendaId);
          if (!item) throw new BadRequestException('Item nao pertence a esta venda.');

          const anteriores = await tx.itemEstornoVenda.findMany({
            where: { itemVendaId: item.id, estorno: { empresaId, vendaId: idVenda } },
            include: { movimentacaoEstoque: { include: { lotes: true } } },
          });
          const quantidadeAnterior = anteriores.reduce((acc, v) => acc.plus(v.quantidade), ZERO);
          const quantidadeDisponivel = item.quantidade.minus(quantidadeAnterior);
          if (solicitado.quantidade.gt(quantidadeDisponivel)) {
            throw new ConflictException('Quantidade solicitada maior que a disponivel para estorno.');
          }

          const movimentosSaida = await tx.movimentacaoEstoque.findMany({
            where: { empresaId, produtoId: item.produtoId, referenciaId: idVenda, tipo: 'SAIDA' },
            include: { lotes: true },
          });
          if (movimentosSaida.length !== 1) {
            throw new ConflictException('Nao foi possivel identificar a saida original deste item.');
          }
          const saida = movimentosSaida[0];
          const baixado = saida.lotes.reduce((acc, v) => acc.plus(v.quantidade), ZERO);
          if (!baixado.eq(item.quantidade)) {
            throw new ConflictException('Lotes da venda original nao correspondem ao item vendido.');
          }

          const retornadoPorLote = new Map<string, Prisma.Decimal>();
          for (const antigo of anteriores) {
            for (const lote of antigo.movimentacaoEstoque.lotes) {
              retornadoPorLote.set(lote.loteId,
                (retornadoPorLote.get(lote.loteId) ?? ZERO).plus(lote.quantidade));
            }
          }
          const alocacoes: Plano['alocacoes'] = [];
          let restante = solicitado.quantidade;
          for (const baixa of saida.lotes) {
            const retornado = retornadoPorLote.get(baixa.loteId) ?? ZERO;
            const porRetornar = baixa.quantidade.minus(retornado);
            if (porRetornar.lt(0)) throw new ConflictException('Historico dos lotes inconsistente.');
            const devolver = Prisma.Decimal.min(porRetornar, restante);
            if (devolver.gt(0)) alocacoes.push({ loteId: baixa.loteId, quantidade: devolver });
            restante = restante.minus(devolver);
            if (restante.isZero()) break;
          }
          if (!restante.isZero()) {
            throw new ConflictException('Nao ha lotes originais suficientes para este estorno.');
          }

          const saldo = await tx.saldoEstoque.findFirst({
            where: { empresaId, produtoId: item.produtoId }, select: { id: true },
          });
          if (!saldo) throw new ConflictException('Saldo do produto ausente.');

          const liquidoItem = valoresLiquidos.get(item.id)!;
          const valorAnterior = anteriores.reduce((acc, v) => acc.plus(v.valorEstornado), ZERO);
          const saldoFinanceiro = liquidoItem.minus(valorAnterior);
          if (saldoFinanceiro.lt(0)) throw new ConflictException('Historico financeiro do estorno inconsistente.');
          // Limita o arredondamento de estornos parciais ao valor ainda disponivel.
          const proporcional = liquidoItem.mul(solicitado.quantidade)
            .div(item.quantidade).toDecimalPlaces(2);
          const valorEstornado = solicitado.quantidade.eq(quantidadeDisponivel)
            ? saldoFinanceiro
            : Prisma.Decimal.min(saldoFinanceiro, proporcional);
          planos.push({ itemVendaId: item.id, produtoId: item.produtoId,
            quantidade: solicitado.quantidade, valorEstornado, saldoId: saldo.id, alocacoes });
        }

        const totalEstornado = planos.reduce((acc, p) => acc.plus(p.valorEstornado), ZERO);
        const estorno = await tx.estornoVenda.create({
          data: {
            empresaId, usuarioId, vendaId: idVenda,
            chaveOperacao: op.chaveOperacao, hashRequisicao: op.hashRequisicao,
            justificativa: op.justificativa, totalEstornado,
          },
        });

        for (const plano of planos) {
          // A mesma transacao atualiza o saldo, o lote original e a auditoria.
          const saldo = await tx.saldoEstoque.update({
            where: { id: plano.saldoId },
            data: { quantidadeDisponivel: { increment: plano.quantidade } },
          });
          const movimento = await tx.movimentacaoEstoque.create({
            data: {
              empresaId, usuarioId, produtoId: plano.produtoId, tipo: 'ENTRADA',
              quantidade: plano.quantidade, saldoApos: saldo.quantidadeDisponivel,
              referenciaId: estorno.id,
              motivo: `Estorno venda ${idVenda}: ${op.justificativa}`.slice(0, 500),
            },
          });
          for (const alocacao of plano.alocacoes) {
            // Nunca criar lote novo nesta operacao: restaurar o lote de origem.
            const lote = await tx.loteEstoque.updateMany({
              where: { empresaId, produtoId: plano.produtoId, id: alocacao.loteId },
              data: { quantidadeRestante: { increment: alocacao.quantidade } },
            });
            if (lote.count !== 1) throw new ConflictException('Lote original nao localizado.');
            await tx.movimentacaoLoteEstoque.create({
              data: {
                empresaId, produtoId: plano.produtoId, movimentacaoId: movimento.id,
                loteId: alocacao.loteId, quantidade: alocacao.quantidade,
              },
            });
          }
          await tx.itemEstornoVenda.create({
            data: {
              estornoId: estorno.id, itemVendaId: plano.itemVendaId,
              movimentacaoEstoqueId: movimento.id,
              quantidade: plano.quantidade, valorEstornado: plano.valorEstornado,
            },
          });
        }
        await this.auditoria.registrar({
          empresaId, atorId: usuarioId, tipoAtor: TipoAtorAuditoria.USUARIO_EMPRESA,
          modulo: 'VENDAS', acao: 'ESTORNAR', entidade: 'ESTORNO_VENDA',
          entidadeId: estorno.id, resultado: ResultadoAuditoria.SUCESSO,
          justificativa: op.justificativa,
          dadosPosteriores: {
            vendaId: idVenda, valorEstornado: totalEstornado.toFixed(2),
            itens: planos.map((p) => ({ itemVendaId: p.itemVendaId,
              quantidade: p.quantidade.toFixed(3) })),
            saldoRestituido: true,
            reembolsoFinanceiro: 'NAO_REGISTRADO',
          },
        }, tx);
        return this.resumir({ ...estorno, itens: planos.map((p) => ({
          itemVendaId: p.itemVendaId, quantidade: p.quantidade,
          valorEstornado: p.valorEstornado,
        })) });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (erro) {
      if (erro instanceof Prisma.PrismaClientKnownRequestError &&
          (erro.code === 'P2002' || erro.code === 'P2034')) {
        await this.autorizar(empresaId, usuarioId, this.prisma);
        const anterior = await this.obterOperacao(this.prisma, empresaId, usuarioId,
          idVenda, op.chaveOperacao, op.hashRequisicao);
        if (anterior) return anterior;
      }
      throw erro;
    }
  }
}
