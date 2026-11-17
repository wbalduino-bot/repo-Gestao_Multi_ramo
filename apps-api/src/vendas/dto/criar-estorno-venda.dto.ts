import { Type } from 'class-transformer';
import {
  ArrayMinSize, ArrayUnique, IsArray, IsNumber, IsString,
  IsUUID, MaxLength, Min, MinLength, ValidateNested,
} from 'class-validator';

export class ItemEstornoVendaDto {
  @IsUUID()
  itemVendaId!: string;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 3 }, {
    message: 'A quantidade deve ter no maximo tres casas decimais.',
  })
  @Min(0.001)
  quantidade!: number;
}

/** A chaveOperacao e obrigatoria para proteger reenvios apos oscilacoes. */
export class CriarEstornoVendaDto {
  @IsUUID()
  chaveOperacao!: string;

  @IsString()
  @MinLength(10)
  @MaxLength(500)
  justificativa!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique((item: ItemEstornoVendaDto) => item.itemVendaId)
  @ValidateNested({ each: true })
  @Type(() => ItemEstornoVendaDto)
  itens!: ItemEstornoVendaDto[];
}
