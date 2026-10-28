
import { IsBoolean } from 'class-validator';

/** Valida a mudança de situação de um produto. */
export class AlterarAtivacaoProdutoDto {
  @IsBoolean()
  ativo!: boolean;
}
