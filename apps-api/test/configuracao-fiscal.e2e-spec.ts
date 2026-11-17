import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  PerfilAcesso,
  ResultadoAuditoria,
} from '@prisma/client';
import * as argon2 from 'argon2';
import request from 'supertest';
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import { AppModule } from '../src/app.module.js';
import { AuditoriaService } from '../src/auditoria/auditoria.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { configurarAplicacao } from '../src/configurar-aplicacao.js';

/**
 * Testes E2E do cadastro fiscal empresarial.
 *
 * Utilizam HTTP real, JWT, guards, ValidationPipe,
 * PostgreSQL de testes e auditoria persistida.
 *
 * Nenhum documento NF-e ou NFC-e é emitido.
 */
describe('Configuração fiscal (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const empresasCriadas: string[] = [];
  const usuariosCriados: string[] = [];

  const senhaTeste = 'SenhaFiscalE2E_2026!';
  const sufixo = randomUUID().replaceAll('-', '');

  let empresaAId: string;
  let empresaBId: string;

  let adminAId: string;
  let gerenteAId: string;

  let tokenAdminA: string;
  let tokenGerenteA: string;
  let tokenAdminB: string;

  const tokensOperacionais: Array<{
    perfil: PerfilAcesso;
    token: string;
  }> = [];

  /**
   * Impede a execução contra o banco de desenvolvimento
   * ou qualquer banco diferente do E2E previsto.
   */
  function validarBancoDeTeste(): void {
    const valor = process.env.DATABASE_URL;

    if (!valor) {
      throw new Error(
        'E2E fiscal interrompido: DATABASE_URL ausente.',
      );
    }

    const url = new URL(valor);
    const banco = decodeURIComponent(url.pathname.slice(1));

    if (
      url.hostname !== '127.0.0.1' ||
      url.port !== '5435' ||
      banco !== 'gestao_test'
    ) {
      throw new Error(
        'E2E fiscal interrompido: use exclusivamente ' +
          '127.0.0.1:5435/gestao_test.',
      );
    }
  }

  /**
   * Cria uma empresa exclusiva desta suíte.
   * O identificador fica registrado para limpeza posterior.
   */
  async function criarEmpresa(rotulo: string): Promise<string> {
    const empresa = await prisma.empresa.create({
      data: {
        nome: `Empresa E2E Fiscal ${rotulo}`,
        cnpj: `E2E-FISCAL-${sufixo}-${rotulo}`,
      },
    });

    empresasCriadas.push(empresa.id);
    return empresa.id;
  }

  /**
   * Prepara um usuário de teste sem utilizar cadastros existentes.
   * A autenticação será realizada posteriormente via HTTP.
   */
  async function criarUsuario(
    empresaId: string,
    perfil: PerfilAcesso,
    hashSenha: string,
  ) {
    const usuario = await prisma.usuario.create({
      data: {
        empresaId,
        nome: `Usuário Fiscal ${perfil}`,
        email:
          `fiscal-${perfil.toLowerCase()}-${randomUUID()}@exemplo.com`,
        hashSenha,
        perfil,
        ativo: true,
      },
    });

    usuariosCriados.push(usuario.id);
    return usuario;
  }

  /** Realiza login verdadeiro pela API. */
  async function obterToken(
    empresaId: string,
    email: string,
  ): Promise<string> {
    const resposta = await request(app.getHttpServer())
      .post('/auth/login')
      .send({
        empresaId,
        email,
        senha: senhaTeste,
      })
      .expect(200);

    return resposta.body.accessToken as string;
  }

  const consultar = (token: string) =>
    request(app.getHttpServer())
      .get('/configuracao-fiscal')
      .set('Authorization', `Bearer ${token}`);

  const salvar = (
    token: string,
    corpo: Record<string, unknown>,
  ) =>
    request(app.getHttpServer())
      .patch('/configuracao-fiscal')
      .set('Authorization', `Bearer ${token}`)
      .send(corpo);

  beforeAll(async () => {
    // Valida o banco antes de inicializar a aplicação.
    validarBancoDeTeste();

    const modulo = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = modulo.createNestApplication();

    // Reproduz a configuração global usada na produção.
    configurarAplicacao(app);
    await app.init();

    prisma = app.get(PrismaService);

    const hashSenha = await argon2.hash(senhaTeste);

    empresaAId = await criarEmpresa('A');
    empresaBId = await criarEmpresa('B');

    const adminA = await criarUsuario(
      empresaAId,
      PerfilAcesso.ADMINISTRADOR,
      hashSenha,
    );

    const gerenteA = await criarUsuario(
      empresaAId,
      PerfilAcesso.GERENTE,
      hashSenha,
    );

    const adminB = await criarUsuario(
      empresaBId,
      PerfilAcesso.ADMINISTRADOR,
      hashSenha,
    );

    adminAId = adminA.id;
    gerenteAId = gerenteA.id;

    tokenAdminA = await obterToken(empresaAId, adminA.email);
    tokenGerenteA = await obterToken(
      empresaAId,
      gerenteA.email,
    );
    tokenAdminB = await obterToken(empresaBId, adminB.email);

    // Cada perfil operacional recebe uma identidade e token próprios.
    for (const perfil of [
      PerfilAcesso.CAIXA,
      PerfilAcesso.ATENDENTE,
      PerfilAcesso.GARCOM,
    ]) {
      const usuario = await criarUsuario(
        empresaAId,
        perfil,
        hashSenha,
      );

      tokensOperacionais.push({
        perfil,
        token: await obterToken(empresaAId, usuario.email),
      });
    }
  });

  afterAll(async () => {
    try {
      if (!prisma || empresasCriadas.length === 0) {
        return;
      }

      /**
       * Remove somente registros das empresas desta suíte.
       * A configuração fiscal precisa ser excluída antes
       * da empresa devido à chave estrangeira RESTRICT.
       */
      await prisma.eventoAuditoria.deleteMany({
        where: {
          OR: [
            { empresaId: { in: empresasCriadas } },
            { atorId: { in: usuariosCriados } },
          ],
        },
      });

      await prisma.configuracaoFiscalEmpresa.deleteMany({
        where: {
          empresaId: { in: empresasCriadas },
        },
      });

      await prisma.usuario.deleteMany({
        where: {
          empresaId: { in: empresasCriadas },
        },
      });

      await prisma.empresa.deleteMany({
        where: {
          id: { in: empresasCriadas },
        },
      });
    } finally {
      if (app) {
        await app.close();
      }
    }
  });

  it('deve rejeitar GET e PATCH sem autenticação', async () => {
    await request(app.getHttpServer())
      .get('/configuracao-fiscal')
      .expect(401);

    await request(app.getHttpServer())
      .patch('/configuracao-fiscal')
      .send({ uf: 'SP' })
      .expect(401);
  });

  it('deve rejeitar token inválido', async () => {
    await consultar('token-invalido').expect(401);
  });

  it('deve bloquear consulta e atualização para perfis operacionais', async () => {
    for (const { perfil, token } of tokensOperacionais) {
      const respostaConsulta = await consultar(token);
      expect(respostaConsulta.status, perfil).toBe(403);

      const respostaAtualizacao = await salvar(
        token,
        { uf: 'SP' },
      );

      expect(respostaAtualizacao.status, perfil).toBe(403);
    }
  });

  it('deve retornar null para empresa sem cadastro fiscal', async () => {
    const resposta = await consultar(tokenAdminA)
      .expect(200);

    expect(resposta.body).toEqual({ configuracao: null });
  });

  it('deve rejeitar atualização sem campos fiscais', async () => {
    await salvar(tokenAdminA, {}).expect(400);
  });

  it('deve rejeitar empresaId informado no corpo da requisição', async () => {
    await salvar(tokenAdminA, {
      empresaId: empresaBId,
      uf: 'SP',
    }).expect(400);

    // A tentativa não pode criar configuração em outra empresa.
    const configuracaoB =
      await prisma.configuracaoFiscalEmpresa.findUnique({
        where: { empresaId: empresaBId },
      });

    expect(configuracaoB).toBeNull();
  });

  it('deve rejeitar campos cadastrais com formatos inválidos', async () => {
    await salvar(tokenAdminA, { uf: 'XX' }).expect(400);
    await salvar(tokenAdminA, { cep: '123' }).expect(400);
    await salvar(tokenAdminA, {
      codigoMunicipio: '123456',
    }).expect(400);
  });

  it('deve permitir que o administrador crie a configuração da sua empresa', async () => {
    const resposta = await salvar(tokenAdminA, {
      razaoSocial: 'Empresa Fiscal A Ltda',
      uf: 'sp',
      cep: '01001000',
      codigoMunicipio: '3550308',
    }).expect(200);

    expect(resposta.body).toMatchObject({
      empresaId: empresaAId,
      razaoSocial: 'Empresa Fiscal A Ltda',
      uf: 'SP',
      cep: '01001000',
      codigoMunicipio: '3550308',
    });

    const cadastro =
      await prisma.configuracaoFiscalEmpresa.findUnique({
        where: { empresaId: empresaAId },
      });

    expect(cadastro).not.toBeNull();

    const auditoria = await prisma.eventoAuditoria.findFirst({
      where: {
        empresaId: empresaAId,
        atorId: adminAId,
        modulo: 'CONFIGURACAO_FISCAL',
        acao: 'CRIAR',
        resultado: ResultadoAuditoria.SUCESSO,
      },
    });

    expect(auditoria).not.toBeNull();
  });

  it('deve permitir atualização gerencial sem apagar campos omitidos', async () => {
    const resposta = await salvar(tokenGerenteA, {
      nomeFantasia: 'Loja Fiscal A',
      complemento: 'Sala 2',
    }).expect(200);

    expect(resposta.body).toMatchObject({
      empresaId: empresaAId,
      razaoSocial: 'Empresa Fiscal A Ltda',
      nomeFantasia: 'Loja Fiscal A',
      complemento: 'Sala 2',
      cep: '01001000',
    });

    const auditoria = await prisma.eventoAuditoria.findFirst({
      where: {
        empresaId: empresaAId,
        atorId: gerenteAId,
        modulo: 'CONFIGURACAO_FISCAL',
        acao: 'ATUALIZAR',
        resultado: ResultadoAuditoria.SUCESSO,
      },
    });

    expect(auditoria).not.toBeNull();

    // A auditoria não deve reproduzir os valores cadastrais.
    const textoAuditoria = JSON.stringify(auditoria);
    expect(textoAuditoria).not.toContain('Loja Fiscal A');
    expect(textoAuditoria).not.toContain('Sala 2');
  });

  it('deve permitir limpar um campo com null', async () => {
    const resposta = await salvar(tokenGerenteA, {
      complemento: null,
    }).expect(200);

    expect(resposta.body.complemento).toBeNull();
    expect(resposta.body.razaoSocial).toBe(
      'Empresa Fiscal A Ltda',
    );
  });

  it('deve isolar completamente as configurações das duas empresas', async () => {
    // Empresa B ainda não pode visualizar os dados da A.
    const consultaB = await consultar(tokenAdminB)
      .expect(200);

    expect(consultaB.body).toEqual({ configuracao: null });

    // O cadastro criado pela empresa B deve permanecer independente.
    await salvar(tokenAdminB, {
      razaoSocial: 'Empresa Fiscal B Ltda',
      uf: 'RJ',
    }).expect(200);

    const consultaA = await consultar(tokenAdminA)
      .expect(200);

    const novaConsultaB = await consultar(tokenAdminB)
      .expect(200);

    expect(consultaA.body).toMatchObject({
      empresaId: empresaAId,
      razaoSocial: 'Empresa Fiscal A Ltda',
      uf: 'SP',
    });

    expect(novaConsultaB.body).toMatchObject({
      empresaId: empresaBId,
      razaoSocial: 'Empresa Fiscal B Ltda',
      uf: 'RJ',
    });

    expect(consultaA.body.id).not.toBe(novaConsultaB.body.id);
  });

  it('deve reverter a criação fiscal se a auditoria falhar', async () => {
    // A empresa exclusiva evita depender dos cadastros dos outros cenários.
    const empresaId = await criarEmpresa('R');
    const hashSenha = await argon2.hash(senhaTeste);
    const admin = await criarUsuario(
      empresaId,
      PerfilAcesso.ADMINISTRADOR,
      hashSenha,
    );
    const token = await obterToken(empresaId, admin.email);

    const auditoria = app.get(AuditoriaService);
    const registrarOriginal = auditoria.registrar.bind(auditoria);
    let falhaInjetada = false;

    // Grava a auditoria de verdade e força a falha antes do commit.
    const simulacao = vi
      .spyOn(auditoria, 'registrar')
      .mockImplementation(async (entrada, transacao) => {
        const registro = await registrarOriginal(entrada, transacao);

        if (
          entrada.empresaId === empresaId &&
          entrada.modulo === 'CONFIGURACAO_FISCAL' &&
          entrada.acao === 'CRIAR' &&
          entrada.resultado === ResultadoAuditoria.SUCESSO
        ) {
          falhaInjetada = true;
          throw new Error('Falha de auditoria simulada no E2E fiscal.');
        }

        return registro;
      });

    try {
      await salvar(token, { razaoSocial: 'Empresa E2E Fiscal Rollback' })
        .expect(500);
    } finally {
      simulacao.mockRestore();
    }

    expect(falhaInjetada).toBe(true);

    // Consulta pelo Prisma fora da transação para verificar o estado persistido.
    const configuracao = await prisma.configuracaoFiscalEmpresa.findUnique({
      where: { empresaId },
    });
    const eventos = await prisma.eventoAuditoria.findMany({
      where: {
        empresaId,
        modulo: 'CONFIGURACAO_FISCAL',
        acao: 'CRIAR',
      },
      select: { resultado: true },
    });

    expect(configuracao).toBeNull();
    expect(eventos).toEqual([{ resultado: ResultadoAuditoria.FALHA }]);
  });

  it('deve registrar um único cadastro fiscal em criações simultâneas', async () => {
    const empresaId = await criarEmpresa('C');
    const hashSenha = await argon2.hash(senhaTeste);
    const admin = await criarUsuario(
      empresaId,
      PerfilAcesso.ADMINISTRADOR,
      hashSenha,
    );
    const token = await obterToken(empresaId, admin.email);

    let tentativas = 0;
    let expirou = false;
    let liberar = () => {};
    const barreira = new Promise<void>((resolver) => {
      liberar = () => resolver();
    });

    const prismaComBarreira = prisma.$extends({
      query: {
        configuracaoFiscalEmpresa: {
          async create({ args, query }) {
            if (args.data.empresaId === empresaId) {
              tentativas += 1;
              if (tentativas === 2) {
                clearTimeout(limite);
                liberar();
              }

              // As duas transações já leram a ausência do cadastro.
              await barreira;
            }

            return query(args);
          },
        },
      },
    });

    // Usa o mesmo método de transação do Prisma com a extensão deste cenário.
    const executarTransacao = prismaComBarreira.$transaction.bind(
      prismaComBarreira,
    ) as unknown as typeof prisma.$transaction;
    const desvio = vi
      .spyOn(prisma, '$transaction')
      .mockImplementation(executarTransacao);

    // Limita a espera se uma requisição falhar antes de tentar a criação.
    const limite = setTimeout(() => {
      expirou = true;
      liberar();
    }, 3_000);

    try {
      const nomes = [
        'Empresa Fiscal Concorrente A',
        'Empresa Fiscal Concorrente B',
      ];
      const respostas = await Promise.all(
        nomes.map((razaoSocial) => salvar(token, { razaoSocial })),
      );

      expect(expirou, 'As duas criações devem chegar à barreira').toBe(false);
      expect(tentativas).toBe(2);
      const status = respostas.map((resposta) => resposta.status).sort((a, b) => a - b);
      expect(status).toEqual([200, 409]);

      // Confere o cadastro que venceu e os eventos persistidos da disputa.
      const indiceVencedor = respostas.findIndex((resposta) => resposta.status === 200);
      const cadastros = await prisma.configuracaoFiscalEmpresa.findMany({
        where: { empresaId },
        select: { razaoSocial: true },
      });
      const eventos = await prisma.eventoAuditoria.findMany({
        where: { empresaId, modulo: 'CONFIGURACAO_FISCAL' },
        select: { acao: true, resultado: true },
      });

      expect(cadastros).toEqual([{ razaoSocial: nomes[indiceVencedor] }]);
      expect(eventos).toHaveLength(2);
      expect(eventos).toEqual(expect.arrayContaining([
        { acao: 'CRIAR', resultado: ResultadoAuditoria.SUCESSO },
        { acao: 'CRIAR', resultado: ResultadoAuditoria.FALHA },
      ]));
    } finally {
      clearTimeout(limite);
      liberar();
      desvio.mockRestore();
    }
  }, 12_000);
});
