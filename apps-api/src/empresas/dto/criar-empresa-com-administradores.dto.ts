import { Type, Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEmail,
  IsNotEmpty,
  IsObject,
  IsString,
  MaxLength,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

import {
  AtualizarConfiguracaoFiscalDto,
} from '../../configuracao-fiscal/dto/atualizar-configuracao-fiscal.dto.js';

/**
 * Credenciais iniciais de um administrador empresarial.
 * O ID da empresa e o perfil não são enviados pelo cliente.
 */
export class AdministradorEmpresaInicialDto {
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString()
  @MinLength(3)
  @MaxLength(120)
  nome!: string;

  @Transform(({ value }) => typeof value === 'string' ? value.trim().toLowerCase() : value)
  @IsEmail()
  @MaxLength(160)
  email!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  senha!: string;
}

/**
 * Cadastro conjunto: uma empresa e pelo menos um administrador.
 * A validação aninhada impede que administradores inválidos prossigam.
 */
export class CriarEmpresaComAdministradoresDto {
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  nome!: string;

  @Transform(({ value }) => typeof value === 'string' ? value.trim().toUpperCase() : value)
  @IsString()
  @IsNotEmpty()
  @MaxLength(18)
  cnpj!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => AdministradorEmpresaInicialDto)
  administradores!: AdministradorEmpresaInicialDto[];

  // A configuração fiscal inicial é opcional. Quando enviada, deve ser um objeto.
  @ValidateIf((_objeto, valor: unknown) => valor !== undefined)
  @IsObject()
  @ValidateNested()
  @Type(() => AtualizarConfiguracaoFiscalDto)
  configuracaoFiscal?: AtualizarConfiguracaoFiscalDto;
}
