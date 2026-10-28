import { Transform } from 'class-transformer';

import {
  IsIn,
  IsInt,
  IsOptional,
  Max,
  Min,
} from 'class-validator';

/**
 * Filtros permitidos na listagem de vendas.
 *
 * A paginação limita o volume de dados retornados.
 * A forma de pagamento permite filtrar as operações.
 */
export class ListarVendasDto {
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
  @IsIn([
    'DINHEIRO',
    'PIX',
    'CARTAO_DEBITO',
    'CARTAO_CREDITO',
    'OUTRO',
  ])
  formaPagamento?:
    | 'DINHEIRO'
    | 'PIX'
    | 'CARTAO_DEBITO'
    | 'CARTAO_CREDITO'
    | 'OUTRO';
}