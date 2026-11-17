import { IsIn, IsInt, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';

export class AlterarTrialDto {
  @IsIn(['TRIAL', 'DEFINITIVO'])
  modalidade!: 'TRIAL' | 'DEFINITIVO';

  @IsInt()
  @Min(0)
  @Max(2147483646)
  versaoAcesso!: number;

  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString()
  @MinLength(10)
  @MaxLength(500)
  justificativa!: string;
}
