
import { Type } from 'class-transformer';

import {
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsNumber,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';

/**
 * Formas de pagamento aceitas nesta primeira versão.
 */
export type FormaPagamentoPermitida =
  | 'DINHEIRO'
  | 'PIX'
  | 'CARTAO_DEBITO'
  | 'CARTAO_CREDITO'
  | 'OUTRO';

/**
 * Define um produto e sua quantidade dentro da venda.
 *
 * O preço unitário é consultado no cadastro do produto
 * pelo backend para impedir alterações de preço pelo cliente.
 */
export class ItemVendaDto {
  @IsUUID()
  produtoId!: string;

  @Type(() => Number)
  @IsNumber(
    { maxDecimalPlaces: 3 },
    { message: 'A quantidade deve ter no máximo três casas decimais.' },
  )
  @Min(0.001, {
    message: 'A quantidade vendida deve ser maior que zero.',
  })
  quantidade!: number;
}

/**
 * Dados aceitos para registrar uma venda.
 *
 * O total, os preços unitários e os subtotais não são recebidos
 * do frontend: são calculados e conferidos pelo backend.
 */
export class CriarVendaDto {
  @IsIn([
    'DINHEIRO',
    'PIX',
    'CARTAO_DEBITO',
    'CARTAO_CREDITO',
    'OUTRO',
  ])
  formaPagamento!: FormaPagamentoPermitida;

  @IsArray()
  @ArrayMinSize(1, {
    message: 'A venda deve conter pelo menos um produto.',
  })
  @ArrayUnique((item: ItemVendaDto) => item.produtoId, {
    message: 'Cada produto deve aparecer apenas uma vez na venda.',
  })
  @ValidateNested({ each: true })
  @Type(() => ItemVendaDto)
  itens!: ItemVendaDto[];
}
