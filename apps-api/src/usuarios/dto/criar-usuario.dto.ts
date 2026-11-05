
import {
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

import { Transform } from 'class-transformer';

import { PerfilAcesso } from '@prisma/client';

/**
 * Dados necessários para cadastrar um usuário na empresa.
 *
 * O empresaId não é recebido pelo DTO:
 * o backend identifica a empresa pelo JWT do usuário autenticado.
 */
export class CriarUsuarioDto {
  @IsString()
  @MinLength(3)
  @MaxLength(120)
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  nome!: string;

  @IsEmail()
  @MaxLength(160)
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  email!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  senha!: string;

  @IsOptional()
  @IsEnum(PerfilAcesso)
  perfil?: PerfilAcesso;
}
