import { Transform } from 'class-transformer';
import { IsNumber, Max, Min, ValidateIf, IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

/** Entrada de cadastro; a empresa é identificada exclusivamente pelo JWT. */
export class CriarCategoriaDto {
  @ValidateIf((_objeto, valor: unknown) => valor !== undefined)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(10000)
  percentualAcrescimo?: number;

  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  nome!: string;

  @IsOptional()
  @IsUUID()
  categoriaPaiId?: string | null;
}
