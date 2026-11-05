
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/** Filtros aceitos na listagem dos produtos. */
export class ListarProdutosDto {
  @IsOptional()
  @Transform(({ value }) =>
    value === undefined ? undefined : Number(value),
  )
  @IsInt()
  @Min(1)
  pagina = 1;

  @IsOptional()
  @Transform(({ value }) =>
    value === undefined ? undefined : Number(value),
  )
  @IsInt()
  @Min(1)
  @Max(100)
  limite = 20;

  @IsOptional()
  @Transform(({ value }) => {
    if (value === 'true') return true;
    if (value === 'false') return false;
    return value;
  })
  @IsBoolean()
  ativo?: boolean;

  /**
   * Filtra produtos vinculados diretamente a uma categoria.
   * A propriedade da categoria será verificada pelo serviço.
   */
  @IsOptional()
  @IsUUID()
  categoriaId?: string;

  /**
   * Estado do estoque utilizado para filtrar o catálogo.
   *
   * TODOS mantém a listagem completa.
   * SEM_SALDO identifica produtos sem registro de saldo inicializado.
   */
  @IsOptional()
  @IsIn([
    'TODOS',
    'NORMAL',
    'CRITICO',
    'SEM_ESTOQUE',
    'SEM_SALDO',
  ])
  estadoEstoque?:
    | 'TODOS'
    | 'NORMAL'
    | 'CRITICO'
    | 'SEM_ESTOQUE'
    | 'SEM_SALDO';

  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MaxLength(100)
  busca?: string;
}
