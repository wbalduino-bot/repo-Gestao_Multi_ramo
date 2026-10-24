
import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { EmpresasService } from './empresas.service.js';
import { CriarEmpresaDto } from './dto/criar-empresa.dto.js';
import { AtualizarEmpresaDto } from './dto/atualizar-empresa.dto.js';
import { ListarEmpresasDto } from './dto/listar-empresas.dto.js';
import { AtivarEmpresaDto } from './dto/ativar-empresa.dto.js';

@Controller('empresas')
export class EmpresasController {
  constructor(private readonly empresasService: EmpresasService) {}

  @Post()
  criar(@Body() dto: CriarEmpresaDto) {
    return this.empresasService.criar(dto);
  }

  @Get()
  listar(@Query() filtros: ListarEmpresasDto) {
    return this.empresasService.listar(filtros);
  }

  @Get(':id')
  buscarPorId(@Param('id') id: string) {
    return this.empresasService.buscarPorId(id);
  }

  @Patch(':id')
  atualizar(
    @Param('id') id: string,
    @Body() dto: AtualizarEmpresaDto,
  ) {
    return this.empresasService.atualizar(id, dto);
  }

  @Patch(':id/ativacao')
  alterarAtivacao(
    @Param('id') id: string,
    @Body() dto: AtivarEmpresaDto,
  ) {
    return this.empresasService.alterarAtivacao(id, dto.ativo);
  }
}
