import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
} from '@nestjs/common';

import {
  Prisma,
  ResultadoAuditoria,
  TipoAtorAuditoria,
} from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service.js';
import {
  AuditoriaService,
  type RegistrarEventoAuditoriaInput,
} from '../auditoria/auditoria.service.js';

import { AtualizarConfiguracaoFiscalDto } from './dto/atualizar-configuracao-fiscal.dto.js';

/**
 * Lista explícita dos campos cadastrais que podem ser alterados.
 *
 * Não inclui empresaId, id ou datas de controle.
 * Isso impede que propriedades adicionais recebidas pelo serviço
 * sejam utilizadas diretamente na persistência.
 */
const CAMPOS_FISCAIS = [
  'razaoSocial',
  'nomeFantasia',
  'inscricaoEstadual',
  'codigoCRT',
  'logradouro',
  'numero',
  'complemento',
  'bairro',
  'codigoMunicipio',
  'nomeMunicipio',
  'uf',
  'cep',
] as const satisfies readonly (keyof AtualizarConfiguracaoFiscalDto)[];

type CampoFiscal = (typeof CAMPOS_FISCAIS)[number];

@Injectable()
export class ConfiguracaoFiscalService {
  private readonly logger = new Logger(
    ConfiguracaoFiscalService.name,
  );

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditoria: AuditoriaService,
  ) {}

  /**
   * Consulta a configuração fiscal da empresa autenticada.
   *
   * Retorna null quando a empresa ainda não possui cadastro fiscal.
   * O identificador da empresa deve vir do JWT validado.
   *
   * A consulta é auditada antes de retornar os dados.
   */
  async consultar(
    empresaId: string,
    atorId: string,
  ) {
    const configuracao =
      await this.prisma.configuracaoFiscalEmpresa.findUnique({
        where: {
          empresaId,
        },
      });

    await this.auditoria.registrar({
      empresaId,
      atorId,
      tipoAtor: TipoAtorAuditoria.USUARIO_EMPRESA,
      modulo: 'CONFIGURACAO_FISCAL',
      acao: 'CONSULTAR',
      entidade: 'CONFIGURACAO_FISCAL_EMPRESA',
      ...(configuracao
        ? { entidadeId: configuracao.id }
        : {}),
      resultado: ResultadoAuditoria.SUCESSO,
      metadados: {
        configuracaoExistente: configuracao !== null,
      },
    });

    return configuracao;
  }

  /**
   * Cria ou atualiza os dados fiscais da empresa.
   *
   * Uma empresa possui no máximo uma configuração fiscal.
   *
   * Campos omitidos permanecem inalterados.
   * Campos explicitamente enviados como null são limpos.
   *
   * Persistência e auditoria de sucesso utilizam a mesma
   * transação Serializable para garantir atomicidade.
   */
  async salvar(
    empresaId: string,
    atorId: string,
    dto: AtualizarConfiguracaoFiscalDto,
  ) {
    const dados: Partial<
      Record<CampoFiscal, string | null>
    > = {};

    /**
     * Copia somente os campos explicitamente autorizados.
     *
     * A validação HTTP é realizada pelo ValidationPipe,
     * enquanto esta lista protege a camada de persistência.
     */
    for (const campo of CAMPOS_FISCAIS) {
      const valor = dto[campo];

      if (valor !== undefined) {
        dados[campo] = valor;
      }
    }

    const camposInformados = Object.keys(dados);

    if (camposInformados.length === 0) {
      throw new BadRequestException(
        'Informe pelo menos um campo fiscal para salvar.',
      );
    }

    let acaoAuditoria = 'ATUALIZAR';

    try {
      return await this.prisma.$transaction(
        async (transacao) => {
          /**
           * Localiza o cadastro somente pela empresa autenticada.
           * A restrição UNIQUE do banco oferece proteção adicional.
           */
          const anterior =
            await transacao.configuracaoFiscalEmpresa.findUnique({
              where: {
                empresaId,
              },
            });

          acaoAuditoria = anterior ? 'ATUALIZAR' : 'CRIAR';

          /**
           * Se o cadastro já existe, atualiza somente os campos
           * informados. Caso contrário, cria o primeiro registro.
           */
          const configuracao = anterior
            ? await transacao.configuracaoFiscalEmpresa.update({
                where: {
                  empresaId,
                },
                data: dados,
              })
            : await transacao.configuracaoFiscalEmpresa.create({
                data: {
                  empresaId,
                  ...dados,
                },
              });

          /**
           * Não registra valores cadastrais completos na auditoria.
           *
           * Preserva somente os nomes dos campos informados e a
           * identificação do cadastro alterado.
           *
           * O segundo argumento associa a auditoria à transação.
           */
          await this.auditoria.registrar(
            {
              empresaId,
              atorId,
              tipoAtor: TipoAtorAuditoria.USUARIO_EMPRESA,
              modulo: 'CONFIGURACAO_FISCAL',
              acao: acaoAuditoria,
              entidade: 'CONFIGURACAO_FISCAL_EMPRESA',
              entidadeId: configuracao.id,
              resultado: ResultadoAuditoria.SUCESSO,
              metadados: {
                camposInformados,
              },
            },
            transacao,
          );

          return configuracao;
        },
        {
          isolationLevel:
            Prisma.TransactionIsolationLevel.Serializable,
        },
      );
    } catch (erro) {
      /**
       * A transação original já foi revertida.
       *
       * Tenta registrar a falha separadamente, sem permitir que
       * um problema secundário esconda o erro principal.
       */
      await this.registrarFalhaAuditoria({
        empresaId,
        atorId,
        modulo: 'CONFIGURACAO_FISCAL',
        acao: acaoAuditoria,
        entidade: 'CONFIGURACAO_FISCAL_EMPRESA',
        motivo:
          erro instanceof Error
            ? erro.constructor.name
            : 'ERRO_DESCONHECIDO',
      });

      this.tratarErroPrisma(erro);
    }
  }

  /**
   * Registra falhas sem substituir o erro que originou
   * a tentativa de operação.
   */
  private async registrarFalhaAuditoria(
    entrada: Omit<
      RegistrarEventoAuditoriaInput,
      'tipoAtor' | 'resultado'
    >,
  ): Promise<void> {
    try {
      await this.auditoria.registrar({
        ...entrada,
        tipoAtor: TipoAtorAuditoria.USUARIO_EMPRESA,
        resultado: ResultadoAuditoria.FALHA,
      });
    } catch {
      // Não registra objetos de erro que possam conter dados fiscais.
      this.logger.error(
        'Não foi possível registrar a falha na auditoria fiscal.',
      );
    }
  }

  /**
   * Traduz erros conhecidos do Prisma em respostas de negócio.
   *
   * P2002: duas requisições tentaram criar o mesmo cadastro.
   * P2034: conflito de concorrência ou transação.
   *
   * Outros erros são preservados para tratamento centralizado.
   */
  private tratarErroPrisma(erro: unknown): never {
    if (
      erro instanceof Prisma.PrismaClientKnownRequestError &&
      erro.code === 'P2002'
    ) {
      throw new ConflictException(
        'A configuração fiscal já foi cadastrada simultaneamente. Atualize os dados e tente novamente.',
      );
    }

    if (
      erro instanceof Prisma.PrismaClientKnownRequestError &&
      erro.code === 'P2034'
    ) {
      throw new ConflictException(
        'A configuração fiscal foi alterada simultaneamente. Atualize os dados e tente novamente.',
      );
    }

    throw erro;
  }
}
