import { INestApplication, ValidationPipe } from '@nestjs/common';

/**
 * Aplica à aplicação as configurações globais que precisam ser
 * idênticas em produção e nos testes E2E.
 *
 * Centralizar aqui evita que os testes validem um comportamento
 * diferente do que roda de verdade (por exemplo, sem ValidationPipe).
 */
export function configurarAplicacao(app: INestApplication): void {
  app.useGlobalPipes(
    new ValidationPipe({
      // Remove propriedades que não estão definidas nos DTOs.
      whitelist: true,

      // Rejeita requisições que contenham propriedades não permitidas.
      forbidNonWhitelisted: true,

      // Converte os dados recebidos para os tipos definidos nos DTOs.
      transform: true,
    }),
  );
}