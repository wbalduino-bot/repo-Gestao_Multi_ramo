
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { AdminPlataformaController } from './admin-plataforma.controller.js';
import { AdminPlataformaService } from './admin-plataforma.service.js';
import { AdminPlataformaGuard } from './guards/admin-plataforma.guard.js';

@Module({
  // Disponibiliza o JwtService usado pelo guard.
  imports: [AuthModule],

  // Rotas de autenticação do administrador da plataforma.
  controllers: [AdminPlataformaController],

  // Registra os serviços e a proteção de acesso.
  providers: [AdminPlataformaService, AdminPlataformaGuard],

  // Permite que outros módulos utilizem esse guard.
  exports: [AdminPlataformaGuard],
})
export class AdminPlataformaModule {}
