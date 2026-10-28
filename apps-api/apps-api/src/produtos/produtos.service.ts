import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service.js';
import { CriarProdutoDto } from './dto/criar-produto.dto.js';
import { AtualizarProdutoDto } from './dto/atualizar-produto.dto.js';
import { ListarProdutosDto } from './dto/listar-produtos.dto.js';

/**
 * Serviço responsável pelas regras de negócio dos produtos.
 *
 * REGRA DE SEGURANÇA:
 * O empresaId deve ser recebido pelo controller a partir da
 * identidade validada pelo JwtAuthGuard. Não deve ser extraído
 * livremente do corpo da requisição enviada pelo cliente.
 */
@Injectable()
export class ProdutosService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Cadastra um produto vinculado à empresa autenticada.
   *
   * Antes de gravar, confirma que categoria e unidade, quando
   * informadas, pertencem à mesma empresa.
   */
  async criar(empresaId: string, dto: CriarProdutoDto) {
    await this.validarCategoriaEUnidade(
      empresaId,
      dto.categoriaId,
      dto.unidadeId,
    );

    try {
      return await this.prisma.produto.create({
        data: {
          // O vínculo empresarial vem da autenticação.
          empresaId,

          nome: dto.nome.trim(),
          sku: dto.sku.trim().toUpperCase(),

          descricao: dto.descricao?.trim() || null,
          categoriaId: dto.categoriaId ?? null,
          unidadeId: dto.unidadeId ?? null,
          codigoBarras: dto.codigoBarras?.trim() || null,

          preco: dto.preco,
          custo: dto.custo,
          perecivel: dto.perecivel ?? false,
          peso: dto.peso ?? null,
        },
      });
    } catch (erro) {
      this.tratarErroPrisma(erro);
    }
  }

  /**
   * Lista produtos exclusivamente da empresa autenticada.
   * Permite filtrar por situação, pesquisar e paginar resultados.
   */
  async listar(empresaId: string, filtros: ListarProdutosDto) {
    const pagina = filtros.pagina ?? 1;
    const limite = filtros.limite ?? 20;

    // Todas as consultas começam limitadas à empresa autenticada.
    const where: Prisma.ProdutoWhereInput = {
      empresaId,
    };

    if (filtros.ativo !== undefined) {
      where.ativo = filtros.ativo;
    }

    const busca = filtros.busca?.trim();

    // A pesquisa considera nome, SKU e código de barras.
    if (busca) {
      where.OR = [
        {
          nome: {
            contains: busca,
            mode: 'insensitive',
          },
        },
        {
          sku: {
            contains: busca,
            mode: 'insensitive',
          },
        },
        {
          codigoBarras: {
            contains: busca,
            mode: 'insensitive',
          },
        },
      ];
    }

    // Consulta os registros da página e a contagem total.
    const [dados, total] = await this.prisma.$transaction([
      this.prisma.produto.findMany({
        where,
        orderBy: {
          nome: 'asc',
        },
        skip: (pagina - 1) * limite,
        take: limite,
      }),

      this.prisma.produto.count({
        where,
      }),
    ]);

    return {
      dados,
      total,
      pagina,
      limite,
      totalPaginas: Math.ceil(total / limite),
    };
  }

  /**
   * Busca um produto pelo ID dentro da empresa autenticada.
   * Um produto de outra empresa não é tratado como acessível.
   */
  async buscarPorId(empresaId: string, id: string) {
    const produto = await this.prisma.produto.findFirst({
      where: {
        id,
        empresaId,
      },
    });

    if (!produto) {
      throw new NotFoundException('Produto não encontrado.');
    }

    return produto;
  }

  /**
   * Atualiza somente os campos enviados pelo cliente.
   *
   * A existência do produto é verificada dentro da empresa antes
   * de validar as referências e executar a atualização.
   */
  async atualizar(
    empresaId: string,
    id: string,
    dto: AtualizarProdutoDto,
  ) {
    // Evita atualizações vazias, sem nenhum campo informado.
    const recebeuCampo = [
      dto.nome,
      dto.sku,
      dto.descricao,
      dto.categoriaId,
      dto.unidadeId,
      dto.codigoBarras,
      dto.preco,
      dto.custo,
      dto.perecivel,
      dto.peso,
    ].some((valor) => valor !== undefined);

    if (!recebeuCampo) {
      throw new BadRequestException(
        'Informe ao menos um campo para atualizar.',
      );
    }

    // Primeiro confirma que o produto pertence à empresa.
    await this.buscarPorId(empresaId, id);

    await this.validarCategoriaEUnidade(
      empresaId,
      dto.categoriaId,
      dto.unidadeId,
    );

    // Utiliza o tipo unchecked para atualizar os campos escalares
    // e as referências UUID mantidas diretamente no schema atual.
    const data: Prisma.ProdutoUncheckedUpdateInput = {};

    if (dto.nome !== undefined) {
      data.nome = dto.nome.trim();
    }

    if (dto.sku !== undefined) {
      data.sku = dto.sku.trim().toUpperCase();
    }

    if (dto.descricao !== undefined) {
      data.descricao = dto.descricao?.trim() || null;
    }

    if (dto.categoriaId !== undefined) {
      data.categoriaId = dto.categoriaId ?? null;
    }

    if (dto.unidadeId !== undefined) {
      data.unidadeId = dto.unidadeId ?? null;
    }

    if (dto.codigoBarras !== undefined) {
      data.codigoBarras = dto.codigoBarras?.trim() || null;
    }

    if (dto.preco !== undefined) {
      data.preco = dto.preco;
    }

    if (dto.custo !== undefined) {
      data.custo = dto.custo;
    }

    if (dto.perecivel !== undefined) {
      data.perecivel = dto.perecivel;
    }

    if (dto.peso !== undefined) {
      data.peso = dto.peso ?? null;
    }

    try {
      // O filtro composto mantém o vínculo empresarial na escrita.
      return await this.prisma.produto.update({
        where: {
          empresaId_id: {
            empresaId,
            id,
          },
        },
        data,
      });
    } catch (erro) {
      this.tratarErroPrisma(erro);
    }
  }

  /**
   * Ativa ou desativa um produto sem permitir alterar
   * um registro pertencente a outra empresa.
   */
  async alterarAtivacao(
    empresaId: string,
    id: string,
    ativo: boolean,
  ) {
    try {
      return await this.prisma.produto.update({
        where: {
          empresaId_id: {
            empresaId,
            id,
          },
        },
        data: {
          ativo,
        },
      });
    } catch (erro) {
      this.tratarErroPrisma(erro);
    }
  }

  /**
   * Valida as referências de categoria e unidade.
   *
   * O schema atual mantém categoriaId e unidadeId no modelo
   * Produto sem relações Prisma declaradas para esses modelos.
   * Por isso, a verificação é feita explicitamente pelo serviço.
   *
   * Valores nulos permitem remover uma referência existente.
   */
  private async validarCategoriaEUnidade(
    empresaId: string,
    categoriaId?: string | null,
    unidadeId?: string | null,
  ): Promise<void> {
    if (categoriaId != null) {
      const categoria = await this.prisma.categoria.findFirst({
        where: {
          id: categoriaId,
          empresaId,
        },
        select: {
          id: true,
        },
      });

      if (!categoria) {
        throw new BadRequestException(
          'Categoria inválida ou não pertence à empresa autenticada.',
        );
      }
    }

    if (unidadeId != null) {
      const unidade = await this.prisma.unidade.findFirst({
        where: {
          id: unidadeId,
          empresaId,
        },
        select: {
          id: true,
        },
      });

      if (!unidade) {
        throw new BadRequestException(
          'Unidade inválida ou não pertence à empresa autenticada.',
        );
      }
    }
  }

  /**
   * Converte erros conhecidos do Prisma em erros HTTP apropriados.
   * Outros erros são propagados para que possam ser diagnosticados.
   */
  private tratarErroPrisma(erro: unknown): never {
    if (
      erro instanceof Prisma.PrismaClientKnownRequestError &&
      erro.code === 'P2002'
    ) {
      throw new ConflictException(
        'Já existe um produto com este SKU na empresa.',
      );
    }

    if (
      erro instanceof Prisma.PrismaClientKnownRequestError &&
      erro.code === 'P2025'
    ) {
      throw new NotFoundException('Produto não encontrado.');
    }

    throw erro;
  }
}
