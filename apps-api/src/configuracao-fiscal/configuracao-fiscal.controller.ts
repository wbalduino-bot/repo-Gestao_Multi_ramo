import {
  Body,
  Controller,
  Get,
  Patch,
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

import { ConfiguracaoFiscalService } from './configuracao-fiscal.service.js';

import { AtualizarConfiguracaoFiscalDto } from './dto/atualizar-configuracao-fiscal.dto.js';

/**
 * Gerencia os dados cadastrais fiscais da empresa autenticada.
 *
 * A proteção é aplicada ao controller inteiro para impedir
 * que novas rotas sejam criadas sem os guards necessários.
 *
 * Este controller não realiza emissão de NF-e ou NFC-e.
 */
@Controller('configuracao-fiscal')
@UseGuards(JwtAuthGuard, GerenciaGuard)
export class ConfiguracaoFiscalController {
  constructor(
    private readonly configuracaoFiscalService:
      ConfiguracaoFiscalService,
  ) {}

  /**
   * Recupera a identidade previamente validada pelo JwtAuthGuard.
   *
   * O empresaId nunca é recebido do corpo, da URL ou
   * de parâmetros enviados pelo frontend.
   */
  private obterContexto(
    requisicao: RequisicaoAutenticada,
  ) {
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
      empresaId: usuario.empresaId,
      usuarioId: usuario.sub,
    };
  }

  /**
   * Consulta o cadastro fiscal da empresa autenticada.
   *
   * Retorna null quando o cadastro ainda não existe.
   * A consulta será registrada pela auditoria do serviço.
   */
  @Get()
  consultar(
    @Req() requisicao: RequisicaoAutenticada,
  ) {
    const contexto = this.obterContexto(requisicao);

    return this.configuracaoFiscalService
      .consultar(contexto.empresaId, contexto.usuarioId)
      .then((configuracao) => {
        // Uma resposta explícita evita corpo HTTP vazio
        // quando a empresa ainda não tem cadastro fiscal.
        return configuracao ?? { configuracao: null };
      });
  }

  /**
   * Cria ou atualiza os dados fiscais cadastrais.
   *
   * A ValidationPipe global valida o DTO e rejeita
   * propriedades não autorizadas, como empresaId.
   *
   * A operação de gravação e sua auditoria são
   * realizadas pelo serviço em uma transação.
   */
  @Patch()
  salvar(
    @Req() requisicao: RequisicaoAutenticada,
    @Body() dto: AtualizarConfiguracaoFiscalDto,
  ) {
    const contexto = this.obterContexto(requisicao);

    return this.configuracaoFiscalService.salvar(
      contexto.empresaId,
      contexto.usuarioId,
      dto,
    );
  }
}
