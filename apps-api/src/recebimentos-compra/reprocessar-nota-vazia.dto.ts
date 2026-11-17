import { Transform } from 'class-transformer';
import { IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class ReprocessarNotaVaziaDto {
  @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value)
  @IsString()
  @MinLength(10)
  @MaxLength(500)
  justificativa!: string;

  @IsString()
  @Matches(/^[a-f0-9]{64}$/)
  versaoExtracao!: string;
}
