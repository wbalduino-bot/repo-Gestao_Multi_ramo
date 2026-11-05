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

import { PerfilAcesso } from '@prisma/client';

import {
  JwtAuthGuard,
  type RequisicaoAutenticada,
} from '../auth/strategies/jwt.strategy.js';

import { GerenciaGuard } from '../auth/guards/gerencia.guard.js';

import { UsuariosService } from './usuarios.service.js';

import { CriarUsuarioDto } from './dto/criar-usuario.dto.js';
import { AtualizarUsuarioDto } from './dto/atualizar-usuario.dto.js';
import { ListarUsuariosDto } from './dto/listar-usuarios.dto.js';
import { AtivarUsuarioDto } from './dto/ativar-usuario.dto.js';

/**
 * Controller responsável pela gestão dos usuários empresariais.
 */
@Controller('usuarios')
export class UsuariosController {
  constructor(
    private readonly usuariosService: UsuariosService,
  ) {}

  /**
   * Recupera a identidade validada pelo JWT.
   *
   * Nunca utiliza empresaId enviado pelo frontend.
   */
  private obterContexto(requisicao: RequisicaoAutenticada) {
    const usuario = requisicao.user;

    if (
      !usuario?.sub ||
      !usuario.empresaId ||
      !Object.values(PerfilAcesso).includes(
        usuario.perfil as PerfilAcesso,
      )
    ) {
      throw new UnauthorizedException(
        'Identidade do usuário autenticado inválida.',
      );
    }

    return {
      usuarioId: usuario.sub,
      empresaId: usuario.empresaId,
      perfil: usuario.perfil as PerfilAcesso,
    };
  }

  /**
   * Retorna os dados da sessão atual.
   * Disponível para todos os perfis autenticados.
   */
  @Get('me')
  @UseGuards(JwtAuthGuard)
  obterUsuarioAutenticado(
    @Req() requisicao: RequisicaoAutenticada,
  ) {
    const contexto = this.obterContexto(requisicao);

    return {
      usuarioId: contexto.usuarioId,
      empresaId: contexto.empresaId,
      perfil: contexto.perfil,
    };
  }

  /**
   * Cadastra um funcionário na empresa autenticada.
   */
  @Post()
  @UseGuards(JwtAuthGuard, GerenciaGuard)
  criar(
    @Req() requisicao: RequisicaoAutenticada,
    @Body() dto: CriarUsuarioDto,
  ) {
    const contexto = this.obterContexto(requisicao);

    return this.usuariosService.criar(
      contexto.empresaId,
      contexto.usuarioId,
      contexto.perfil,
      dto,
    );
  }

  /**
   * Lista os usuários da empresa autenticada.
   */
  @Get()
  @UseGuards(JwtAuthGuard, GerenciaGuard)
  listar(
    @Req() requisicao: RequisicaoAutenticada,
    @Query() filtros: ListarUsuariosDto,
  ) {
    const contexto = this.obterContexto(requisicao);

    return this.usuariosService.listar(
      contexto.empresaId,
      contexto.usuarioId,
      contexto.perfil,
      filtros,
    );
  }

  /**
   * Consulta um funcionário dentro da empresa autenticada.
   */
  @Get(':id')
  @UseGuards(JwtAuthGuard, GerenciaGuard)
  buscarPorId(
    @Req() requisicao: RequisicaoAutenticada,
    @Param('id', new ParseUUIDPipe()) id: string,
    ) {
    const contexto = this.obterContexto(requisicao);

    return this.usuariosService.buscarPorId(
      contexto.empresaId,
      contexto.usuarioId,
      contexto.perfil,
      id,
    );
  }

  /**
   * Atualiza os dados de um funcionário.
   */
  @Patch(':id')
  @UseGuards(JwtAuthGuard, GerenciaGuard)
  atualizar(
    @Req() requisicao: RequisicaoAutenticada,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: AtualizarUsuarioDto,
  ) {
    const contexto = this.obterContexto(requisicao);

    return this.usuariosService.atualizar(
      contexto.empresaId,
      contexto.usuarioId,
      contexto.perfil,
      id,
      dto,
    );
  }

  /**
   * Ativa ou desativa um funcionário.
   */
  @Patch(':id/ativacao')
  @UseGuards(JwtAuthGuard, GerenciaGuard)
  alterarAtivacao(
    @Req() requisicao: RequisicaoAutenticada,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: AtivarUsuarioDto,
  ) {
    const contexto = this.obterContexto(requisicao);

    return this.usuariosService.alterarAtivacao(
      contexto.empresaId,
      contexto.usuarioId,
      contexto.perfil,
      id,
      dto.ativo,
    );
  }
}
