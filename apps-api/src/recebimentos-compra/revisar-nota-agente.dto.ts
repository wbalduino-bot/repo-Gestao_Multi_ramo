import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsInt,
  IsOptional,
  IsNotEmpty,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

function aparar({ value }: { value: unknown }) {
  return typeof value === 'string'
    ? value.trim()
    : value;
}

function normalizarUnidade({ value }: { value: unknown }) {
  return typeof value === 'string'
    ? value.trim().toUpperCase()
    : value;
}

/**
 * Item revisado por usuario autenticado.
 *
 * Os campos fiscais devem ser informados integralmente.
 * A API devera comparar os itens com a extracao original
 * e validar matematicamente quantidade, unitario e total.
 */
export class ItemRevisaoNotaAgenteDto {
  @IsInt()
  @Min(0)
  @Max(99)
  indiceNota!: number;

  @Transform(aparar)
  @IsString()
  @IsNotEmpty()
  @MaxLength(250)
  descricaoNota!: string;

  @Transform(aparar)
  @Matches(/^\d{1,11}(?:\.\d{1,3})?$/)
  quantidadeNota!: string;

  @Transform(normalizarUnidade)
  @Matches(/^[A-Z0-9]{1,6}$/)
  unidadeNota!: string;

  @Transform(aparar)
  @Matches(/^\d{1,12}\.\d{1,6}$/)
  valorUnitarioNota!: string;

  @Transform(aparar)
  @Matches(/^\d{1,18}\.\d{2}$/)
  valorTotalItemNota!: string;
}

/**
 * Revisao manual de uma nota extraida pelo Agente GC.
 *
 * Nao recebe empresaId, usuarioId ou CNPJ destinatario.
 * Esses dados serao obtidos e validados no backend.
 *
 * Salvar revisao nao confirma recebimento nem altera estoque.
 */
export class RevisarNotaAgenteDto {
  // Opcional para clientes anteriores; se ausente, exige total OCR valido.
  @IsOptional()
  @Transform(aparar)
  @IsString()
  @Matches(/^\d{1,18}\.\d{2}$/)
  valorTotalProdutos?: string;

  @Matches(/^(?!0000)\d{4}-\d{2}-\d{2}$/)
  @IsDateString({ strict: true })
  emitidaEm!: string;

  @Transform(aparar)
  @IsString()
  @MinLength(10)
  @MaxLength(500)
  justificativa!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => ItemRevisaoNotaAgenteDto)
  itens!: ItemRevisaoNotaAgenteDto[];
}
