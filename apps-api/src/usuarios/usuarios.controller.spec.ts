
import { Test, TestingModule } from '@nestjs/testing';

import { UsuariosController } from './usuarios.controller.js';
import { JwtAuthGuard } from '../auth/strategies/jwt.strategy.js';

// Agrupa os testes do controller responsável pela rota /usuarios/me.
describe('UsuariosController', () => {
  let controller: UsuariosController;

  // Prepara um módulo de teste isolado antes de cada teste.
  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      // Controller que será testado.
      controllers: [UsuariosController],
    })
      // Substitui o guard real por um guard simulado.
      // Assim, o teste de criação do controller não precisa validar JWT.
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: vi.fn(() => true),
      })
      .compile();

    // Obtém a instância do controller criada pelo NestJS.
    controller = module.get<UsuariosController>(UsuariosController);
  });

  // Confirma que o controller pode ser criado corretamente.
  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
