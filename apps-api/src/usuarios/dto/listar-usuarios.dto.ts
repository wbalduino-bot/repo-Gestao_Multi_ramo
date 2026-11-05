
import { Transform, Type } from 'class-transformer';

import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import { PerfilAcesso } from '@prisma/client';

/**
 * Filtros para consulta de usuários da empresa autenticada.
 * A paginação e os filtros são validados antes de chegar ao serviço.
 */
export class ListarUsuariosDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pagina?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limite?: number;

  @IsOptional()
  @Transform(({ value }) => {
    if (value === 'true') return true;
    if (value === 'false') return false;
    return value;
  })
  @IsBoolean()
  ativo?: boolean;

  @IsOptional()
  @IsEnum(PerfilAcesso)
  perfil?: PerfilAcesso;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  busca?: string;
}
