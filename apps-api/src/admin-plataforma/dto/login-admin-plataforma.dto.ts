import { IsEmail, IsString, MinLength } from 'class-validator';

export class LoginAdminPlataformaDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8)
  senha!: string;
}
