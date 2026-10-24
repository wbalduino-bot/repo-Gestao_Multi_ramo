import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  Max,
  Min,
} from 'class-validator';

export class ListarEmpresasDto {
  @IsOptional()
  @Transform(({ value }) =>
    value === undefined ? undefined : Number(value),
  )
  @IsInt()
  @Min(1)
  pagina = 1;

  @IsOptional()
  @Transform(({ value }) =>
    value === undefined ? undefined : Number(value),
  )
  @IsInt()
  @Min(1)
  @Max(100)
  limite = 20;

  @IsOptional()
  @Transform(({ value }) => {
    if (value === 'true') return true;
    if (value === 'false') return false;
    return value;
  })
  @IsBoolean()
  ativo?: boolean;
}
