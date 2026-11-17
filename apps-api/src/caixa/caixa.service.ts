import {
  BadRequestException, ConflictException, Injectable, NotFoundException,
} from '@nestjs/common';
import { Prisma, ResultadoAuditoria, TipoAtorAuditoria } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditoriaService } from '../auditoria/auditoria.service.js';
import { calcularDiasComerciais, consolidarDias } from './calculo-caixa.js';
import {
  dataComercial, diasDoPeriodo, FUSO_CAIXA, inicioDiaComercialUTC, somarDias,
  validarDataCaixa, type ResumoComercialDia, FORMAS_CAIXA,
} from './periodo-caixa.js';

type ClienteCaixa = Pick<Prisma.TransactionClient, 'venda' | 'estornoVenda' | 'fechamentoCaixa'>;

const AVISO_FINANCEIRO = 'APURACAO COMERCIAL: formas de pagamento registradas na venda nao comprovam liquidacao. OUTRO nao foi classificado como recebido ou pendente; reembolsos e movimentacoes fisicas do caixa ainda nao possuem registro financeiro. Nao utilize como comprovante de saldo bancario ou quebra de caixa.';

@Injectable()
export class CaixaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditoria: AuditoriaService,
  ) {}

  private validarPeriodo(dias: number, dataFinal?: string) {
    if (![1, 15, 30].includes(dias)) {
      throw new BadRequestException('O período deve ser 1, 15 ou 30 dias.');
    }
    const hoje = dataComercial(new Date());
    let final: string;
    try {
      final = dataFinal === undefined ? hoje : validarDataCaixa(dataFinal);
    } catch {
      throw new BadRequestException('Data final inválida. Informe AAAA-MM-DD.');
    }
    if (final > hoje) throw new BadRequestException('Não é permitido consultar data futura.');
    const datas = diasDoPeriodo(final, dias as 1 | 15 | 30);
    return { datas, final, hoje };
  }

  private async calcular(empresaId: string, datas: string[], client: ClienteCaixa) {
    const inicio = inicioDiaComercialUTC(datas[0]);
    const fim = inicioDiaComercialUTC(somarDias(datas[datas.length - 1], 1));
    const where = { empresaId, criadoEm: { gte: inicio, lt: fim } };
    const [vendas, estornos] = await Promise.all([
      client.venda.findMany({ where, select: {
        criadoEm: true, subtotalOriginal: true, valorDesconto: true,
        total: true, formaPagamento: true,
      } }),
      client.estornoVenda.findMany({ where, select: {
        criadoEm: true, totalEstornado: true,
      } }),
    ]);
    return calcularDiasComerciais(datas, vendas, estornos);
  }

  async relatorio(empresaId: string, periodo = 1, dataFinal?: string) {
    const { datas } = this.validarPeriodo(periodo, dataFinal);
    const [atuais, fechamentos] = await Promise.all([
      this.calcular(empresaId, datas, this.prisma),
      this.prisma.fechamentoCaixa.findMany({
        where: { empresaId, dataOperacional: {
          gte: new Date(`${datas[0]}T00:00:00.000Z`),
          lte: new Date(`${datas[datas.length - 1]}T00:00:00.000Z`),
        } },
        select: {
          id: true, dataOperacional: true, resumo: true, criadoEm: true,
          usuario: { select: { nome: true } },
        },
      }),
    ]);
    const porData = new Map(fechamentos.map((item) => [item.dataOperacional.toISOString().slice(0, 10), item]));
    const dias = atuais.map((atual) => {
      const fechamento = porData.get(atual.data);
      if (!fechamento) return {
        ...atual, situacao: 'ABERTO' as const,
        fechamento: null, divergenciaAposFechamento: false,
      };
      const registrado = fechamento.resumo as unknown as ResumoComercialDia;
      // Fechamento e snapshot: uma operacao posterior nao altera seu registro.
      // PostgreSQL armazena JSONB e pode reordenar suas chaves.
      // Compare valores conhecidos, sem depender da ordem da serializacao.
      const campos = [
        'quantidadeVendas', 'quantidadeEstornos', 'brutoAntesDescontos',
        'descontos', 'vendasEfetivas', 'estornosDoDia', 'faturamentoLiquido',
        'outroSemClassificacaoFinanceira',
      ] as const;
      const divergencia = registrado.data !== atual.data ||
        campos.some((campo) => registrado[campo] !== atual[campo]) ||
        FORMAS_CAIXA.some((forma) =>
          registrado.porFormaPagamento?.[forma] !== atual.porFormaPagamento[forma]
        );
      return {
        ...registrado, situacao: 'FECHADO' as const,
        fechamento: {
          id: fechamento.id, criadoEm: fechamento.criadoEm,
          responsavel: fechamento.usuario.nome,
        },
        divergenciaAposFechamento: divergencia,
      };
    });
    return {
      periodoDias: periodo, inicio: datas[0], fim: datas[datas.length - 1],
      fusoHorario: FUSO_CAIXA, natureza: 'COMERCIAL_NAO_CONCILIADA',
      avisoFinanceiro: AVISO_FINANCEIRO,
      dias, consolidado: consolidarDias(dias),
      quantidadeDiasFechados: dias.filter((d) => d.situacao === 'FECHADO').length,
      quantidadeDiasComDivergencia: dias.filter((d) => d.divergenciaAposFechamento).length,
    };
  }

  /** Ranking comercial de itens vendidos no período, sem supor pagamento ou reembolso. */
  async rankingProdutos(empresaId: string, periodo = 1, dataFinal?: string) {
    const { datas } = this.validarPeriodo(periodo, dataFinal);
    const inicio = inicioDiaComercialUTC(datas[0]);
    const fim = inicioDiaComercialUTC(somarDias(datas[datas.length - 1], 1));

    // A soma é feita no PostgreSQL e sempre isolada pela empresa do JWT.
    const grupos = await this.prisma.itemVenda.groupBy({
      by: ['produtoId'],
      where: {
        venda: { is: { empresaId, criadoEm: { gte: inicio, lt: fim } } },
      },
      _sum: { quantidade: true, subtotal: true },
    });

    const ids = grupos.map((grupo) => grupo.produtoId);
    if (ids.length === 0) return {
      inicio: datas[0], fim: datas[datas.length - 1],
      natureza: 'PRODUTOS_BRUTOS_SEM_DESCONTO_OU_ESTORNO',
      topFaturamento: [], quantidadePorUnidade: [],
    };

    const produtos = await this.prisma.produto.findMany({
      where: { empresaId, id: { in: ids } },
      select: { id: true, nome: true, unidadeId: true },
    });
    const unidadesIds = Array.from(new Set(
      produtos.map((produto) => produto.unidadeId).filter((id): id is string => id !== null),
    ));
    const unidades = unidadesIds.length ? await this.prisma.unidade.findMany({
      where: { empresaId, id: { in: unidadesIds } },
      select: { id: true, codigo: true },
    }) : [];
    const porId = new Map(produtos.map((p) => [p.id, p]));
    const unidadePorId = new Map(unidades.map((u) => [u.id, u.codigo]));
    const linhas = grupos.flatMap((grupo) => {
      const produto = porId.get(grupo.produtoId);
      if (!produto) return [];
      return [{
        produtoId: produto.id,
        nome: produto.nome,
        unidade: produto.unidadeId ? unidadePorId.get(produto.unidadeId) ?? 'N/I' : 'N/I',
        quantidadeVendida: Number(grupo._sum.quantidade ?? 0),
        valorBrutoItens: Number(grupo._sum.subtotal ?? 0),
      }];
    });
    const topFaturamento = [...linhas].sort((a, b) =>
      b.valorBrutoItens - a.valorBrutoItens || a.nome.localeCompare(b.nome, 'pt-BR')
    ).slice(0, 10);
    const porUnidade = new Map<string, typeof linhas>();
    for (const linha of linhas) {
      const lista = porUnidade.get(linha.unidade) ?? [];
      lista.push(linha);
      porUnidade.set(linha.unidade, lista);
    }
    const quantidadePorUnidade = [...porUnidade.entries()]
      .sort(([a], [b]) => a.localeCompare(b, 'pt-BR'))
      .map(([unidade, itens]) => ({
        unidade,
        itens: itens.sort((a, b) =>
          b.quantidadeVendida - a.quantidadeVendida || a.nome.localeCompare(b.nome, 'pt-BR')
        ).slice(0, 10),
      }));
    return {
      inicio: datas[0], fim: datas[datas.length - 1],
      natureza: 'PRODUTOS_BRUTOS_SEM_DESCONTO_OU_ESTORNO',
      topFaturamento, quantidadePorUnidade,
    };
  }

  /** Registra fotografia comercial imutavel; nao simula conciliacao bancaria. */
  async fecharDia(empresaId: string, usuarioId: string, data: string, observacao?: string) {
    const { datas } = this.validarPeriodo(1, data);
    if (observacao !== undefined && (typeof observacao !== 'string' || observacao.trim().length > 500)) {
      throw new BadRequestException('Observação deve ter no máximo 500 caracteres.');
    }
    try {
      return await this.prisma.$transaction(async (tx) => {
        const usuario = await tx.usuario.findFirst({
          where: { id: usuarioId, empresaId, ativo: true, perfil: { in: ['ADMINISTRADOR', 'GERENTE'] } },
          select: { id: true },
        });
        if (!usuario) throw new NotFoundException('Gestor ativo não encontrado nesta empresa.');
        const dataOperacional = new Date(`${data}T00:00:00.000Z`);
        const anterior = await tx.fechamentoCaixa.findUnique({
          where: { empresaId_dataOperacional: { empresaId, dataOperacional } },
          select: { id: true },
        });
        if (anterior) throw new ConflictException('Este dia já possui fechamento registrado.');
        const [resumo] = await this.calcular(empresaId, datas, tx);
        const registro = await tx.fechamentoCaixa.create({
          data: {
            empresaId, usuarioId, dataOperacional,
            fusoHorario: FUSO_CAIXA,
            resumo: resumo as unknown as Prisma.InputJsonValue,
            observacao: observacao?.trim() || null,
          },
        });
        await this.auditoria.registrar({
          empresaId, atorId: usuarioId,
          tipoAtor: TipoAtorAuditoria.USUARIO_EMPRESA,
          modulo: 'CAIXA', acao: 'FECHAR_DIA_COMERCIAL',
          entidade: 'FechamentoCaixa', entidadeId: registro.id,
          resultado: ResultadoAuditoria.SUCESSO,
          metadados: { data, fusoHorario: FUSO_CAIXA, natureza: 'COMERCIAL_NAO_CONCILIADA' },
          dadosPosteriores: resumo,
        }, tx);
        return {
          id: registro.id, data, fusoHorario: FUSO_CAIXA,
          natureza: 'COMERCIAL_NAO_CONCILIADA',
          resumo, avisoFinanceiro: AVISO_FINANCEIRO,
        };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (erro) {
      if (erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === 'P2002') {
        throw new ConflictException('Este dia já possui fechamento registrado.');
      }
      if (erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === 'P2034') {
        throw new ConflictException('O movimento do dia mudou durante o fechamento. Atualize a prévia e tente novamente.');
      }
      throw erro;
    }
  }
}
