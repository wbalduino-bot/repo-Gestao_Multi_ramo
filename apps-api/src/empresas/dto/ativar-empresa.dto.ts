import { IsBoolean } from 'class-validator';

export class AtivarEmpresaDto {
  @IsBoolean()
  ativo!: boolean;
}
