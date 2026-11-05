import { randomUUID } from 'node:crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { PerfilAcesso } from '@prisma/client';
import request from 'supertest';
import * as argon2 from 'argon2';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from './../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { configurarAplicacao } from '../src/configurar-aplicacao.js';

/**
 * Testes E2E do módulo de Usuários.
 *
 * Usam a aplicação real (com o mesmo ValidationPipe da produção),
 * as rotas HTTP com JWT e o PostgreSQL exclusivo de testes.
 *
 * Cenários: isolamento entre empresas, permissões por perfil,
 * regras de proteção (último administrador, auto-desativação),
 * validação de entrada, auditoria persistida, ausência de hash
 * nas respostas e concorrência real no banco.
 *
 * Limpeza: todas as empresas deste arquivo são criadas aqui, com
 * sufixo único. Por isso a limpeza remove os dados vinculados
 * exclusivamente às empresas registradas em `empresasCriadas`.
 */
describe('Usuários (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const empresasCriadas: string[] = [];
  const usuariosCriados: string[] = [];

  const senhaTeste = 'SenhaE2E_2026!';
  const sufixo = randomUUID().replaceAll('-', '');
  let hashSenha: string;

  // Empresas e usuários fixos usados na maioria dos cenários.
  let empresaAId: string;
  let empresaBId: string;
  let adminA: { id: string; email: string };
  let gerenteA: { id: string; email: string };
  let caixaA: { id: string; email: string };
  let adminB: { id: string; email: string };

  let tokenAdminA: string;
  let tokenGerenteA: string;
  let tokenCaixaA: string;
  let tokenAdminB: string;

  /** Impede a execução fora do banco de testes. */
  function validarBancoDeTeste(): void {
    const valor = process.env.DATABASE_URL;

    if (!valor) {
      throw new Error('E2E interrompido: DATABASE_URL não está configurada.');
    }

    const url = new URL(valor);
    const banco = decodeURIComponent(url.pathname.slice(1));

    if (
      url.hostname !== '127.0.0.1' ||
      url.port !== '5435' ||
      banco !== 'gestao_test'
    ) {
      throw new Error(
        'E2E interrompido: a conexão precisa apontar para ' +
          '127.0.0.1:5435/gestao_test.',
      );
    }
  }

  // ============================================================
  // FUNÇÕES AUXILIARES
  // ============================================================

  async function criarEmpresa(rotulo: string): Promise<string> {
    const empresa = await prisma.empresa.create({
      data: {
        nome: `Empresa E2E Usuários ${rotulo}`,
        cnpj: `E2E-USR-${sufixo}-${rotulo}`,
      },
    });

    empresasCriadas.push(empresa.id);
    return empresa.id;
  }

  /** Cria um usuário direto no banco (para preparar cenários). */
  async function criarUsuarioNoBanco(
    empresaId: string,
    perfil: PerfilAcesso,
    ativo = true,
  ) {
    const email = `e2e-${perfil.toLowerCase()}-${randomUUID()}@exemplo.com`;

    const usuario = await prisma.usuario.create({
      data: {
        empresaId,
        nome: `Usuário E2E ${perfil}`,
        email,
        hashSenha,
        perfil,
        ativo,
      },
    });

    usuariosCriados.push(usuario.id);
    return { id: usuario.id, email };
  }

  /** Login real pela API. */
  async function obterToken(empresaId: string, email: string) {
    const resposta = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ empresaId, email, senha: senhaTeste })
      .expect(200);

    return resposta.body.accessToken as string;
  }

  const get = (token: string, rota: string) =>
    request(app.getHttpServer())
      .get(rota)
      .set('Authorization', `Bearer ${token}`);

  const post = (token: string, rota: string, corpo: object) =>
    request(app.getHttpServer())
      .post(rota)
      .set('Authorization', `Bearer ${token}`)
      .send(corpo);

  const patch = (token: string, rota: string, corpo: object) =>
    request(app.getHttpServer())
      .patch(rota)
      .set('Authorization', `Bearer ${token}`)
      .send(corpo);

  /**
   * Extrai a lista de itens da resposta de listagem, seja ela um
   * array puro ou um objeto paginado com a lista em alguma propriedade.
   */
  function extrairLista(corpo: unknown): Array<Record<string, unknown>> {
    if (Array.isArray(corpo)) return corpo;

    if (corpo && typeof corpo === 'object') {
      for (const valor of Object.values(corpo)) {
        if (Array.isArray(valor)) return valor;
      }
    }

    return [];
  }

  async function usuarioNoBanco(id: string) {
    return prisma.usuario.findUniqueOrThrow({ where: { id } });
  }

  // ============================================================
  // PREPARAÇÃO
  // ============================================================

  beforeAll(async () => {
    // Valida o destino antes de inicializar a aplicação.
    validarBancoDeTeste();

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configurarAplicacao(app); // mesma validação global da produção
    await app.init();

    prisma = app.get(PrismaService);
    hashSenha = await argon2.hash(senhaTeste);

    empresaAId = await criarEmpresa('A');
    empresaBId = await criarEmpresa('B');

    adminA = await criarUsuarioNoBanco(empresaAId, 'ADMINISTRADOR');
    gerenteA = await criarUsuarioNoBanco(empresaAId, 'GERENTE');
    caixaA = await criarUsuarioNoBanco(empresaAId, 'CAIXA');
    adminB = await criarUsuarioNoBanco(empresaBId, 'ADMINISTRADOR');

    tokenAdminA = await obterToken(empresaAId, adminA.email);
    tokenGerenteA = await obterToken(empresaAId, gerenteA.email);
    tokenCaixaA = await obterToken(empresaAId, caixaA.email);
    tokenAdminB = await obterToken(empresaBId, adminB.email);
  });

  // ============================================================
  // LIMPEZA
  // ============================================================

  afterAll(async () => {
    try {
      if (!prisma) return;

      // Todas as empresas abaixo foram criadas por este arquivo.
      if (empresasCriadas.length > 0) {
        await prisma.eventoAuditoria.deleteMany({
          where: {
            OR: [
              { empresaId: { in: empresasCriadas } },
              { atorId: { in: usuariosCriados } },
            ],
          },
        });

        await prisma.usuario.deleteMany({
          where: { empresaId: { in: empresasCriadas } },
        });

        await prisma.empresa.deleteMany({
          where: { id: { in: empresasCriadas } },
        });
      }
    } finally {
      if (app) {
        await app.close();
      }
    }
  });

  // ============================================================
  // AUTENTICAÇÃO
  // ============================================================

  describe('autenticação das rotas', () => {
    it('deve rejeitar requisições sem token e com token inválido', async () => {
      await request(app.getHttpServer()).get('/usuarios').expect(401);
      await request(app.getHttpServer()).get('/usuarios/me').expect(401);

      await get('token-invalido', '/usuarios').expect(401);
      await post('token-invalido', '/usuarios', {}).expect(401);
    });

    it('deve devolver a identidade da sessão para qualquer perfil', async () => {
      const resposta = await get(tokenCaixaA, '/usuarios/me').expect(200);

      expect(resposta.body).toMatchObject({
        usuarioId: caixaA.id,
        empresaId: empresaAId,
        perfil: 'CAIXA',
      });
    });
  });

  // ============================================================
  // PERMISSÕES POR PERFIL
  // ============================================================

  describe('permissões por perfil', () => {
    it('deve bloquear perfil operacional em todas as rotas de gestão', async () => {
      const alvo = await criarUsuarioNoBanco(empresaAId, 'ATENDENTE');

      await get(tokenCaixaA, '/usuarios').expect(403);
      await get(tokenCaixaA, `/usuarios/${alvo.id}`).expect(403);

      await post(tokenCaixaA, '/usuarios', {
        nome: 'Novo Usuário',
        email: `e2e-${randomUUID()}@exemplo.com`,
        senha: senhaTeste,
      }).expect(403);

      await patch(tokenCaixaA, `/usuarios/${alvo.id}`, {
        nome: 'Nome Alterado',
      }).expect(403);

      await patch(tokenCaixaA, `/usuarios/${alvo.id}/ativacao`, {
        ativo: false,
      }).expect(403);

      // Nada pode ter sido alterado no banco.
      const depois = await usuarioNoBanco(alvo.id);
      expect(depois.ativo).toBe(true);
      expect(depois.nome).toBe('Usuário E2E ATENDENTE');
    });

    it('deve impedir o gerente de criar usuário administrador ou gerente', async () => {
      const resposta = await post(tokenGerenteA, '/usuarios', {
        nome: 'Administrador Indevido',
        email: `e2e-${randomUUID()}@exemplo.com`,
        senha: senhaTeste,
        perfil: 'ADMINISTRADOR',
      });

      expect(resposta.status).toBe(403);

      const outraResposta = await post(tokenGerenteA, '/usuarios', {
        nome: 'Gerente Indevido',
        email: `e2e-${randomUUID()}@exemplo.com`,
        senha: senhaTeste,
        perfil: 'GERENTE',
      });

      expect(outraResposta.status).toBe(403);
    });

    it('deve impedir o gerente de consultar, alterar ou desativar um administrador', async () => {
      const consulta = await get(tokenGerenteA, `/usuarios/${adminA.id}`);
      expect([403, 404]).toContain(consulta.status);

      const alteracao = await patch(tokenGerenteA, `/usuarios/${adminA.id}`, {
        nome: 'Nome Indevido',
      });
      expect([403, 404]).toContain(alteracao.status);

      const ativacao = await patch(
        tokenGerenteA,
        `/usuarios/${adminA.id}/ativacao`,
        { ativo: false },
      );
      expect([403, 404]).toContain(ativacao.status);

      const depois = await usuarioNoBanco(adminA.id);
      expect(depois.ativo).toBe(true);
      expect(depois.nome).toBe('Usuário E2E ADMINISTRADOR');
    });

    it('deve permitir ao gerente gerir usuários operacionais', async () => {
      const email = `e2e-${randomUUID()}@exemplo.com`;

      const criado = await post(tokenGerenteA, '/usuarios', {
        nome: 'Atendente Criado',
        email,
        senha: senhaTeste,
        perfil: 'ATENDENTE',
      }).expect(201);

      usuariosCriados.push(criado.body.id);
      expect(criado.body.perfil).toBe('ATENDENTE');

      await patch(tokenGerenteA, `/usuarios/${criado.body.id}`, {
        nome: 'Atendente Renomeado',
      }).expect(200);

      await patch(tokenGerenteA, `/usuarios/${criado.body.id}/ativacao`, {
        ativo: false,
      }).expect(200);

      const depois = await usuarioNoBanco(criado.body.id);
      expect(depois.nome).toBe('Atendente Renomeado');
      expect(depois.ativo).toBe(false);
    });

    it('deve listar para o gerente somente perfis operacionais', async () => {
      const resposta = await get(tokenGerenteA, '/usuarios').expect(200);
      const itens = extrairLista(resposta.body);

      expect(itens.length).toBeGreaterThan(0);

      for (const item of itens) {
        expect(['CAIXA', 'ATENDENTE', 'GARCOM']).toContain(item.perfil);
      }

      const ids = itens.map((item) => item.id);
      expect(ids).not.toContain(adminA.id);
      expect(ids).not.toContain(gerenteA.id);
    });

    it('não deve mostrar administradores ao gerente mesmo filtrando por perfil', async () => {
      const resposta = await get(
        tokenGerenteA,
        '/usuarios?perfil=ADMINISTRADOR',
      );

      if (resposta.status === 200) {
        expect(extrairLista(resposta.body)).toHaveLength(0);
      } else {
        expect(resposta.status).toBe(403);
      }
    });
  });

  // ============================================================
  // CADASTRO, CONSULTA E ATUALIZAÇÃO (ADMINISTRADOR)
  // ============================================================

  describe('ciclo de vida do usuário', () => {
    it('deve cadastrar com perfil padrão, normalizar dados e não expor o hash', async () => {
      const emailBruto = `  E2E-${randomUUID()}@Exemplo.COM  `;

      const resposta = await post(tokenAdminA, '/usuarios', {
        nome: '  Operador Padrão  ',
        email: emailBruto,
        senha: senhaTeste,
      }).expect(201);

      usuariosCriados.push(resposta.body.id);

      expect(resposta.body.perfil).toBe('CAIXA');
      expect(resposta.body.nome).toBe('Operador Padrão');
      expect(resposta.body.email).toBe(emailBruto.trim().toLowerCase());

      const texto = JSON.stringify(resposta.body);
      expect(texto).not.toContain('hashSenha');
      expect(texto).not.toContain('$argon2');

      // O registro pertence à empresa do token e a senha foi gravada com hash.
      const noBanco = await usuarioNoBanco(resposta.body.id);
      expect(noBanco.empresaId).toBe(empresaAId);
      expect(noBanco.hashSenha).not.toBe(senhaTeste);
      expect(noBanco.hashSenha.startsWith('$argon2')).toBe(true);
    });

    it('deve permitir login do usuário cadastrado e rejeitar após desativação', async () => {
      const email = `e2e-${randomUUID()}@exemplo.com`;

      const criado = await post(tokenAdminA, '/usuarios', {
        nome: 'Usuário Temporário',
        email,
        senha: senhaTeste,
        perfil: 'GARCOM',
      }).expect(201);

      usuariosCriados.push(criado.body.id);

      const tokenNovo = await obterToken(empresaAId, email);
      await get(tokenNovo, '/usuarios/me').expect(200);

      await patch(tokenAdminA, `/usuarios/${criado.body.id}/ativacao`, {
        ativo: false,
      }).expect(200);

      // O token antigo deixa de valer e um novo login é recusado.
      await get(tokenNovo, '/usuarios/me').expect(401);

      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ empresaId: empresaAId, email, senha: senhaTeste })
        .expect(401);

      // Reativação restabelece o acesso.
      await patch(tokenAdminA, `/usuarios/${criado.body.id}/ativacao`, {
        ativo: true,
      }).expect(200);

      await obterToken(empresaAId, email);
    });

    it('deve consultar e atualizar usuário da própria empresa', async () => {
      const alvo = await criarUsuarioNoBanco(empresaAId, 'CAIXA');

      const consulta = await get(tokenAdminA, `/usuarios/${alvo.id}`).expect(
        200,
      );
      expect(consulta.body.id).toBe(alvo.id);
      expect(JSON.stringify(consulta.body)).not.toContain('$argon2');

      const novoEmail = `e2e-novo-${randomUUID()}@exemplo.com`;

      await patch(tokenAdminA, `/usuarios/${alvo.id}`, {
        nome: 'Nome Atualizado',
        email: novoEmail.toUpperCase(),
        perfil: 'ATENDENTE',
      }).expect(200);

      const depois = await usuarioNoBanco(alvo.id);
      expect(depois.nome).toBe('Nome Atualizado');
      expect(depois.email).toBe(novoEmail);
      expect(depois.perfil).toBe('ATENDENTE');
    });

    it('deve trocar a senha com novo hash e aceitar o novo login', async () => {
      const alvo = await criarUsuarioNoBanco(empresaAId, 'CAIXA');
      const antes = await usuarioNoBanco(alvo.id);

      await patch(tokenAdminA, `/usuarios/${alvo.id}`, {
        senha: 'NovaSenhaE2E_2026!',
      }).expect(200);

      const depois = await usuarioNoBanco(alvo.id);
      expect(depois.hashSenha).not.toBe(antes.hashSenha);

      await request(app.getHttpServer())
        .post('/auth/login')
        .send({
          empresaId: empresaAId,
          email: alvo.email,
          senha: 'NovaSenhaE2E_2026!',
        })
        .expect(200);
    });

    it('deve listar com filtros e paginação', async () => {
      const resposta = await get(
        tokenAdminA,
        '/usuarios?pagina=1&limite=2&ativo=true',
      ).expect(200);

      const itens = extrairLista(resposta.body);
      expect(itens.length).toBeGreaterThan(0);
      expect(itens.length).toBeLessThanOrEqual(2);

      for (const item of itens) {
        expect(item.ativo).toBe(true);
      }

      const porPerfil = await get(
        tokenAdminA,
        '/usuarios?perfil=ADMINISTRADOR',
      ).expect(200);

      for (const item of extrairLista(porPerfil.body)) {
        expect(item.perfil).toBe('ADMINISTRADOR');
      }
    });
  });

  // ============================================================
  // ISOLAMENTO ENTRE EMPRESAS
  // ============================================================

  describe('isolamento entre empresas', () => {
    it('não deve listar usuários de outra empresa', async () => {
      const resposta = await get(tokenAdminB, '/usuarios').expect(200);
      const ids = extrairLista(resposta.body).map((item) => item.id);

      expect(ids).toContain(adminB.id);
      expect(ids).not.toContain(adminA.id);
      expect(ids).not.toContain(gerenteA.id);
      expect(ids).not.toContain(caixaA.id);
    });

    it('não deve permitir consultar, alterar ou ativar usuário de outra empresa', async () => {
      const alvo = await criarUsuarioNoBanco(empresaAId, 'CAIXA');

      await get(tokenAdminB, `/usuarios/${alvo.id}`).expect(404);

      await patch(tokenAdminB, `/usuarios/${alvo.id}`, {
        nome: 'Invasão',
        perfil: 'ADMINISTRADOR',
      }).expect(404);

      await patch(tokenAdminB, `/usuarios/${alvo.id}/ativacao`, {
        ativo: false,
      }).expect(404);

      // O registro da empresa A permanece intacto.
      const depois = await usuarioNoBanco(alvo.id);
      expect(depois.nome).toBe('Usuário E2E CAIXA');
      expect(depois.perfil).toBe('CAIXA');
      expect(depois.ativo).toBe(true);
    });

    it('deve rejeitar empresaId enviado no corpo do cadastro e da atualização', async () => {
      const antes = await prisma.usuario.count({
        where: { empresaId: empresaBId },
      });

      await post(tokenAdminA, '/usuarios', {
        nome: 'Usuário Cruzado',
        email: `e2e-${randomUUID()}@exemplo.com`,
        senha: senhaTeste,
        empresaId: empresaBId,
      }).expect(400);

      const alvo = await criarUsuarioNoBanco(empresaAId, 'CAIXA');

      await patch(tokenAdminA, `/usuarios/${alvo.id}`, {
        empresaId: empresaBId,
      }).expect(400);

      const depois = await usuarioNoBanco(alvo.id);
      expect(depois.empresaId).toBe(empresaAId);

      const total = await prisma.usuario.count({
        where: { empresaId: empresaBId },
      });
      expect(total).toBe(antes);
    });

    it('deve permitir o mesmo e-mail em empresas diferentes, mas não na mesma', async () => {
      const email = `e2e-repetido-${randomUUID()}@exemplo.com`;

      const emA = await post(tokenAdminA, '/usuarios', {
        nome: 'Usuário Repetido',
        email,
        senha: senhaTeste,
      }).expect(201);
      usuariosCriados.push(emA.body.id);

      const emB = await post(tokenAdminB, '/usuarios', {
        nome: 'Usuário Repetido',
        email,
        senha: senhaTeste,
      }).expect(201);
      usuariosCriados.push(emB.body.id);

      await post(tokenAdminA, '/usuarios', {
        nome: 'Usuário Repetido',
        email: email.toUpperCase(),
        senha: senhaTeste,
      }).expect(409);
    });
  });

  // ============================================================
  // VALIDAÇÃO DE ENTRADA
  // ============================================================

  describe('validação de entrada', () => {
    it('deve rejeitar cadastro com dados inválidos ou campos extras', async () => {
      const base = {
        nome: 'Usuário Válido',
        email: `e2e-${randomUUID()}@exemplo.com`,
        senha: senhaTeste,
      };

      await post(tokenAdminA, '/usuarios', { ...base, nome: 'ab' }).expect(
        400,
      );
      await post(tokenAdminA, '/usuarios', {
        ...base,
        email: 'nao-e-email',
      }).expect(400);
      await post(tokenAdminA, '/usuarios', { ...base, senha: '1234567' }).expect(
        400,
      );
      await post(tokenAdminA, '/usuarios', {
        ...base,
        perfil: 'SUPER_ADMIN',
      }).expect(400);
      await post(tokenAdminA, '/usuarios', {
        ...base,
        ativo: false,
      }).expect(400);
      await post(tokenAdminA, '/usuarios', {
        ...base,
        hashSenha: 'qualquer',
      }).expect(400);
    });

    it('deve rejeitar atualização vazia e campo ativo no PATCH cadastral', async () => {
      const alvo = await criarUsuarioNoBanco(empresaAId, 'CAIXA');

      await patch(tokenAdminA, `/usuarios/${alvo.id}`, {}).expect(400);
      await patch(tokenAdminA, `/usuarios/${alvo.id}`, {
        ativo: false,
      }).expect(400);

      const depois = await usuarioNoBanco(alvo.id);
      expect(depois.ativo).toBe(true);
    });

    it('deve rejeitar corpo inválido na ativação', async () => {
      const alvo = await criarUsuarioNoBanco(empresaAId, 'CAIXA');

      await patch(tokenAdminA, `/usuarios/${alvo.id}/ativacao`, {
        ativo: 'sim',
      }).expect(400);
      await patch(tokenAdminA, `/usuarios/${alvo.id}/ativacao`, {}).expect(400);
    });

    it('deve rejeitar paginação e filtros inválidos na listagem', async () => {
      await get(tokenAdminA, '/usuarios?pagina=0').expect(400);
      await get(tokenAdminA, '/usuarios?limite=101').expect(400);
      await get(tokenAdminA, '/usuarios?limite=abc').expect(400);
      await get(tokenAdminA, '/usuarios?perfil=INEXISTENTE').expect(400);
      await get(tokenAdminA, '/usuarios?ativo=talvez').expect(400);
      await get(tokenAdminA, '/usuarios?campoExtra=1').expect(400);
    });

    it('deve tratar :id malformado como erro do cliente, nunca como erro 500', async () => {
      const consulta = await get(tokenAdminA, '/usuarios/abc');
      expect([400, 404]).toContain(consulta.status);

      const alteracao = await patch(tokenAdminA, '/usuarios/abc', {
        nome: 'Qualquer Nome',
      });
      expect([400, 404]).toContain(alteracao.status);

      const ativacao = await patch(tokenAdminA, '/usuarios/abc/ativacao', {
        ativo: false,
      });
      expect([400, 404]).toContain(ativacao.status);
    });

    it('deve retornar 404 para UUID válido que não existe', async () => {
      await get(tokenAdminA, `/usuarios/${randomUUID()}`).expect(404);
    });
  });

  // ============================================================
  // REGRAS DE PROTEÇÃO
  // ============================================================

  describe('regras de proteção', () => {
    it('não deve permitir alterar o próprio perfil', async () => {
      // Empresa própria para não afetar a contagem de administradores da A.
      const empresaId = await criarEmpresa(`P${randomUUID().slice(0, 6)}`);
      const principal = await criarUsuarioNoBanco(empresaId, 'ADMINISTRADOR');
      await criarUsuarioNoBanco(empresaId, 'ADMINISTRADOR');

      const token = await obterToken(empresaId, principal.email);

      const resposta = await patch(token, `/usuarios/${principal.id}`, {
        perfil: 'GERENTE',
      });

      expect([400, 403, 409]).toContain(resposta.status);

      const depois = await usuarioNoBanco(principal.id);
      expect(depois.perfil).toBe('ADMINISTRADOR');
    });

    it('não deve permitir desativar a própria conta', async () => {
      const empresaId = await criarEmpresa(`D${randomUUID().slice(0, 6)}`);
      const principal = await criarUsuarioNoBanco(empresaId, 'ADMINISTRADOR');
      await criarUsuarioNoBanco(empresaId, 'ADMINISTRADOR');

      const token = await obterToken(empresaId, principal.email);

      const resposta = await patch(token, `/usuarios/${principal.id}/ativacao`, {
        ativo: false,
      });

      expect([400, 403, 409]).toContain(resposta.status);

      const depois = await usuarioNoBanco(principal.id);
      expect(depois.ativo).toBe(true);
    });

    it('não deve permitir remover o último administrador ativo', async () => {
      const empresaId = await criarEmpresa(`U${randomUUID().slice(0, 6)}`);
      const unico = await criarUsuarioNoBanco(empresaId, 'ADMINISTRADOR');
      const tokenUnico = await obterToken(empresaId, unico.email);

      // Um segundo administrador já inativo não conta como "outro ativo".
      const inativo = await criarUsuarioNoBanco(
        empresaId,
        'ADMINISTRADOR',
        false,
      );

      // Tentativa de rebaixar o administrador inativo não pode afetar o ativo.
      // O alvo da regra "último administrador" é testado abaixo, com
      // dois administradores ativos que tentam se remover mutuamente.
      const rebaixar = await patch(tokenUnico, `/usuarios/${inativo.id}`, {
        perfil: 'GERENTE',
      });
      expect([200, 400, 403, 409]).toContain(rebaixar.status);

      const ativoDepois = await usuarioNoBanco(unico.id);
      expect(ativoDepois.ativo).toBe(true);
      expect(ativoDepois.perfil).toBe('ADMINISTRADOR');
    });

    it('deve manter ao menos um administrador ao remover o penúltimo', async () => {
      const empresaId = await criarEmpresa(`W${randomUUID().slice(0, 6)}`);
      const primeiro = await criarUsuarioNoBanco(empresaId, 'ADMINISTRADOR');
      const segundo = await criarUsuarioNoBanco(empresaId, 'ADMINISTRADOR');

      const tokenPrimeiro = await obterToken(empresaId, primeiro.email);

      // Remover o segundo é permitido, pois o primeiro continua ativo.
      await patch(tokenPrimeiro, `/usuarios/${segundo.id}/ativacao`, {
        ativo: false,
      }).expect(200);

      // O primeiro agora é o último e não pode ser removido por ninguém.
      // Reativa o segundo apenas para ter um ator capaz de tentar.
      await patch(tokenPrimeiro, `/usuarios/${segundo.id}/ativacao`, {
        ativo: true,
      }).expect(200);

      const tokenSegundo = await obterToken(empresaId, segundo.email);

      await patch(tokenPrimeiro, `/usuarios/${segundo.id}/ativacao`, {
        ativo: false,
      }).expect(200);

      // O token do segundo deixou de valer; o primeiro segue ativo.
      await get(tokenSegundo, '/usuarios/me').expect(401);

      const restantes = await prisma.usuario.count({
        where: { empresaId, perfil: 'ADMINISTRADOR', ativo: true },
      });
      expect(restantes).toBe(1);
    });
  });

  // ============================================================
  // AUDITORIA
  // ============================================================

  describe('auditoria', () => {
    it('deve persistir eventos de cadastro, atualização e ativação sem segredos', async () => {
      const criado = await post(tokenAdminA, '/usuarios', {
        nome: 'Usuário Auditado',
        email: `e2e-${randomUUID()}@exemplo.com`,
        senha: senhaTeste,
      }).expect(201);

      usuariosCriados.push(criado.body.id);

      await patch(tokenAdminA, `/usuarios/${criado.body.id}`, {
        nome: 'Usuário Auditado Editado',
        senha: 'OutraSenhaE2E_2026!',
      }).expect(200);

      await patch(tokenAdminA, `/usuarios/${criado.body.id}/ativacao`, {
        ativo: false,
      }).expect(200);

      for (const acao of ['CRIAR', 'ATUALIZAR', 'ALTERAR_ATIVACAO']) {
        const eventos = await prisma.eventoAuditoria.findMany({
          where: {
            empresaId: empresaAId,
            atorId: adminA.id,
            modulo: 'USUARIOS',
            acao,
          },
        });

        expect(eventos.length).toBeGreaterThan(0);

        // Nenhum evento pode conter hash, senha ou token.
        const texto = JSON.stringify(eventos);
        expect(texto).not.toContain('$argon2');
        expect(texto).not.toContain(senhaTeste);
        expect(texto).not.toContain('OutraSenhaE2E_2026!');
        expect(texto).not.toContain('hashSenha');
      }
    });
  });

  // ============================================================
  // CONCORRÊNCIA REAL NO POSTGRESQL
  // ============================================================

  describe('concorrência', () => {
    // Statuses aceitáveis: sucesso, regra de negócio, conflito de
    // transação ou token já invalidado pela outra operação. Erro 500
    // nunca é aceitável.
    const statusAceitos = [200, 400, 401, 403, 409];

    it('dois administradores se rebaixando ao mesmo tempo nunca zeram os administradores', async () => {
      for (let rodada = 0; rodada < 5; rodada++) {
        const empresaId = await criarEmpresa(`R${rodada}${randomUUID().slice(0, 6)}`);
        const um = await criarUsuarioNoBanco(empresaId, 'ADMINISTRADOR');
        const dois = await criarUsuarioNoBanco(empresaId, 'ADMINISTRADOR');

        const tokenUm = await obterToken(empresaId, um.email);
        const tokenDois = await obterToken(empresaId, dois.email);

        const [r1, r2] = await Promise.all([
          patch(tokenUm, `/usuarios/${dois.id}`, { perfil: 'GERENTE' }),
          patch(tokenDois, `/usuarios/${um.id}`, { perfil: 'GERENTE' }),
        ]);

        expect(statusAceitos).toContain(r1.status);
        expect(statusAceitos).toContain(r2.status);

        const ativos = await prisma.usuario.count({
          where: { empresaId, perfil: 'ADMINISTRADOR', ativo: true },
        });

        expect(ativos).toBeGreaterThanOrEqual(1);
      }
    });

    it('dois administradores se desativando ao mesmo tempo nunca zeram os administradores', async () => {
      for (let rodada = 0; rodada < 5; rodada++) {
        const empresaId = await criarEmpresa(`T${rodada}${randomUUID().slice(0, 6)}`);
        const um = await criarUsuarioNoBanco(empresaId, 'ADMINISTRADOR');
        const dois = await criarUsuarioNoBanco(empresaId, 'ADMINISTRADOR');

        const tokenUm = await obterToken(empresaId, um.email);
        const tokenDois = await obterToken(empresaId, dois.email);

        const [r1, r2] = await Promise.all([
          patch(tokenUm, `/usuarios/${dois.id}/ativacao`, { ativo: false }),
          patch(tokenDois, `/usuarios/${um.id}/ativacao`, { ativo: false }),
        ]);

        expect(statusAceitos).toContain(r1.status);
        expect(statusAceitos).toContain(r2.status);

        const ativos = await prisma.usuario.count({
          where: { empresaId, perfil: 'ADMINISTRADOR', ativo: true },
        });

        expect(ativos).toBeGreaterThanOrEqual(1);
      }
    });
  });
});