
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { AplicacaoLogger } from './logger.service.js';

/**
 * TESTES DO LOGGER CENTRAL
 *
 * Utilizam diretórios temporários para que nenhum teste escreva
 * dentro da pasta logs real do projeto.
 *
 * Isso permite validar a gravação física dos arquivos sem deixar
 * resíduos ou misturar registros de testes com registros da aplicação.
 */

describe('AplicacaoLogger', () => {
  let diretorioTemporario: string;

  // Mantém os loggers abertos para encerrá-los mesmo quando um teste falha.
  const loggersAbertos = new Set<AplicacaoLogger>();

  beforeEach(async () => {
    diretorioTemporario = await mkdtemp(
      path.join(os.tmpdir(), 'gestao-comercial-logs-'),
    );
  });

  afterEach(async () => {
    // Finaliza os transportes antes de remover os arquivos temporários.
    await Promise.all(
      [...loggersAbertos].map(async (logger) => {
        try {
          await logger.encerrar();
        } catch {
          // A limpeza não deve esconder a falha original do teste.
        }
      }),
    );

    loggersAbertos.clear();

    await rm(diretorioTemporario, {
      recursive: true,
      force: true,
    });
  });

  /**
   * Cria uma instância isolada para cada cenário.
   *
   * O console fica desativado porque a finalidade desses testes
   * é conferir os arquivos efetivamente gravados.
   */
  function criarLogger(): AplicacaoLogger {
    const logger = new AplicacaoLogger({
      diretorio: diretorioTemporario,
      nivel: 'debug',
      tamanhoMaximo: '1m',
      retencao: '2d',
      habilitarConsole: false,
      habilitarArquivos: true,
    });

    loggersAbertos.add(logger);

    return logger;
  }

  /**
   * Finaliza o logger antes da leitura para garantir que todos os
   * registros pendentes tenham sido enviados aos arquivos.
   */
  async function fecharLogger(logger: AplicacaoLogger): Promise<void> {
    await logger.encerrar();
    loggersAbertos.delete(logger);
  }

  /**
   * Lê e reúne os arquivos de uma categoria.
   *
   * Retorna texto vazio quando nenhum arquivo foi produzido,
   * facilitando a validação da separação entre categorias.
   */
  async function lerLogs(
    categoria: 'application' | 'errors' | 'security',
  ): Promise<string> {
    const pasta = path.join(diretorioTemporario, categoria);

    let arquivos: string[];

    try {
      arquivos = await readdir(pasta);
    } catch {
      return '';
    }

    const arquivosDeLog = arquivos.filter((arquivo) =>
      arquivo.endsWith('.log'),
    );

    const conteudos = await Promise.all(
      arquivosDeLog.map((arquivo) =>
        readFile(path.join(pasta, arquivo), 'utf8'),
      ),
    );

    return conteudos.join('\n');
  }

  it('grava mensagens estruturadas e associa o identificador da requisição', async () => {
    const logger = criarLogger();

    logger.definirProvedorTraceId(() => 'trace-usuario-123');

    logger.log('Operação concluída', {
      modulo: 'usuarios',
      entidadeId: 'usuario-456',
    });

    await fecharLogger(logger);

    const conteudo = await lerLogs('application');
    const registro = JSON.parse(conteudo.trim());

    expect(registro.message).toBe('Operação concluída');
    expect(registro.service).toBe('apps-api');
    expect(registro.categoria).toBe('aplicacao');
    expect(registro.traceId).toBe('trace-usuario-123');
    expect(registro.timestamp).toBeDefined();

    expect(registro.parametros).toEqual([
      {
        modulo: 'usuarios',
        entidadeId: 'usuario-456',
      },
    ]);
  });

  it('remove credenciais de propriedades estruturadas antes de gravar', async () => {
    const logger = criarLogger();

    logger.log('Tentativa de operação', {
      modulo: 'auth',
      password: 'senha-super-secreta',
      accessToken: 'token-super-secreto',
      dados: {
        authorization: 'Bearer token-confidencial',
      },
    });

    await fecharLogger(logger);

    const conteudo = await lerLogs('application');
    const registro = JSON.parse(conteudo.trim());

    expect(conteudo).not.toContain('senha-super-secreta');
    expect(conteudo).not.toContain('token-super-secreto');
    expect(conteudo).not.toContain('token-confidencial');

    expect(registro.parametros[0].password).toBe('[REDACTED]');
    expect(registro.parametros[0].accessToken).toBe('[REDACTED]');

    expect(registro.parametros[0].dados.authorization).toBe(
      '[REDACTED]',
    );
  });

  it('remove credenciais presentes em mensagens de texto', async () => {
    const logger = criarLogger();

    logger.warn(
      'Falha password=senha123 access_token=token123 Bearer abcdef.ghijkl.mnopqr',
    );

    await fecharLogger(logger);

    const conteudo = await lerLogs('application');

    expect(conteudo).not.toContain('senha123');
    expect(conteudo).not.toContain('token123');
    expect(conteudo).not.toContain('abcdef.ghijkl.mnopqr');

    expect(conteudo).toContain('[REDACTED]');
    expect(conteudo).toContain('Bearer [REDACTED]');
  });

  it('registra erros no arquivo específico de erros', async () => {
    const logger = criarLogger();

    logger.error('Falha ao consultar o banco de dados', {
      modulo: 'produtos',
      password: 'senha-do-banco',
    });

    await fecharLogger(logger);

    const conteudoErros = await lerLogs('errors');
    const registro = JSON.parse(conteudoErros.trim());

    expect(registro.level).toBe('error');
    expect(registro.message).toBe(
      'Falha ao consultar o banco de dados',
    );
    expect(registro.modulo).toBeUndefined();

    expect(conteudoErros).toContain('"categoria":"aplicacao"');
    expect(conteudoErros).not.toContain('senha-do-banco');
  });

  it('separa eventos de segurança dos registros gerais', async () => {
    const logger = criarLogger();

    logger.registrarSeguranca(
      'Tentativa de login bloqueada',
      {
        modulo: 'auth',
        motivo: 'limite de tentativas excedido',
      },
      'warn',
    );

    await fecharLogger(logger);

    const conteudoSeguranca = await lerLogs('security');
    const conteudoAplicacao = await lerLogs('application');

    expect(conteudoSeguranca).toContain(
      'Tentativa de login bloqueada',
    );

    expect(conteudoSeguranca).toContain('"categoria":"seguranca"');
    expect(conteudoSeguranca).toContain('limite de tentativas excedido');

    // Eventos classificados como segurança não são duplicados no arquivo geral.
    expect(conteudoAplicacao).not.toContain(
      'Tentativa de login bloqueada',
    );
  });

  it('trata referências circulares sem interromper a gravação', async () => {
    const logger = criarLogger();

    const objeto: Record<string, unknown> = {
      modulo: 'auditoria',
    };

    // Simula uma estrutura circular recebida acidentalmente.
    objeto.referencia = objeto;

    logger.log('Estrutura recebida', objeto);

    await fecharLogger(logger);

    const conteudo = await lerLogs('application');
    const registro = JSON.parse(conteudo.trim());

    expect(registro.message).toBe('Estrutura recebida');
    expect(registro.parametros[0].referencia).toBe(
      '[CIRCULAR_REFERENCE]',
    );
  });

  it('continua registrando mensagens quando não existe contexto de rastreamento', async () => {
    const logger = criarLogger();

    logger.definirProvedorTraceId(() => null);

    logger.log('Execução fora de uma requisição HTTP');

    await fecharLogger(logger);

    const conteudo = await lerLogs('application');
    const registro = JSON.parse(conteudo.trim());

    expect(registro.message).toBe(
      'Execução fora de uma requisição HTTP',
    );

    expect(registro.traceId).toBeUndefined();
  });
});
