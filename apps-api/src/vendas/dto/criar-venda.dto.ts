
import { Type } from 'class-transformer';

import {
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsNumber,
  IsOptional,
  IsEmail,
  IsString,
  Max,
  MaxLength,
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
  /** UUID mantido pela tela durante os reenvios da mesma compra. */
  @IsOptional()
  @IsUUID()
  chaveOperacao?: string;

  @IsIn([
    'DINHEIRO',
    'PIX',
    'CARTAO_DEBITO',
    'CARTAO_CREDITO',
    'OUTRO',
  ])
  formaPagamento!: FormaPagamentoPermitida;

  /** Percentual (0 a 5, com ate duas casas). O total continua calculado na API. */
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(5)
  percentualDesconto?: number;

  /** Identificacao do autorizador; participa da chave de idempotencia. */
  @IsOptional()
  @IsEmail()
  @MaxLength(254)
  autorizadorEmail?: string;

  /** Senha utilizada somente nesta requisicao. Nunca salvar no navegador. */
  @IsOptional()
  @IsString()
  @MaxLength(256)
  senhaAutorizador?: string;

  /**
   * Valor entregue pelo cliente quando o pagamento for em dinheiro.
   * Opcional durante a transicao do frontend para o novo contrato.
   */
  @IsOptional()
  @Type(() => Number)
  @IsNumber(
    { maxDecimalPlaces: 2 },
    { message: 'O valor recebido deve ter no máximo duas casas decimais.' },
  )
  @Min(0, {
    message: 'O valor recebido não pode ser negativo.',
  })
  valorRecebido?: number;

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
