import { Module } from '@nestjs/common';
import { EmpresasService } from './empresas.service.js';
import { EmpresasController } from './empresas.controller.js';

@Module({
  providers: [EmpresasService],
  controllers: [EmpresasController]
})
export class EmpresasModule {}
