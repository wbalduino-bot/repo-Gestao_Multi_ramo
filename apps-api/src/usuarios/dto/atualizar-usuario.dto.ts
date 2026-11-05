
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
 * Campos permitidos para atualização de um usuário.
 *
 * A alteração de ativação possui endpoint e DTO próprios.
 * O empresaId nunca é recebido do frontend.
 */
export class AtualizarUsuarioDto {
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(120)
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  nome?: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(160)
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  email?: string;

  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  senha?: string;

  @IsOptional()
  @IsEnum(PerfilAcesso)
  perfil?: PerfilAcesso;
}
