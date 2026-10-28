
import { Transform, Type } from 'class-transformer';
import {
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

/**
 * Tipos de movimentação permitidos neste primeiro estágio.
 *
 * RESERVA e LIBERACAO continuam definidos no enum do banco,
 * mas serão tratados em uma etapa específica do estoque.
 */
export type TipoMovimentacaoPermitida =
  | 'ENTRADA'
  | 'SAIDA'
  | 'AJUSTE';

/**
 * Dados necessários para movimentar o estoque de um produto.
 *
 * Regras:
 * - ENTRADA: quantidade positiva para aumentar o saldo.
 * - SAIDA: quantidade positiva para diminuir o saldo.
 * - AJUSTE: quantidade positiva ou negativa, representando
 *   a diferença aplicada ao saldo atual.
 *
 * A validação definitiva do saldo e das regras de movimentação
 * também é realizada pelo ProdutosService.
 */
export class CriarMovimentacaoEstoqueDto {
  // Limita as operações aos tipos permitidos nesta etapa.
  @IsIn(['ENTRADA', 'SAIDA', 'AJUSTE'])
  tipo!: TipoMovimentacaoPermitida;

  // Converte o valor recebido no JSON para número.
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 3 })
  quantidade!: number;

  /**
   * Motivo obrigatório para a auditoria da movimentação.
   * Os espaços excedentes são removidos antes da validação.
   */
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(250)
  motivo!: string;

  /**
   * Identificador opcional de pedido, documento ou referência externa.
   * Quando informado, deve ser uma string com até 100 caracteres.
   */
  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MaxLength(100)
  referenciaId?: string;
}
