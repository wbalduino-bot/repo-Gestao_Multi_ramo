import { Transform } from 'class-transformer';
import { IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength, ValidateIf } from 'class-validator';

/** Permite atualizar nome e/ou categoria-pai; nunca aceita empresaId. */
export class EditarCategoriaDto {
  @ValidateIf((_obj, valor) => valor !== undefined)
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  nome?: string;

  // Null remove o vínculo com a categoria-pai, tornando-a principal.
  @IsOptional()
  @IsUUID()
  categoriaPaiId?: string | null;
}
