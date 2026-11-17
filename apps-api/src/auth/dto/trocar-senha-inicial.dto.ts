import { IsString, MaxLength, MinLength } from 'class-validator';

/** Recebe somente a nova senha. A conta vem do token de primeiro acesso. */
export class TrocarSenhaInicialDto {
  @IsString()
  @MinLength(8)
  @MaxLength(64)
  novaSenha!: string;
}
