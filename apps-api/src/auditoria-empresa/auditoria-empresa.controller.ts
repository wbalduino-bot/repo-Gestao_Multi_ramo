import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard, type RequisicaoAutenticada } from '../auth/strategies/jwt.strategy.js';
import { GerenciaGuard } from '../auth/guards/gerencia.guard.js';
import { AuditoriaEmpresaService } from './auditoria-empresa.service.js';
import { ListarAuditoriaEmpresaDto } from './dto/listar-auditoria-empresa.dto.js';

/** Administração e gerência consultam exclusivamente o histórico da própria empresa. */
@Controller('auditoria')
@UseGuards(JwtAuthGuard, GerenciaGuard)
export class AuditoriaEmpresaController {
  constructor(private readonly auditoria: AuditoriaEmpresaService) {}

  @Get()
  listar(
    @Req() requisicao: RequisicaoAutenticada,
    @Query() filtros: ListarAuditoriaEmpresaDto,
  ) {
    return this.auditoria.listar(requisicao.user.empresaId, filtros);
  }
}
