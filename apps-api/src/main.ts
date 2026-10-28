
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule, ObserveInstrument } from './app.module.js';

async function bootstrap() {
  // Cria a aplicação NestJS e mantém a instrumentação já configurada.
  const app = await NestFactory.create(AppModule, {
    instrument: ObserveInstrument,
  });

  // Permite que o frontend local acesse a API.
  // O endereço deve corresponder à origem usada no navegador.
  app.enableCors({
    origin: 'http://localhost:3000',
  });

  // Configura a validação global dos dados recebidos pela API.
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

  // Inicia o servidor na porta definida no .env.
  // Se PORT não estiver definida, utiliza a porta 3000.
  await app.listen(process.env.PORT ?? 3000);
}

// Executa a inicialização da aplicação.
await bootstrap();
