import { Transform } from 'class-transformer';
import { IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

/** Entrada de cadastro; a empresa é identificada exclusivamente pelo JWT. */
export class CriarCategoriaDto {
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  nome!: string;

  @IsOptional()
  @IsUUID()
  categoriaPaiId?: string | null;
}
