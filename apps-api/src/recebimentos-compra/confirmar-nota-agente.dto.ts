import { Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsInt, IsNumber, IsObject,
  IsOptional, IsUUID, Max, Min, ValidateNested,
} from 'class-validator';
import { DadosNovoProdutoDto } from '../produtos/dto/criar-produto.dto.js';
import { DadosEntradaCompraDto } from './confirmar-recebimento-compra.dto.js';

export class ProdutoNovoNotaDto extends DadosNovoProdutoDto {
  // O SKU é opcional somente no recebimento de notas.
  @IsOptional()
  declare sku: string;
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(0)
  @Max(9999999999.99)
  custo?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(9999999999.99)
  preco?: number;
}

class ItemNotaAgenteDto extends DadosEntradaCompraDto {
  @IsInt()
  @Min(0)
  @Max(99)
  indiceNota!: number;

  @IsOptional()
  @IsBoolean()
  usarPrecoDaNota?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  fatorEmbalagem?: number;

  @IsOptional()
  @IsUUID()
  produtoId?: string;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => ProdutoNovoNotaDto)
  produtoNovo?: ProdutoNovoNotaDto;
}

export class ConfirmarNotaAgenteDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @IsObject({ each: true })
  @ValidateNested({ each: true })
  @Type(() => ItemNotaAgenteDto)
  itens!: ItemNotaAgenteDto[];
}

export class VincularProdutoNotaDto {
  @IsUUID()
  produtoId!: string;
}
