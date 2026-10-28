
import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  Max,
  Min,
} from 'class-validator';

/**
 * Parâmetros utilizados para consultar o histórico
 * de movimentações de estoque de um produto.
 *
 * A paginação evita retornar todo o histórico em uma única
 * requisição e limita o volume de dados consultados.
 */
export class ListarMovimentacoesEstoqueDto {
  // Página solicitada; a primeira página é usada por padrão.
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pagina = 1;

  // Quantidade máxima de registros por página.
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limite = 20;
}
