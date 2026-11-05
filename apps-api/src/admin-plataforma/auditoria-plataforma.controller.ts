import {
  Controller,
  Get,
  Query,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { AdminPlataformaGuard } from './guards/admin-plataforma.guard.js';
import type { RequisicaoAdminPlataforma } from './guards/admin-plataforma.guard.js';
import { AuditoriaPlataformaService } from './auditoria-plataforma.service.js';
import { ListarAuditoriaPlataformaDto } from './dto/listar-auditoria-plataforma.dto.js';

/** Consulta restrita a administradores SaaS ativos com token válido. */
@Controller('admin-plataforma/auditoria')
@UseGuards(AdminPlataformaGuard)
export class AuditoriaPlataformaController {
  constructor(
    private readonly auditoriaPlataforma: AuditoriaPlataformaService,
  ) {}

  @Get()
  listar(
    @Req() requisicao: RequisicaoAdminPlataforma,
    @Query() filtros: ListarAuditoriaPlataformaDto,
  ) {
    if (!requisicao.user?.sub) {
      throw new UnauthorizedException('Administrador não autenticado.');
    }
    return this.auditoriaPlataforma.listar(requisicao.user.sub, filtros);
  }
}
