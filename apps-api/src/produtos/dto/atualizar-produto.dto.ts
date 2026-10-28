
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

/**
 * Dados permitidos para atualizar um produto.
 *
 * O DTO não aceita empresaId nem permite alterar o vínculo
 * empresarial estabelecido durante o cadastro.
 */
export class AtualizarProdutoDto {
  @ValidateIf((_obj, value) => value !== undefined)
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  nome?: string;

  @ValidateIf((_obj, value) => value !== undefined)
  @Transform(({ value }) =>
    typeof value === 'string'
      ? value.trim().toUpperCase()
      : value,
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  sku?: string;

  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MaxLength(1000)
  descricao?: string | null;

  @IsOptional()
  @IsUUID()
  categoriaId?: string | null;

  @IsOptional()
  @IsUUID()
  unidadeId?: string | null;

  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MaxLength(100)
  codigoBarras?: string | null;

  @ValidateIf((_obj, value) => value !== undefined)
  @Transform(({ value }) => {
    if (value === null || value === '') return Number.NaN;
    return Number(value);
  })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  preco?: number;

  @ValidateIf((_obj, value) => value !== undefined)
  @Transform(({ value }) => {
    if (value === null || value === '') return Number.NaN;
    return Number(value);
  })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  custo?: number;

  @IsOptional()
  @IsBoolean()
  perecivel?: boolean;

  @IsOptional()
  @Transform(({ value }) => {
    if (
      value === undefined ||
      value === null ||
      value === ''
    ) {
      return value;
    }

    return Number(value);
  })
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  peso?: number | null;
}
