
import { Module } from '@nestjs/common';
import { EmpresasService } from './empresas.service.js';
import { EmpresasController } from './empresas.controller.js';
import { AdminPlataformaModule } from '../admin-plataforma/admin-plataforma.module.js';
import { AuthModule } from '../auth/auth.module.js';

@Module({
  // Disponibiliza o JwtService usado na validação do token.
  imports: [AuthModule, AdminPlataformaModule],

  // Serviço responsável pelas operações de empresas.
  providers: [EmpresasService],

  // Controller com as rotas administrativas protegidas.
  controllers: [EmpresasController],
})
export class EmpresasModule {}
