import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ResultadoAuditoria } from '@prisma/client';

/**
 * Filtros permitidos ao administrador SaaS.
 * Não aceita empresaId nem autoriza consulta de eventos operacionais privados.
 * Datas devem conter fuso horário explícito, em ISO 8601.
 */
export class ListarAuditoriaPlataformaDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pagina?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limite?: number;

  @IsOptional()
  @IsISO8601({ strict: true })
  inicio?: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  fim?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  @Matches(/^[A-Z0-9_]+$/)
  modulo?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Matches(/^[A-Z0-9_]+$/)
  acao?: string;

  @IsOptional()
  @IsEnum(ResultadoAuditoria)
  resultado?: ResultadoAuditoria;
}
