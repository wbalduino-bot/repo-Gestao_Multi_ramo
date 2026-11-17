import { randomUUID as gerarUuidSkuNota } from 'node:crypto';
import {
  BadRequestException, ConflictException, Injectable,
  InternalServerErrorException, NotFoundException, UnauthorizedException,
} from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Prisma, ResultadoAuditoria, TipoAtorAuditoria } from '@prisma/client';
import { AuditoriaService } from '../auditoria/auditoria.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ProdutosService } from '../produtos/produtos.service.js';
import {
  DadosNotaCompraDto, type ConfirmarRecebimentoCompraDto,
  type DadosEntradaCompraDto,
} from './confirmar-recebimento-compra.dto.js';
import { CriarUnidadeDto } from '../unidades/dto/criar-unidade.dto.js';
import { criarUnidadeNaTransacao } from '../unidades/criar-unidade-na-transacao.js';
import { calcularQuantidadeNota, codigosUnidadeEstoqueDaNota } from './calcular-quantidade-nota.js';
import type { ConfirmarNotaAgenteDto, ProdutoNovoNotaDto } from './confirmar-nota-agente.dto.js';
import { RevisarNotaAgenteDto } from './revisar-nota-agente.dto.js';
import { reprocessarNotaVazia, versaoPrevia } from './reprocessar-nota-vazia.js';
import { ReprocessarNotaVaziaDto } from './reprocessar-nota-vazia.dto.js';

type ItemConfirmacao = DadosEntradaCompraDto & {
  descricaoNota: string;
  codigoFornecedor?: string;
  produtoId?: string;
  produtoNovo?: ProdutoNovoNotaDto;
  usarPrecoDaNota?: boolean;
  conversao?: {
    quantidadeNota: string;
    unidadeNota: string;
    fatorEmbalagem?: number;
    valorTotalItemNota?: string;
    valorUnitarioNota?: string;
  };
};

@Injectable()
export class RecebimentosCompraService {
  async listarNotasPendentes(empresaId: string, pagina: number) {
    if (!Number.isSafeInteger(pagina) || pagina < 1 || pagina > 100000) {
      throw new BadRequestException('Página inválida.');
    }

    const limite = 10;
    const notas = await this.prisma.arquivoNotaCompra.findMany({
      where: { empresaId, status: 'AGUARDANDO_CONFERENCIA' },
      orderBy: [{ criadoEm: 'desc' }, { id: 'desc' }],
      skip: (pagina - 1) * limite,
      take: limite + 1,
      select: { id: true, nomeOriginal: true, criadoEm: true, extracao: true },
    });

    const unidades = await this.prisma.unidade.findMany({
      where: { empresaId },
      orderBy: { codigo: 'asc' },
      select: { id: true, codigo: true, nome: true },
    });

    return { dados: notas.slice(0, limite).map(nota => ({ ...nota, versaoExtracao: versaoPrevia(nota.extracao) })), pagina, temProxima: notas.length > limite, unidades };
  }

  constructor(
    private readonly prisma: PrismaService,
    private readonly produtos: ProdutosService,
    private readonly auditoria: AuditoriaService,
  ) {}

  async listar(empresaId: string, pagina: number, limite: number) {
    if (pagina < 1 || pagina > 1000000 || limite < 1 || limite > 100) {
      throw new BadRequestException('Informe uma página e um limite válidos.');
    }

    const where = { empresaId };
    const [registros, total] = await this.prisma.$transaction([
      this.prisma.recebimentoCompra.findMany({
        where,
        orderBy: [{ criadoEm: 'desc' }, { id: 'desc' }],
        skip: (pagina - 1) * limite,
        take: limite,
        select: {
          id: true,
          fornecedorNome: true,
          fornecedorCnpj: true,
          serieNota: true,
          numeroNota: true,
          emitidaEm: true,
          compradaEm: true,
          criadoEm: true,
          incluidoEm: true,
          origem: true,
          incluidoPorOrigem: true,
          incluidoPorNome: true,
          status: true,
          _count: { select: { itens: true } },
        },
      }),
      this.prisma.recebimentoCompra.count({ where }),
    ], { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });

    return {
      dados: registros.map(({ _count, ...registro }) => ({
        ...registro,
        quantidadeItens: _count.itens,
      })),
      pagina,
      limite,
      total,
      totalPaginas: Math.ceil(total / limite),
    };
  }

  confirmar(
    empresaId: string,
    usuarioId: string,
    dto: ConfirmarRecebimentoCompraDto,
  ) {
    return this.confirmarCompra(empresaId, usuarioId, dto, dto.itens);
  }

  async listarVinculosNotaPendente(
    empresaId: string,
    arquivoId: string,
  ) {
    const arquivo = await this.prisma.arquivoNotaCompra.findFirst({
      where: {
        id: arquivoId,
        empresaId,
        status: 'AGUARDANDO_CONFERENCIA',
      },
      select: { extracao: true },
    });

    if (!arquivo) {
      throw new NotFoundException(
        'Nota pendente não encontrada nesta empresa.',
      );
    }

    const nota = arquivo.extracao;

    if (
      !nota ||
      typeof nota !== 'object' ||
      Array.isArray(nota) ||
      !Array.isArray(nota.itens)
    ) {
      throw new BadRequestException(
        'A prévia da nota está indisponível.',
      );
    }

    const fornecedorCnpj =
      typeof nota.fornecedorCnpj === 'string'
        ? nota.fornecedorCnpj.trim().toUpperCase().replace(/[./-]/g, '')
        : '';

    if (!/^[A-Z0-9]{12}\d{2}$/.test(fornecedorCnpj)) {
      throw new BadRequestException(
        'O CNPJ do fornecedor é inválido.',
      );
    }

    const codigos = Array.from(
      new Set(
        nota.itens.flatMap((linha) => {
          if (
            !linha ||
            typeof linha !== 'object' ||
            Array.isArray(linha) ||
            typeof linha.codigoFornecedor !== 'string'
          ) {
            return [];
          }

          const codigo = linha.codigoFornecedor.toUpperCase();

          return /^[A-Z0-9]{1,64}$/.test(codigo)
            ? [codigo]
            : [];
        }),
      ),
    );

    if (codigos.length === 0) {
      return { dados: [] };
    }

    const vinculos =
      await this.prisma.vinculoProdutoFornecedorCompra.findMany({
        where: {
          empresaId,
          fornecedorCnpj,
          codigoFornecedor: { in: codigos },
          produto: { ativo: true },
        },
        select: {
          codigoFornecedor: true,
          produto: {
            select: {
              id: true,
              nome: true,
              sku: true,
              unidadeId: true,
            },
          },
        },
      });

    const produtosPorCodigo = new Map(
      vinculos.map((vinculo) => [
        vinculo.codigoFornecedor,
        vinculo.produto,
      ]),
    );

    return {
      dados: nota.itens.flatMap((linha, indiceNota) => {
        if (
          !linha ||
          typeof linha !== 'object' ||
          Array.isArray(linha) ||
          typeof linha.codigoFornecedor !== 'string'
        ) {
          return [];
        }

        const codigo = linha.codigoFornecedor.toUpperCase();
        const produto = produtosPorCodigo.get(codigo);

        return produto ? [{ indiceNota, produto }] : [];
      }),
    };
  }

  async vincularProdutoNota(
    empresaId: string,
    usuarioId: string,
    arquivoId: string,
    indice: number,
    produtoId: string,
  ) {
    if (!Number.isSafeInteger(indice) || indice < 0 || indice > 99) {
      throw new BadRequestException('Índice da linha inválido.');
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        const arquivo = await tx.arquivoNotaCompra.findFirst({
          where: { id: arquivoId, empresaId, status: 'AGUARDANDO_CONFERENCIA' },
          select: { extracao: true },
        });
        if (!arquivo) throw new NotFoundException('Nota em conferência não encontrada.');

        const nota = arquivo.extracao;
        if (!nota || typeof nota !== 'object' || Array.isArray(nota) || !Array.isArray(nota.itens)) {
          throw new BadRequestException('A prévia da nota está indisponível.');
        }

        const cnpj = typeof nota.fornecedorCnpj === 'string'
          ? nota.fornecedorCnpj.trim().toUpperCase().replace(/[./-]/g, '')
          : '';
        const linha = nota.itens[indice];
        const codigo = linha && typeof linha === 'object' && !Array.isArray(linha)
          ? linha.codigoFornecedor
          : null;
        if (!/^[A-Z0-9]{12}\d{2}$/.test(cnpj) ||
            typeof codigo !== 'string' || !/^[A-Z0-9]{1,64}$/i.test(codigo)) {
          throw new BadRequestException('Fornecedor ou código do item inválido.');
        }

        const produto = await tx.produto.findFirst({
          where: { id: produtoId, empresaId, ativo: true },
          select: { id: true },
        });
        if (!produto) throw new BadRequestException('Vincule um produto ativo da empresa.');

        const identidade = { empresaId, fornecedorCnpj: cnpj, codigoFornecedor: codigo.toUpperCase() };
        const anterior = await tx.vinculoProdutoFornecedorCompra.findUnique({
          where: { empresaId_fornecedorCnpj_codigoFornecedor: identidade },
        });
        if (anterior) {
          if (anterior.produtoId !== produtoId) {
            throw new ConflictException('O código já está vinculado a outro produto.');
          }
          return anterior;
        }

        const vinculo = await tx.vinculoProdutoFornecedorCompra.create({
          data: { ...identidade, produtoId },
        });
        await this.auditoria.registrar({
          empresaId,
          atorId: usuarioId,
          tipoAtor: TipoAtorAuditoria.USUARIO_EMPRESA,
          modulo: 'COMPRAS',
          acao: 'VINCULAR_PRODUTO_FORNECEDOR',
          entidade: 'VINCULO_PRODUTO_FORNECEDOR',
          entidadeId: vinculo.id,
          resultado: ResultadoAuditoria.SUCESSO,
          metadados: { arquivoNotaCompraId: arquivoId, indiceNota: indice, produtoId },
        }, tx);
        return vinculo;
      });
    } catch (erro) {
      if (erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === 'P2002') {
        throw new ConflictException('O vínculo mudou durante a operação. Confira e tente novamente.');
      }
      throw erro;
    }
  }

  // Reprocessamento explicito apenas de previas vazias; nao movimenta estoque.
  async reprocessarNotaAgente(
    empresaId: string, usuarioId: string, arquivoId: string, dto: ReprocessarNotaVaziaDto,
  ) {
    return reprocessarNotaVazia(this.prisma, this.auditoria, empresaId, usuarioId, arquivoId, dto);
  }

  async confirmarNotaAgente(
    empresaId: string,
    usuarioId: string,
    arquivoId: string,
    dto: ConfirmarNotaAgenteDto,
    extracaoPlanejada?: Prisma.JsonObject,
  ) {
    const arquivo = await this.prisma.arquivoNotaCompra.findFirst({
      where: { id: arquivoId, empresaId },
      select: { status: true, extracao: true },
    });
    if (!arquivo) throw new NotFoundException('Arquivo de compra não encontrado.');
    if (arquivo.status !== 'AGUARDANDO_CONFERENCIA') {
      throw new ConflictException('O arquivo não está aguardando conferência.');
    }

    const extracao = arquivo.extracao;
    if (!extracao || typeof extracao !== 'object' || Array.isArray(extracao)) {
      throw new BadRequestException('A prévia da nota está indisponível.');
    }

    const linhas = extracao.itens;
    if (!Array.isArray(linhas) || linhas.length === 0 || linhas.length > 100) {
      throw new BadRequestException('A prévia não contém uma lista válida de itens.');
    }

    // Notas com divergencias de OCR nao podem ser confirmadas
    // ate que exista uma conferencia corretiva validada.
    const itensOcrInconsistentes = linhas.some(
      (linha) =>
        linha !== null &&
        typeof linha === 'object' &&
        !Array.isArray(linha) &&
        linha.valoresConferem === false,
    );

    // OCR piloto nunca pode ser confirmado pela automacao.
    // A revisao validada libera apenas uma nova confirmacao manual.
    const ocrPiloto = extracao.modoExtracao === 'OCR_PILOTO';
    const revisaoFiscal = extracao.revisaoFiscal;

    const revisaoManualValidada =
      extracaoPlanejada === undefined &&
      ocrPiloto &&
      revisaoFiscal !== null &&
      typeof revisaoFiscal === 'object' &&
      !Array.isArray(revisaoFiscal) &&
      revisaoFiscal.status === 'VALIDADA' &&
      typeof revisaoFiscal.revisadaPorId === 'string' &&
      revisaoFiscal.revisadaPorId.length > 0 &&
      typeof revisaoFiscal.revisadaEm === 'string' &&
      typeof extracao.extracaoOriginalOcr === 'object' &&
      extracao.extracaoOriginalOcr !== null &&
      !Array.isArray(extracao.extracaoOriginalOcr) &&
      linhas.every(
        (linha) =>
          linha !== null &&
          typeof linha === 'object' &&
          !Array.isArray(linha) &&
          linha.valoresConferem === true &&
          typeof linha.unidadeNota === 'string' &&
          linha.unidadeNota.trim().length > 0,
      );

    if (
      itensOcrInconsistentes ||
      (extracao.aptoParaConfirmacaoAutomatica === false &&
        !revisaoManualValidada) ||
      (ocrPiloto && !revisaoManualValidada)
    ) {
      throw new BadRequestException(
        'A nota possui pendencias de OCR e precisa de revisao antes da confirmacao.',
      );
    }

    const dadosNota = plainToInstance(DadosNotaCompraDto, {
      fornecedorNome: extracao.fornecedorNome,
      fornecedorCnpj: extracao.fornecedorCnpj,
      serieNota: extracao.serieNota,
      numeroNota: extracao.numeroNota,
      emitidaEm: extracao.emitidaEm,
      compradaEm: extracao.compradaEm,
    });
    if ((await validate(dadosNota)).length > 0) {
      throw new BadRequestException('Os dados da nota extraída estão incompletos ou inválidos.');
    }

    const indices = new Set(dto.itens.map((item) => item.indiceNota));
    if (dto.itens.length !== linhas.length || indices.size !== linhas.length) {
      throw new BadRequestException('Confira todos os itens da nota, uma vez por linha.');
    }

    const itens = dto.itens.map((item): ItemConfirmacao => {
      const linha = linhas[item.indiceNota];
      if (!linha || typeof linha !== 'object' || Array.isArray(linha) ||
          typeof linha.descricaoNota !== 'string' ||
          !linha.descricaoNota.trim() || linha.descricaoNota.trim().length > 250) {
        throw new BadRequestException('Um item informado não corresponde a uma linha válida da nota.');
      }
      if (typeof linha.quantidadeNota !== 'string' || typeof linha.unidadeNota !== 'string') {
        throw new BadRequestException('A linha não contém quantidade e unidade de origem válidas.');
      }
      if (Boolean(item.produtoId) === Boolean(item.produtoNovo)) {
        throw new BadRequestException('Escolha um produto existente ou cadastre um novo por linha.');
      }

      return {
        descricaoNota: linha.descricaoNota.trim(),
        codigoFornecedor: typeof linha.codigoFornecedor === 'string'
          ? linha.codigoFornecedor.toUpperCase() : undefined,
        produtoId: item.produtoId,
        produtoNovo: item.produtoNovo,
        usarPrecoDaNota: item.usarPrecoDaNota,
        conversao: {
          quantidadeNota: linha.quantidadeNota,
          unidadeNota: linha.unidadeNota,
          fatorEmbalagem: item.fatorEmbalagem ?? undefined,
          valorTotalItemNota: typeof linha.valorTotalItemNota === 'string'
            ? linha.valorTotalItemNota : undefined,
          valorUnitarioNota: typeof linha.valorUnitarioNota === 'string'
            ? linha.valorUnitarioNota : undefined,
        },
        quantidadeRecebida: item.quantidadeRecebida,
        codigoLote: item.codigoLote,
        validadeEm: item.validadeEm,
      };
    });

    return this.confirmarCompra(
      empresaId,
      usuarioId,
      dadosNota,
      itens,
      arquivoId,
      extracaoPlanejada,
      typeof extracao.destinatarioCnpj === 'string'
        ? extracao.destinatarioCnpj
        : undefined,
      // Confirma apenas a versao da extracao efetivamente conferida.
      extracao,
    );
  }


  /**
   * Registra a revisao fiscal de uma nota OCR.
   *
   * Nao confirma recebimentos nem movimenta estoque.
   * Preserva a primeira extracao para rastreabilidade.
   */
  async revisarNotaAgente(
    empresaId: string,
    usuarioId: string,
    arquivoId: string,
    dto: RevisarNotaAgenteDto,
  ) {
    const revisao = plainToInstance(RevisarNotaAgenteDto, dto);

    const erros = await validate(revisao, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });

    if (erros.length > 0) {
      throw new BadRequestException(
        'Informe todos os campos da revisao fiscal corretamente.',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const usuario = await tx.usuario.findFirst({
        where: {
          id: usuarioId,
          empresaId,
          ativo: true,
          perfil: { in: ['ADMINISTRADOR', 'GERENTE'] },
        },
        select: { id: true },
      });

      if (!usuario) {
        throw new UnauthorizedException(
          'Usuario sem permissao para revisar notas fiscais.',
        );
      }

      const arquivo = await tx.arquivoNotaCompra.findFirst({
        where: {
          id: arquivoId,
          empresaId,
          status: 'AGUARDANDO_CONFERENCIA',
        },
        select: { extracao: true },
      });

      if (!arquivo) {
        throw new NotFoundException(
          'Nota pendente nao encontrada nesta empresa.',
        );
      }

      const extracao = arquivo.extracao;

      if (
        !extracao ||
        typeof extracao !== 'object' ||
        Array.isArray(extracao) ||
        extracao.modoExtracao !== 'OCR_PILOTO' ||
        !Array.isArray(extracao.itens)
      ) {
        throw new BadRequestException(
          'A nota nao possui uma extracao OCR valida para revisao.',
        );
      }

      const empresa = await tx.empresa.findUnique({
        where: { id: empresaId },
        select: { cnpj: true, ativo: true },
      });

      const destinatario = extracao.destinatarioCnpj;

      if (
        !empresa?.ativo ||
        typeof destinatario !== 'string' ||
        !/^\d{14}$/.test(destinatario) ||
        empresa.cnpj?.replace(/\D/g, '') !== destinatario
      ) {
        throw new BadRequestException(
          'O CNPJ do destinatario nao corresponde a empresa ativa.',
        );
      }

      const originais = extracao.itens;

      if (
        originais.length === 0 ||
        originais.length > 100 ||
        revisao.itens.length !== originais.length
      ) {
        throw new BadRequestException(
          'A revisao deve conter todos os itens da nota.',
        );
      }

      const revisoes = new Map(
        revisao.itens.map((item) => [item.indiceNota, item]),
      );

      if (revisoes.size !== originais.length) {
        throw new BadRequestException(
          'Existem indices repetidos ou itens ausentes na revisao.',
        );
      }

      let soma = new Prisma.Decimal(0);

      const itensRevisados = originais.map((valor, indice) => {
        const item = revisoes.get(indice);

        if (
          !item ||
          !valor ||
          typeof valor !== 'object' ||
          Array.isArray(valor) ||
          typeof valor.codigoFornecedor !== 'string'
        ) {
          throw new BadRequestException(
            'A revisao contem itens invalidos ou incompletos.',
          );
        }

        const quantidade = new Prisma.Decimal(
          item.quantidadeNota,
        );

        const unitario = new Prisma.Decimal(
          item.valorUnitarioNota,
        );

        const total = new Prisma.Decimal(
          item.valorTotalItemNota,
        );

        if (
          !quantidade.isPositive() ||
          !unitario.isPositive() ||
          !total.isPositive()
        ) {
          throw new BadRequestException(
            'Quantidade e valores fiscais devem ser positivos.',
          );
        }

        const calculado = quantidade
          .mul(unitario)
          .toDecimalPlaces(
            2,
            Prisma.Decimal.ROUND_HALF_UP,
          );

        if (!calculado.equals(total)) {
          throw new BadRequestException(
            'O item ' + (indice + 1) +
            ' possui divergencia entre quantidade, unitario e total.',
          );
        }

        soma = soma.plus(total);

        return {
          ...valor,
          descricaoNota: item.descricaoNota,
          quantidadeNota: item.quantidadeNota,
          unidadeNota: item.unidadeNota,
          valorUnitarioNota: item.valorUnitarioNota,
          valorTotalItemNota: item.valorTotalItemNota,
          valoresConferem: true,
        };
      });

      // Total declarado e conferido pelo usuario; nunca inferido da soma.
      const totalOriginal = revisao.valorTotalProdutos ?? extracao.valorTotalProdutos;

      if (
        typeof totalOriginal !== 'string' ||
        !/^\d{1,18}\.\d{2}$/.test(totalOriginal) ||
        !soma.equals(new Prisma.Decimal(totalOriginal))
      ) {
        throw new BadRequestException(
          'A soma revisada nao corresponde ao total dos produtos da nota.',
        );
      }

      // A extracao original fica preservada na primeira revisao.
      const originalOcr = extracao.extracaoOriginalOcr;

      if (
        originalOcr !== undefined &&
        (
          !originalOcr ||
          typeof originalOcr !== 'object' ||
          Array.isArray(originalOcr)
        )
      ) {
        throw new BadRequestException(
          'Historico original do OCR invalido.',
        );
      }

      const extracaoRevisada = {
        ...extracao,
        extracaoOriginalOcr: originalOcr ?? extracao,
        valorTotalProdutos: totalOriginal,
        emitidaEm: revisao.emitidaEm,
        itens: itensRevisados,
        somaItensExtraidos: soma.toFixed(2),
        revisaoFiscal: {
          status: 'VALIDADA',
          revisadaPorId: usuarioId,
          revisadaEm: new Date().toISOString(),
          justificativa: revisao.justificativa,
        },
        // Revisao manual nao autoriza entrada automatica.
        aptoParaConfirmacaoAutomatica: false,
      } as Prisma.InputJsonObject;

      const { count } = await tx.arquivoNotaCompra.updateMany({
        where: {
          id: arquivoId,
          empresaId,
          status: 'AGUARDANDO_CONFERENCIA',
          extracao: { equals: extracao },
        },
        data: { extracao: extracaoRevisada },
      });

      if (count !== 1) {
        throw new ConflictException(
          'A nota foi alterada durante a revisao. Recarregue os dados.',
        );
      }

      await this.auditoria.registrar({
        empresaId,
        atorId: usuarioId,
        tipoAtor: TipoAtorAuditoria.USUARIO_EMPRESA,
        modulo: 'COMPRAS',
        acao: 'REVISAR_NOTA_OCR',
        entidade: 'ARQUIVO_NOTA_COMPRA',
        entidadeId: arquivoId,
        resultado: ResultadoAuditoria.SUCESSO,
        justificativa: revisao.justificativa,
        dadosAnteriores: {
          emitidaEm: extracao.emitidaEm,
          valorTotalProdutos: extracao.valorTotalProdutos,
          itens: originais,
        },
        dadosPosteriores: {
          emitidaEm: revisao.emitidaEm,
          valorTotalProdutos: totalOriginal,
          itens: itensRevisados,
        },
        metadados: {
          quantidadeItens: itensRevisados.length,
          totalProdutos: soma.toFixed(2),
          origem: 'OCR_PILOTO',
        },
      }, tx);

      return {
        arquivoId,
        status: 'AGUARDANDO_CONFERENCIA',
        revisaoFiscal: 'VALIDADA',
        quantidadeItens: itensRevisados.length,
        totalProdutos: soma.toFixed(2),
      };
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      timeout: 30000,
    });
  }

  private async obterUnidadeDaNota(
    tx: Prisma.TransactionClient,
    empresaId: string,
    usuarioId: string,
    unidadeNota: string,
  ) {
    const codigos = codigosUnidadeEstoqueDaNota(unidadeNota);
    const unidades = await tx.unidade.findMany({
      where: { empresaId, codigo: { in: codigos } },
      select: { id: true, codigo: true, nome: true },
    });
    for (const codigo of codigos) {
      const existente = unidades.find((unidade) => unidade.codigo === codigo);
      if (existente) return existente;
    }

    const codigo = codigos[0];
    const dto = plainToInstance(CriarUnidadeDto, {
      codigo,
      nome: codigo === 'UN' ? 'Unidade' : codigo,
    });
    if ((await validate(dto)).length > 0) {
      throw new BadRequestException('A unidade da nota não pode ser cadastrada: ' + unidadeNota);
    }
    return criarUnidadeNaTransacao(tx, this.auditoria, empresaId, usuarioId, dto);
  }

  private async precificarProdutoPelaNota(
    tx: Prisma.TransactionClient,
    empresaId: string,
    categoriaId: string | null | undefined,
    valorTotal: string | undefined,
    quantidadeEstoque: number,
  ) {
    if (!valorTotal || !/^\d{1,18}\.\d{2}$/.test(valorTotal)) {
      throw new BadRequestException('A linha da nota não tem um valor total válido.');
    }

    const categoria = categoriaId
      ? await tx.categoria.findFirst({
          where: { id: categoriaId, empresaId },
          select: { percentualAcrescimo: true },
        })
      : null;
    if (categoriaId && !categoria) {
      throw new BadRequestException('A categoria informada não pertence à empresa.');
    }

    const percentual = categoria?.percentualAcrescimo ?? new Prisma.Decimal(43);

    // Custo interno preservado com seis casas decimais.
    const custo = new Prisma.Decimal(valorTotal)
      .div(new Prisma.Decimal(quantidadeEstoque.toString()))
      .toDecimalPlaces(6, Prisma.Decimal.ROUND_HALF_UP);

    // Preco de venda arredondado somente ao final.
    const preco = custo
      .mul(percentual.div(100).plus(1))
      .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

    if (custo.lte(0) || preco.gt('9999999999.99')) {
      throw new BadRequestException('O custo ou o preço calculado está fora do limite do cadastro.');
    }

    return { custo: custo.toNumber(), preco: preco.toNumber() };
  }

  private async confirmarCompra(
    empresaId: string,
    usuarioId: string,
    dto: DadosNotaCompraDto,
    itensSolicitados: ItemConfirmacao[],
    arquivoId?: string,
    extracaoAutomatica?: Prisma.JsonObject,
    destinatarioCnpjNota?: string,
    extracaoConferida?: Prisma.JsonObject,
  ) {
    const origem = arquivoId ? 'AGENTE_GC' : 'MANUAL';
    const numeroNota = dto.numeroNota.padStart(9, '0');
    if (numeroNota === '000000000') {
      throw new BadRequestException('Informe um número de nota maior que zero.');
    }

    const identidade = {
      empresaId,
      fornecedorCnpj: dto.fornecedorCnpj,
      serieNota: dto.serieNota.padStart(3, '0'),
      numeroNota,
    };

    try {
      return await this.prisma.$transaction(async (transacao) => {
        const usuario = await transacao.usuario.findFirst({
          where: {
            id: usuarioId, empresaId, ativo: true,
            ...(extracaoAutomatica ? { perfil: { in: ['ADMINISTRADOR', 'GERENTE'] } } : {}),
          },
          select: { nome: true },
        });
        if (!usuario) {
          throw new UnauthorizedException('Usuário ativo não encontrado na empresa.');
        }

        if (arquivoId) {
          const empresa = await transacao.empresa.findUnique({
            where: { id: empresaId },
            select: { cnpj: true, ativo: true },
          });
          const destinatario = destinatarioCnpjNota;
          if (!empresa?.ativo || typeof destinatario !== 'string' || !/^\d{14}$/.test(destinatario) ||
              empresa.cnpj?.replace(/\D/g, '') !== destinatario) {
            throw new BadRequestException('O CNPJ do destinatário não corresponde à empresa ativa configurada.');
          }
        }

        if (arquivoId) {
          const { count } = await transacao.arquivoNotaCompra.updateMany({
            where: {
              id: arquivoId, empresaId, status: 'AGUARDANDO_CONFERENCIA',
              ...(extracaoConferida
                ? { extracao: { equals: extracaoConferida } }
                : extracaoAutomatica
                  ? { extracao: { equals: extracaoAutomatica } }
                  : {}),
            },
            data: { status: 'PROCESSADO' },
          });
          if (count !== 1) {
            throw new ConflictException('O arquivo já foi processado ou saiu da conferência.');
          }
        }

        // A chave única do banco arbitra tentativas concorrentes.
        const recebimento = await transacao.recebimentoCompra.create({
          data: {
            ...identidade,
            fornecedorNome: dto.fornecedorNome,
            emitidaEm: dto.emitidaEm ? new Date(dto.emitidaEm + 'T00:00:00Z') : null,
            compradaEm: dto.compradaEm ? new Date(dto.compradaEm + 'T00:00:00Z') : null,
            origem,
            status: 'INCLUIDO',
            incluidoEm: new Date(),
            incluidoPorOrigem: extracaoAutomatica ? 'AGENTE_GC' : 'MANUAL',
            incluidoPorUsuarioId: usuarioId,
            incluidoPorNome: extracaoAutomatica ? 'Agente GC' : usuario.nome,
          },
        });

        const itens = [];
        for (const item of itensSolicitados) {
          if (extracaoAutomatica && item.produtoId && item.codigoFornecedor) {
            const vinculo = await transacao.vinculoProdutoFornecedorCompra.findUnique({
              where: { empresaId_fornecedorCnpj_codigoFornecedor: {
                empresaId, fornecedorCnpj: dto.fornecedorCnpj,
                codigoFornecedor: item.codigoFornecedor,
              } },
              select: { produtoId: true },
            });
            if (vinculo?.produtoId !== item.produtoId) {
              throw new ConflictException('O vínculo do produto mudou durante o processamento da nota.');
            }
          }

          let produtoId = item.produtoId;
          if (item.produtoNovo && item.conversao) {
            const unidade = await this.obterUnidadeDaNota(
              transacao, empresaId, usuarioId, item.conversao.unidadeNota,
            );
            const { custo, preco, ...cadastro } = item.produtoNovo;
            const valores = item.usarPrecoDaNota
              ? await this.precificarProdutoPelaNota(
                  transacao, empresaId, cadastro.categoriaId,
                  item.conversao.valorTotalItemNota, item.quantidadeRecebida,
                )
              : { custo, preco };
            if (typeof valores.custo !== 'number' || typeof valores.preco !== 'number') {
              throw new BadRequestException('Informe custo e preço ou use os valores da nota.');
            }

            const produto = await this.produtos.criar(empresaId, usuarioId, {
              ...cadastro,
              sku: `GC-${gerarUuidSkuNota().replace(/-/g, '').toUpperCase()}`,
              custo: valores.custo,
              preco: valores.preco,
              unidadeId: unidade.id,
              quantidadeInicial: 0,
            }, transacao);
            produtoId = produto?.id;
          }

          if (!produtoId) {
            throw new InternalServerErrorException('O produto da entrada não pôde ser identificado.');
          }

          // Registra o vínculo somente durante a confirmação da nota,
          // na mesma transação do produto e da entrada de estoque.
          if (arquivoId && item.codigoFornecedor) {
            const codigoFornecedor = item.codigoFornecedor.trim().toUpperCase();

            // Mantém a mesma regra de códigos aceita pela vinculação manual.
            if (/^[A-Z0-9]{1,64}$/.test(codigoFornecedor)) {
              const identidadeVinculo = {
                empresaId,
                fornecedorCnpj: dto.fornecedorCnpj,
                codigoFornecedor,
              };

              const anterior = await transacao.vinculoProdutoFornecedorCompra.findUnique({
                where: {
                  empresaId_fornecedorCnpj_codigoFornecedor: identidadeVinculo,
                },
                select: { produtoId: true },
              });

              if (anterior && anterior.produtoId !== produtoId) {
                throw new ConflictException(
                  'O código do fornecedor já está vinculado a outro produto.',
                );
              }

              if (!anterior) {
                const vinculo = await transacao.vinculoProdutoFornecedorCompra.create({
                  data: {
                    ...identidadeVinculo,
                    produtoId,
                  },
                });

                await this.auditoria.registrar({
                  empresaId,
                  ...(extracaoAutomatica ? {} : { atorId: usuarioId }),
                  tipoAtor: extracaoAutomatica
                    ? TipoAtorAuditoria.SISTEMA
                    : TipoAtorAuditoria.USUARIO_EMPRESA,
                  modulo: 'COMPRAS',
                  acao: 'VINCULAR_PRODUTO_FORNECEDOR',
                  entidade: 'VINCULO_PRODUTO_FORNECEDOR',
                  entidadeId: vinculo.id,
                  resultado: ResultadoAuditoria.SUCESSO,
                  metadados: {
                    arquivoNotaCompraId: arquivoId,
                    produtoId,
                  },
                }, transacao);
              }
            }
          }

          let quantidadeRecebida = item.quantidadeRecebida;
          if (item.conversao) {
            const produto = await transacao.produto.findFirst({
              where: { id: produtoId, empresaId, ativo: true },
              select: { unidadeId: true, perecivel: true },
            });
            if (extracaoAutomatica && produto?.perecivel) {
              throw new BadRequestException('Produto perecível exige conferência de validade.');
            }
            const unidade = produto?.unidadeId
              ? await transacao.unidade.findFirst({
                  where: { id: produto.unidadeId, empresaId },
                  select: { codigo: true },
                })
              : null;

            if (!unidade) {
              throw new BadRequestException(
                'Vincule um produto ativo da empresa com unidade de estoque cadastrada.',
              );
            }

            const { quantidadeNota, unidadeNota, fatorEmbalagem } = item.conversao;
            const calculada = calcularQuantidadeNota(
              quantidadeNota, unidadeNota, unidade.codigo, fatorEmbalagem,
            );
            if (calculada === null || calculada !== quantidadeRecebida) {
              throw new BadRequestException(
                'Confira a unidade, o fator de embalagem e a quantidade para ' +
                  item.descricaoNota + '.',
              );
            }
            quantidadeRecebida = calculada;
          }

          const movimento = await this.produtos.movimentarEstoque(
            empresaId,
            usuarioId,
            produtoId,
            {
              tipo: 'ENTRADA',
              quantidade: quantidadeRecebida,
              motivo: 'Recebimento de compra',
              referenciaId: recebimento.id,
              codigoLote: item.codigoLote,
              validadeEm: item.validadeEm,
            },
            transacao,
          );

          if (!movimento) {
            throw new InternalServerErrorException('A entrada de estoque não foi concluída.');
          }

          // Preserva os dados fiscais originais da compra.
          // O valor fiscal nao e reconstruido a partir do custo arredondado.
          const dadosFiscais = item.conversao;
          const valorTotalFiscal = dadosFiscais?.valorTotalItemNota;
          const valorUnitarioFiscal = dadosFiscais?.valorUnitarioNota;

          if (
            valorTotalFiscal !== undefined &&
            !/^\d{1,18}\.\d{2}$/.test(valorTotalFiscal)
          ) {
            throw new BadRequestException(
              'Valor total fiscal invalido para ' + item.descricaoNota + '.',
            );
          }

          if (
            valorUnitarioFiscal !== undefined &&
            !/^\d{1,18}(?:\.\d{1,10})?$/.test(valorUnitarioFiscal)
          ) {
            throw new BadRequestException(
              'Valor unitario fiscal invalido para ' + item.descricaoNota + '.',
            );
          }

          // Registra o custo historico no lote criado por esta entrada.
          // Nao altera o custo dos lotes anteriores.
          if (valorTotalFiscal !== undefined) {
            const quantidadeEstoque = new Prisma.Decimal(
              movimento.quantidade.toString(),
            );

            const custoAquisicao = new Prisma.Decimal(valorTotalFiscal)
              .div(quantidadeEstoque)
              .toDecimalPlaces(6, Prisma.Decimal.ROUND_HALF_UP);

            if (
              custoAquisicao.isNegative() ||
              custoAquisicao.gt('999999999999.999999')
            ) {
              throw new BadRequestException(
                'Custo de aquisicao fora do limite permitido.',
              );
            }

            const lotesDaEntrada =
              await transacao.movimentacaoLoteEstoque.findMany({
                where: {
                  empresaId,
                  produtoId: movimento.produtoId,
                  movimentacaoId: movimento.id,
                },
                select: {
                  loteId: true,
                  quantidade: true,
                },
              });

            if (
              lotesDaEntrada.length !== 1 ||
              !lotesDaEntrada[0].quantidade.equals(quantidadeEstoque)
            ) {
              throw new InternalServerErrorException(
                'Nao foi possivel identificar o lote desta entrada.',
              );
            }

            await transacao.loteEstoque.update({
              where: {
                empresaId_produtoId_id: {
                  empresaId,
                  produtoId: movimento.produtoId,
                  id: lotesDaEntrada[0].loteId,
                },
              },
              data: {
                custoUnitarioAquisicao: custoAquisicao,
              },
            });
          }

          itens.push(await transacao.itemRecebimentoCompra.create({
            data: {
              empresaId,
              recebimentoId: recebimento.id,
              produtoId: movimento.produtoId,
              movimentacaoId: movimento.id,
              descricaoNota: item.descricaoNota,
              quantidadeRecebida: movimento.quantidade,
              quantidadeNota: dadosFiscais
                ? new Prisma.Decimal(dadosFiscais.quantidadeNota)
                : null,
              unidadeNota: dadosFiscais?.unidadeNota ?? null,
              fatorEmbalagem: dadosFiscais?.fatorEmbalagem ?? null,
              valorUnitarioNota: valorUnitarioFiscal ?? null,
              valorTotalItemNota: valorTotalFiscal !== undefined
                ? new Prisma.Decimal(valorTotalFiscal)
                : null,
              codigoLote: item.codigoLote ?? null,
              validadeEm: item.validadeEm ? new Date(item.validadeEm + 'T00:00:00Z') : null,
            },
          }));
        }

        await this.auditoria.registrar({
          empresaId,
          ...(extracaoAutomatica ? {} : { atorId: usuarioId }),
          tipoAtor: extracaoAutomatica ? TipoAtorAuditoria.SISTEMA : TipoAtorAuditoria.USUARIO_EMPRESA,
          modulo: 'COMPRAS',
          acao: 'CONFIRMAR_RECEBIMENTO',
          entidade: 'RECEBIMENTO_COMPRA',
          entidadeId: recebimento.id,
          resultado: ResultadoAuditoria.SUCESSO,
          metadados: {
            origem,
            quantidadeItens: itens.length,
            ...(extracaoAutomatica ? { responsavelConfiguradoId: usuarioId } : {}),
            ...(arquivoId ? { arquivoNotaCompraId: arquivoId } : {}),
          },
        }, transacao);

        return { ...recebimento, itens };
      }, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        ...(arquivoId ? { timeout: 30000 } : {}),
      });
    } catch (erro) {
      if (erro instanceof Prisma.PrismaClientKnownRequestError) {
        if (
          erro.code === 'P2002' &&
          await this.prisma.recebimentoCompra.findFirst({
            where: identidade,
            select: { id: true },
          })
        ) {
          throw new ConflictException('Já existe um recebimento para esta nota na empresa.');
        }

        if (erro.code === 'P2034' || erro.code === 'P2002') {
          throw new ConflictException(
            'O estoque ou o recebimento foi alterado simultaneamente. Consulte os dados e tente novamente.',
          );
        }
      }
      throw erro;
    }
  }
}
