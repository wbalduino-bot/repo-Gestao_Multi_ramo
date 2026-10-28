
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';

// Importa o controller responsável pela rota de login.
import { AuthController } from './auth.controller.js';

// Importa o serviço que valida as credenciais e gera o token.
import { AuthService } from './auth.service.js';

// Importa o guard que valida os tokens JWT nas rotas protegidas.
import { JwtAuthGuard } from './strategies/jwt.strategy.js';

@Module({
  imports: [
    // Configura o módulo JWT para assinar e validar tokens.
    JwtModule.registerAsync({
      useFactory: () => {
        // Obtém a chave secreta das variáveis de ambiente.
        const secret = process.env.JWT_SECRET;

        // Impede a inicialização se a chave não estiver configurada.
        if (!secret) {
          throw new Error(
            'A variável JWT_SECRET não está configurada.',
          );
        }

        // Define a chave e o prazo de validade dos tokens.
        return {
          secret,
          signOptions: {
            expiresIn: '15m',
          },
        };
      },
    }),
  ],

  // Registra a rota de autenticação.
  controllers: [AuthController],

  // Registra os componentes utilizados neste módulo.
  providers: [AuthService, JwtAuthGuard],

  // Permite que outros módulos utilizem o JwtService.
  exports: [JwtModule],
})
export class AuthModule {}
