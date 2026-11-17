import { UnauthorizedException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { PerfilAcesso } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { JwtAuthGuard } from '../auth/strategies/jwt.strategy.js';
import type { RequisicaoAutenticada } from '../auth/strategies/jwt.strategy.js';
import { GerenciaGuard } from '../auth/guards/gerencia.guard.js';

import { ConfiguracaoFiscalController } from './configuracao-fiscal.controller.js';
import { ConfiguracaoFiscalService } from './configuracao-fiscal.service.js';

/**
 * Testes unitários do controller fiscal.
 *
 * O serviço é simulado para verificar somente o encaminhamento
 * dos dados autenticados e a configuração de segurança das rotas.
 *
 * A execução real dos guards será verificada nos testes E2E.
 */
describe('ConfiguracaoFiscalController', () => {
  const empresaId = 'empresa-1';
  const usuarioId = 'usuario-1';

  // Simula os métodos do serviço sem acessar o PostgreSQL.
  const service = {
    consultar: vi.fn(),
    salvar: vi.fn(),
  };

  const controller = new ConfiguracaoFiscalController(
    service as unknown as ConfiguracaoFiscalService,
  );

  /**
   * Cria uma requisição simulada com a identidade que normalmente
   * seria disponibilizada pelo JwtAuthGuard.
   */
  function criarRequisicao(
    usuario: Record<string, unknown> = {
      sub: usuarioId,
      empresaId,
      perfil: PerfilAcesso.ADMINISTRADOR,
    },
  ): RequisicaoAutenticada {
    return {
      user: usuario,
    } as unknown as RequisicaoAutenticada;
  }

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('deve consultar a configuração usando a empresa autenticada', async () => {
    const configuracao = {
      id: 'configuracao-1',
      empresaId,
      uf: 'SP',
    };

    service.consultar.mockResolvedValue(configuracao);

    const resultado = await controller.consultar(
      criarRequisicao(),
    );

    expect(resultado).toEqual(configuracao);

    expect(service.consultar).toHaveBeenCalledWith(
      empresaId,
      usuarioId,
    );
  });

  it('deve encaminhar a atualização sem permitir escolher outra empresa', async () => {
    const dto = {
      razaoSocial: 'Empresa Exemplo Ltda',
      uf: 'SP',
    };

    service.salvar.mockResolvedValue({
      id: 'configuracao-1',
      empresaId,
      ...dto,
    });

    await controller.salvar(
      criarRequisicao({
        sub: usuarioId,
        empresaId,
        perfil: PerfilAcesso.GERENTE,
      }),
      dto,
    );

    expect(service.salvar).toHaveBeenCalledWith(
      empresaId,
      usuarioId,
      dto,
    );
  });

  it('deve rejeitar identidade sem identificador de usuário', () => {
    expect(() =>
      controller.consultar(
        criarRequisicao({
          empresaId,
          perfil: PerfilAcesso.ADMINISTRADOR,
        }),
      ),
    ).toThrow(UnauthorizedException);

    expect(service.consultar).not.toHaveBeenCalled();
  });

  it('deve rejeitar identidade sem empresa autenticada', () => {
    expect(() =>
      controller.consultar(
        criarRequisicao({
          sub: usuarioId,
          perfil: PerfilAcesso.ADMINISTRADOR,
        }),
      ),
    ).toThrow(UnauthorizedException);

    expect(service.consultar).not.toHaveBeenCalled();
  });

  it('deve rejeitar identidade com perfil inexistente', () => {
    expect(() =>
      controller.consultar(
        criarRequisicao({
          sub: usuarioId,
          empresaId,
          perfil: 'PERFIL_INEXISTENTE',
        }),
      ),
    ).toThrow(UnauthorizedException);

    expect(service.consultar).not.toHaveBeenCalled();
  });

  it('deve exigir JWT e permissão gerencial no controller inteiro', () => {
    /**
     * Inspeciona os metadados registrados pelo decorator
     * @UseGuards, verificando a proteção do GET e do PATCH.
     *
     * Esse teste não substitui a execução dos guards nos E2E.
     */
    const guards = Reflect.getMetadata(
      GUARDS_METADATA,
      ConfiguracaoFiscalController,
    ) as unknown[];

    expect(guards).toContain(JwtAuthGuard);
    expect(guards).toContain(GerenciaGuard);
  });
});
