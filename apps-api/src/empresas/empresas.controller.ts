
import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';

import { EmpresasService } from './empresas.service.js';
import { CriarEmpresaDto } from './dto/criar-empresa.dto.js';
import { AtualizarEmpresaDto } from './dto/atualizar-empresa.dto.js';
import { ListarEmpresasDto } from './dto/listar-empresas.dto.js';
import { AtivarEmpresaDto } from './dto/ativar-empresa.dto.js';
import { AdminPlataformaGuard } from '../admin-plataforma/guards/admin-plataforma.guard.js';

/**
 * Controller responsável pelas operações administrativas
 * de cadastro, consulta, atualização e ativação de empresas.
 *
 * A proteção aplicada no controller abrange todas as rotas
 * deste arquivo, impedindo o acesso de usuários comuns.
 */
@Controller('empresas')
@UseGuards(AdminPlataformaGuard)
export class EmpresasController {
  constructor(private readonly empresasService: EmpresasService) {}

  // Cadastra uma nova empresa na plataforma.
  @Post()
  criar(@Body() dto: CriarEmpresaDto) {
    return this.empresasService.criar(dto);
  }

  // Lista as empresas conforme os filtros informados.
  @Get()
  listar(@Query() filtros: ListarEmpresasDto) {
    return this.empresasService.listar(filtros);
  }

  // Busca uma empresa específica pelo identificador.
  @Get(':id')
  buscarPorId(@Param('id') id: string) {
    return this.empresasService.buscarPorId(id);
  }

  // Atualiza os dados cadastrais de uma empresa.
  @Patch(':id')
  atualizar(
    @Param('id') id: string,
    @Body() dto: AtualizarEmpresaDto,
  ) {
    return this.empresasService.atualizar(id, dto);
  }

  // Ativa ou desativa uma empresa na plataforma.
  @Patch(':id/ativacao')
  alterarAtivacao(
    @Param('id') id: string,
    @Body() dto: AtivarEmpresaDto,
  ) {
    return this.empresasService.alterarAtivacao(id, dto.ativo);
  }
}
