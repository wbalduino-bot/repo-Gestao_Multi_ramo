
import { Module } from '@nestjs/common';

import { AuditoriaModule } from '../auditoria/auditoria.module.js';
import { AuthModule } from '../auth/auth.module.js';

import { AdminPlataformaController } from './admin-plataforma.controller.js';
import { AuditoriaPlataformaController } from './auditoria-plataforma.controller.js';
import { AuditoriaPlataformaService } from './auditoria-plataforma.service.js';
import { AdminPlataformaService } from './admin-plataforma.service.js';
import { AdminPlataformaGuard } from './guards/admin-plataforma.guard.js';

@Module({
  // Disponibiliza JWT e auditoria para o módulo administrativo.
  imports: [
    AuthModule,
    AuditoriaModule,
  ],

  // Rotas de autenticação do administrador da plataforma.
  controllers: [AdminPlataformaController, AuditoriaPlataformaController],

  // Serviços e proteção de acesso administrativo.
  providers: [
    AdminPlataformaService,
    AuditoriaPlataformaService,
    AdminPlataformaGuard,
  ],

  // Permite que outros módulos utilizem esse guard.
  exports: [AdminPlataformaGuard],
})
export class AdminPlataformaModule {}
