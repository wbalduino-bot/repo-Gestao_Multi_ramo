
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * Valida os dados necessários para cadastrar um produto.
 *
 * O empresaId não faz parte deste DTO: ele será obtido
 * exclusivamente do usuário autenticado.
 */
export class CriarProdutoDto {
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  nome!: string;

  // Padroniza o SKU para evitar diferenças causadas por maiúsculas.
  @Transform(({ value }) =>
    typeof value === 'string'
      ? value.trim().toUpperCase()
      : value,
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  sku!: string;

  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MaxLength(1000)
  descricao?: string | null;

  @IsOptional()
  @IsUUID()
  categoriaId?: string | null;

  @IsOptional()
  @IsUUID()
  unidadeId?: string | null;

  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MaxLength(100)
  codigoBarras?: string | null;

  // Converte o valor recebido para número e rejeita valores inválidos.
  @Transform(({ value }) => {
    if (value === undefined) return undefined;
    if (value === null || value === '') return Number.NaN;
    return Number(value);
  })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  preco!: number;

  @Transform(({ value }) => {
    if (value === undefined) return undefined;
    if (value === null || value === '') return Number.NaN;
    return Number(value);
  })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  custo!: number;

  @IsOptional()
  @IsBoolean()
  perecivel?: boolean;

  @IsOptional()
  @Transform(({ value }) => {
    if (
      value === undefined ||
      value === null ||
      value === ''
    ) {
      return value;
    }

    return Number(value);
  })
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  peso?: number | null;

    /**
   * Quantidade disponível no momento do cadastro.
   *
   * É opcional para manter compatibilidade com clientes antigos.
   * Quando não for informada, o serviço utilizará zero.
   */
  @IsOptional()
  @Transform(({ value }) => {
    if (value === undefined) return undefined;
    if (value === null || value === '') return Number.NaN;

    return Number(value);
  })
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  quantidadeInicial?: number;

  /**
   * Quantidade mínima desejada para o estoque.
   *
   * Quando não informada, o serviço utilizará zero.
   * O limite será salvo no registro de SaldoEstoque.
   */
  @IsOptional()
  @Transform(({ value }) => {
    if (value === undefined) return undefined;
    if (value === null || value === '') return Number.NaN;

    return Number(value);
  })
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  estoqueMinimo?: number;
}
