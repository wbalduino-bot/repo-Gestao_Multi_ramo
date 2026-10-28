import {
  IsEmail,
  IsString,
  IsUUID,
  MinLength,
} from 'class-validator';

// Define os campos obrigatórios para realizar o login.
export class LoginDto {
  // Identifica a empresa à qual o usuário pertence.
  @IsUUID()
  empresaId!: string;

  // Exige um endereço de e-mail válido.
  @IsEmail()
  email!: string;

  // Exige uma senha em formato de texto com pelo menos 8 caracteres.
  @IsString()
  @MinLength(8)
  senha!: string;
}