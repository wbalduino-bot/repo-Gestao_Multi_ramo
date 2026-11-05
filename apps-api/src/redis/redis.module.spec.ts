
import { Test, TestingModule } from '@nestjs/testing';

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';

import { REDIS_CLIENT } from './redis.constants.js';
import { RedisModule } from './redis.module.js';

/**
 * Testes das regras de configuração da conexão Redis.
 *
 * Verifica que:
 * - Desenvolvimento pode utilizar o Redis local.
 * - Testes podem utilizar o Redis local.
 * - Produção exige uma REDIS_URL explícita.
 * - Produção aceita uma URL Redis configurada.
 *
 * Nenhum teste abre conexão com o servidor Redis.
 */
describe('RedisModule', () => {
  let modulo: TestingModule | undefined;

  // Guarda as configurações originais do processo.
  let ambienteAnterior: string | undefined;
  let urlRedisAnterior: string | undefined;

  /**
   * Prepara um ambiente isolado para cada teste.
   */
  beforeEach(() => {
    ambienteAnterior = process.env.NODE_ENV;
    urlRedisAnterior = process.env.REDIS_URL;

    delete process.env.NODE_ENV;
    delete process.env.REDIS_URL;
  });

  /**
   * Fecha o módulo e restaura as variáveis originais.
   */
  afterEach(async () => {
    if (modulo) {
      await modulo.close();
      modulo = undefined;
    }

    if (ambienteAnterior === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = ambienteAnterior;
    }

    if (urlRedisAnterior === undefined) {
      delete process.env.REDIS_URL;
    } else {
      process.env.REDIS_URL = urlRedisAnterior;
    }
  });

  /**
   * Compila o módulo e permite verificar suas dependências.
   *
   * A conexão Redis é criada sob demanda pelo RedisService,
   * portanto a compilação não precisa acessar o servidor.
   */
  async function compilarModulo(): Promise<TestingModule> {
    modulo = await Test.createTestingModule({
      imports: [RedisModule],
    }).compile();

    return modulo;
  }

  /**
   * TESTE 1 — Ambiente de desenvolvimento.
   *
   * Confirma que o módulo pode ser inicializado sem REDIS_URL,
   * utilizando o endereço local definido como padrão.
   */
  it('deve permitir inicialização sem REDIS_URL em desenvolvimento', async () => {
    process.env.NODE_ENV = 'development';

    const resultado = await compilarModulo();

    expect(
      resultado.get(REDIS_CLIENT),
    ).toBeDefined();
  });

  /**
   * TESTE 2 — Ambiente de testes.
   *
   * Confirma que a execução automatizada também pode utilizar
   * o endereço local quando REDIS_URL não estiver configurada.
   */
  it('deve permitir inicialização sem REDIS_URL em testes', async () => {
    process.env.NODE_ENV = 'test';

    const resultado = await compilarModulo();

    expect(
      resultado.get(REDIS_CLIENT),
    ).toBeDefined();
  });

  /**
   * TESTE 3 — Produção sem configuração.
   *
   * Impede que uma aplicação de produção inicialize
   * utilizando silenciosamente o Redis da própria máquina.
   */
  it('deve impedir inicialização em produção sem REDIS_URL', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.REDIS_URL;

    await expect(
      compilarModulo(),
    ).rejects.toThrow(
      'A variável REDIS_URL é obrigatória em produção.',
    );
  });

  /**
   * TESTE 4 — Produção com Redis configurado.
   *
   * Confirma que uma URL explícita permite a criação
   * do cliente Redis no ambiente de produção.
   *
   * O teste não abre conexão nem exige servidor disponível.
   */
  it('deve permitir inicialização em produção com REDIS_URL', async () => {
    process.env.NODE_ENV = 'production';

    process.env.REDIS_URL =
      'redis://redis-interno:6379';

    const resultado = await compilarModulo();

    expect(
      resultado.get(REDIS_CLIENT),
    ).toBeDefined();
  });

  /**
   * TESTE 5 — Redis com TLS.
   *
   * Confirma que o módulo aceita uma URL com protocolo rediss,
   * utilizado quando a conexão Redis exige TLS.
   *
   * A conexão não é aberta durante este teste.
   */
  it('deve aceitar URL Redis com TLS em produção', async () => {
    process.env.NODE_ENV = 'production';

    process.env.REDIS_URL =
      'rediss://redis-interno:6380';

    const resultado = await compilarModulo();

    expect(
      resultado.get(REDIS_CLIENT),
    ).toBeDefined();
  });
});
