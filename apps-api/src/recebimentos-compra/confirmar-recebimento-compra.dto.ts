import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsDateString, IsNotEmpty,
  IsNumber, IsOptional, IsString, IsUUID, Matches, Max, MaxLength,
  Min, ValidateNested,
} from 'class-validator';

function aparar({ value }: { value: unknown }) {
  return typeof value === 'string' ? value.trim() : value;
}

export class DadosEntradaCompraDto {
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0.001)
  @Max(99999999999.999)
  quantidadeRecebida!: number;

  @IsOptional()
  @Transform(aparar)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  codigoLote?: string;

  @IsOptional()
  @Matches(/^(?!0000)\d{4}-\d{2}-\d{2}$/)
  @IsDateString({ strict: true })
  validadeEm?: string;
}

class ItemRecebimentoDto extends DadosEntradaCompraDto {
  @IsUUID()
  produtoId!: string;

  @Transform(aparar)
  @IsString()
  @IsNotEmpty()
  @MaxLength(250)
  descricaoNota!: string;
}

export class DadosNotaCompraDto {
  @Transform(aparar)
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  fornecedorNome!: string;

  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string'
      ? value.trim().toUpperCase().replace(/[./-]/g, '')
      : value,
  )
  @Matches(/^[A-Z0-9]{12}\d{2}$/)
  fornecedorCnpj!: string;

  @Transform(aparar)
  @Matches(/^\d{1,3}$/)
  serieNota!: string;

  @Transform(aparar)
  @Matches(/^\d{1,9}$/)
  numeroNota!: string;

  @IsOptional()
  @Matches(/^(?!0000)\d{4}-\d{2}-\d{2}$/)
  @IsDateString({ strict: true })
  emitidaEm?: string;

  @IsOptional()
  @Matches(/^(?!0000)\d{4}-\d{2}-\d{2}$/)
  @IsDateString({ strict: true })
  compradaEm?: string;
}

export class ConfirmarRecebimentoCompraDto extends DadosNotaCompraDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => ItemRecebimentoDto)
  itens!: ItemRecebimentoDto[];
}
