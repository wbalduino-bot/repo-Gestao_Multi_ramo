import { Transform } from 'class-transformer';
import {
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

/**
 * Unidades federativas brasileiras.
 *
 * Evita aceitar siglas inexistentes no endereço fiscal.
 */
const UFS_BRASIL = [
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF',
  'ES', 'GO', 'MA', 'MT', 'MS', 'MG',
  'PA', 'PB', 'PR', 'PE', 'PI', 'RJ',
  'RN', 'RS', 'RO', 'RR', 'SC', 'SP',
  'SE', 'TO',
];

/**
 * Normaliza textos opcionais recebidos do frontend.
 *
 * Um campo omitido não será alterado.
 * Um campo enviado como null ou vazio poderá ser limpo.
 */
function normalizarTexto(valor: unknown): unknown {
  if (typeof valor !== 'string') {
    return valor;
  }

  const texto = valor.trim();
  return texto.length > 0 ? texto : null;
}

/**
 * Dados cadastrais fiscais editáveis pelo administrador
 * ou gerente da empresa.
 *
 * Este DTO realiza somente validações cadastrais iniciais.
 * A validação fiscal completa será realizada no serviço
 * específico antes de habilitar qualquer emissão.
 *
 * O empresaId não pode ser escolhido pelo frontend.
 */
export class AtualizarConfiguracaoFiscalDto {
  @IsOptional()
  @Transform(({ value }) => normalizarTexto(value))
  @IsString()
  @MaxLength(150)
  razaoSocial?: string | null;

  @IsOptional()
  @Transform(({ value }) => normalizarTexto(value))
  @IsString()
  @MaxLength(150)
  nomeFantasia?: string | null;

  @IsOptional()
  @Transform(({ value }) => normalizarTexto(value))
  @IsString()
  @MaxLength(20)
  inscricaoEstadual?: string | null;

  // O formato inicial não comprova validade tributária do CRT.
  @IsOptional()
  @Transform(({ value }) => normalizarTexto(value))
  @IsString()
  @Matches(/^\d{1,2}$/)
  codigoCRT?: string | null;

  @IsOptional()
  @Transform(({ value }) => normalizarTexto(value))
  @IsString()
  @MaxLength(150)
  logradouro?: string | null;

  @IsOptional()
  @Transform(({ value }) => normalizarTexto(value))
  @IsString()
  @MaxLength(20)
  numero?: string | null;

  @IsOptional()
  @Transform(({ value }) => normalizarTexto(value))
  @IsString()
  @MaxLength(100)
  complemento?: string | null;

  @IsOptional()
  @Transform(({ value }) => normalizarTexto(value))
  @IsString()
  @MaxLength(100)
  bairro?: string | null;

  // O código deve corresponder a um município real do IBGE.
  // Essa conferência será implementada posteriormente.
  @IsOptional()
  @Transform(({ value }) => normalizarTexto(value))
  @IsString()
  @Matches(/^\d{7}$/)
  codigoMunicipio?: string | null;

  @IsOptional()
  @Transform(({ value }) => normalizarTexto(value))
  @IsString()
  @MaxLength(100)
  nomeMunicipio?: string | null;

  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string'
      ? normalizarTexto(value.toUpperCase())
      : value,
  )
  @IsString()
  @IsIn(UFS_BRASIL)
  uf?: string | null;

  @IsOptional()
  @Transform(({ value }) => normalizarTexto(value))
  @IsString()
  @Matches(/^\d{8}$/)
  cep?: string | null;
}
