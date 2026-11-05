
import { IsBoolean } from 'class-validator';

/**
 * Define a situação de ativação do usuário.
 *
 * A alteração é feita por uma rota específica,
 * separada dos demais dados cadastrais.
 */
export class AtivarUsuarioDto {
  @IsBoolean()
  ativo!: boolean;
}
