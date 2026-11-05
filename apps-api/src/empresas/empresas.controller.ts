import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';

import { EmpresasService } from './empresas.service.js';
import { CriarEmpresaDto } from './dto/criar-empresa.dto.js';
import {
  AdministradorEmpresaInicialDto,
  CriarEmpresaComAdministradoresDto,
} from './dto/criar-empresa-com-administradores.dto.js';
import { AtualizarEmpresaDto } from './dto/atualizar-empresa.dto.js';
import { ListarEmpresasDto } from './dto/listar-empresas.dto.js';
import { AtivarEmpresaDto } from './dto/ativar-empresa.dto.js';

import {
  AdminPlataformaGuard,
} from '../admin-plataforma/guards/admin-plataforma.guard.js';

import type {
  RequisicaoAdminPlataforma,
} from '../admin-plataforma/guards/admin-plataforma.guard.js';

/**
 * Controller responsável pelas operações administrativas
 * de cadastro, consulta, atualização e ativação de empresas.
 *
 * Todas as rotas são protegidas pelo administrador da plataforma.
 */
@Controller('empresas')
@UseGuards(AdminPlataformaGuard)
export class EmpresasController {
  constructor(
    private readonly empresasService: EmpresasService,
  ) {}

  /**
   * Recupera a identidade administrativa validada pelo guard.
   *
   * Nunca utiliza identificadores enviados pelo frontend.
   */
  private obterAdministradorId(
    requisicao: RequisicaoAdminPlataforma,
  ): string {
    const administradorId = requisicao.user?.sub;

    if (!administradorId) {
      throw new UnauthorizedException(
        'Identidade administrativa não encontrada.',
      );
    }

    return administradorId;
  }

  /**
   * Cadastra uma empresa na plataforma.
   */
  @Post()
  criar(
    @Req() requisicao: RequisicaoAdminPlataforma,
    @Body() dto: CriarEmpresaDto,
  ) {
    const administradorId =
      this.obterAdministradorId(requisicao);

    return this.empresasService.criar(
      administradorId,
      dto,
    );
  }

  /**
   * Cria empresa e seus administradores de maneira atômica.
   * O cliente não escolhe o EmpresaId: ele é gerado pelo banco.
   */
  @Post('com-administradores')
  criarComAdministradores(
    @Req() requisicao: RequisicaoAdminPlataforma,
    @Body() dto: CriarEmpresaComAdministradoresDto,
  ) {
    return this.empresasService.criarComAdministradores(
      this.obterAdministradorId(requisicao),
      dto,
    );
  }

  /**
   * Permite provisionar administradores para uma empresa já cadastrada.
   */
  @Post(':id/administradores')
  adicionarAdministradorEmpresa(
    @Req() requisicao: RequisicaoAdminPlataforma,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: AdministradorEmpresaInicialDto,
  ) {
    return this.empresasService.adicionarAdministradorEmpresa(
      this.obterAdministradorId(requisicao),
      id,
      dto,
    );
  }

  /**
   * Recupera apenas os administradores da empresa informada.
   */
  @Get(':id/administradores')
  listarAdministradoresEmpresa(
    @Req() requisicao: RequisicaoAdminPlataforma,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.empresasService.listarAdministradoresEmpresa(
      this.obterAdministradorId(requisicao),
      id,
    );
  }

  /**
   * Lista as empresas conforme os filtros informados.
   */
  @Get()
  listar(
    @Req() requisicao: RequisicaoAdminPlataforma,
    @Query() filtros: ListarEmpresasDto,
  ) {
    const administradorId =
      this.obterAdministradorId(requisicao);

    return this.empresasService.listar(
      administradorId,
      filtros,
    );
  }

  /**
   * Busca uma empresa pelo identificador.
   */
  @Get(':id')
  buscarPorId(
    @Req() requisicao: RequisicaoAdminPlataforma,
    @Param('id') id: string,
  ) {
    const administradorId =
      this.obterAdministradorId(requisicao);

    return this.empresasService.buscarPorId(
      administradorId,
      id,
    );
  }

  /**
   * Atualiza os dados cadastrais de uma empresa.
   */
  @Patch(':id')
  atualizar(
    @Req() requisicao: RequisicaoAdminPlataforma,
    @Param('id') id: string,
    @Body() dto: AtualizarEmpresaDto,
  ) {
    const administradorId =
      this.obterAdministradorId(requisicao);

    return this.empresasService.atualizar(
      administradorId,
      id,
      dto,
    );
  }

  /**
   * Ativa ou desativa uma empresa na plataforma.
   */
  @Patch(':id/ativacao')
  alterarAtivacao(
    @Req() requisicao: RequisicaoAdminPlataforma,
    @Param('id') id: string,
    @Body() dto: AtivarEmpresaDto,
  ) {
    const administradorId =
      this.obterAdministradorId(requisicao);

    return this.empresasService.alterarAtivacao(
      administradorId,
      id,
      dto.ativo,
    );
  }
}