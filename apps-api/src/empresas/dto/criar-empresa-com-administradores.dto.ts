import { Type, Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEmail,
  IsNotEmpty,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

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
}
