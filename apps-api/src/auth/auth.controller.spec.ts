
import { Test, TestingModule } from '@nestjs/testing';

import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';

// Testes do controller responsável pelo endpoint /auth/login.
describe('AuthController', () => {
  let controller: AuthController;

  // Prepara um módulo de teste isolado antes de cada teste.
  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      // Controller que será testado.
      controllers: [AuthController],

      // Registra uma versão simulada do serviço de autenticação.
      providers: [
        {
          provide: AuthService,
          useValue: {
            // Simula o método login sem acessar o banco de dados.
            login: vi.fn(),
          },
        },
      ],
    }).compile();

    // Obtém a instância do controller criada pelo NestJS.
    controller = module.get<AuthController>(AuthController);
  });

  // Verifica se o controller foi criado corretamente.
  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
