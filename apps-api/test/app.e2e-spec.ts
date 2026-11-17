
import { randomUUID as uuidPrimeiroAcessoE2E } from 'node:crypto';
import { randomInt as sortearRaizCnpjFiscal } from 'node:crypto';
import { AuditoriaService as AuditoriaProvisionamentoE2E } from '../src/auditoria/auditoria.service.js';
import { randomUUID } from 'node:crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import {
  Prisma,
  ResultadoAuditoria,
  TipoAtorAuditoria,
} from '@prisma/client';
import request from 'supertest';
import { App } from 'supertest/types.js';
import * as argon2 from 'argon2';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { AppModule } from './../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { configurarAplicacao } from '../src/configurar-aplicacao.js';

/**
 * Testes E2E da aplicação, autenticação, auditoria, produtos e estoque.
 *
 * Os testes utilizam:
 * - A aplicação NestJS real.
 * - As rotas HTTP protegidas por autenticação.
 * - O PostgreSQL exclusivo para testes.
 * - A consulta direta dos eventos persistidos na tabela EventoAuditoria.
 *
 * Cenários validados:
 * - Autenticação e isolamento entre empresas.
 * - Registro de auditoria em logins empresariais.
 * - Registro de auditoria em logins administrativos.
 * - Cadastro, consulta, atualização e desativação de produtos.
 * - Entrada, saída e ajustes de estoque.
 * - Bloqueio de saídas que ultrapassam o saldo disponível.
 * - Histórico paginado de movimentações.
 * - Limpeza exclusiva dos registros criados durante esta execução.
 */
describe('Aplicação, autenticação, auditoria, produtos e estoque (e2e)', () => {
  let app: INestApplication<App> | undefined;
  let prisma: PrismaService | undefined;

  // Registra somente os IDs criados por esta execução da suíte.
  const empresasCriadas: string[] = [];
  const usuariosCriados: string[] = [];
  const administradoresCriados: string[] = [];
  const produtosCriados: string[] = [];
  const vendasCriadas: string[] = [];

  /**
   * Guarda os IDs dos eventos anônimos criados diretamente
   * pelos testes, pois esses eventos não possuem atorId ou empresaId
   * em todos os cenários.
   *
   * Os demais eventos dos usuários e empresas de teste serão
   * removidos pelos respectivos identificadores de origem.
   */
  const eventosAuditoriaCriados: string[] = [];
  const empresasProvisionamentoFiscal: Array<{ cnpj: string; nome: string }> = [];

  const senhaTeste = 'SenhaE2E_2026!';

  let empresaAId: string;
  let empresaBId: string;

  let usuarioAId: string;
  let administradorPlataformaId: string;

  let usuarioAEmail: string;
  let usuarioBEmail: string;
  let administradorEmail: string;

  /**
   * Impede que os testes sejam executados contra o banco principal
   * ou contra outro servidor PostgreSQL por engano.
   */
  function validarBancoDeTeste(): void {
    const valor = process.env.DATABASE_URL;

    if (!valor) {
      throw new Error(
        'E2E interrompido: DATABASE_URL não está configurada.',
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
        'E2E interrompido: a conexão precisa apontar para ' +
          '127.0.0.1:5435/gestao_test.',
      );
    }
  }

  // ============================================================
  // PREPARAÇÃO DO AMBIENTE DE TESTES
  // ============================================================

  beforeAll(async () => {
    // Valida o destino antes de inicializar a aplicação.
    validarBancoDeTeste();

    const moduleFixture: TestingModule =
      await Test.createTestingModule({
        imports: [AppModule],
      }).compile();

    app = moduleFixture.createNestApplication();
    configurarAplicacao(app); // mesma validação global da produção
    await app.init();

    prisma = app.get(PrismaService);

    // Gera identificadores exclusivos para evitar colisões.
    const sufixo = randomUUID().replaceAll('-', '');

    usuarioAEmail = `e2e-a-${sufixo}@exemplo.com`;
    usuarioBEmail = `e2e-b-${sufixo}@exemplo.com`;
    administradorEmail = `e2e-admin-${sufixo}@exemplo.com`;

    // Cria a primeira empresa utilizada nos testes.
    const empresaA = await prisma.empresa.create({
      data: {
        nome: 'Empresa E2E A',
        cnpj: `E2E-${sufixo}-A`,
      },
    });

    empresasCriadas.push(empresaA.id);
    empresaAId = empresaA.id;

    // Cria a segunda empresa para testar o isolamento dos dados.
    const empresaB = await prisma.empresa.create({
      data: {
        nome: 'Empresa E2E B',
        cnpj: `E2E-${sufixo}-B`,
      },
    });

    empresasCriadas.push(empresaB.id);
    empresaBId = empresaB.id;

    // Gera um hash real para validar a autenticação pela API.
    const hashSenha = await argon2.hash(senhaTeste);

    // Cria um usuário vinculado à primeira empresa.
    const usuarioA = await prisma.usuario.create({
      data: {
        empresaId: empresaAId,
        nome: 'Usuário E2E A',
        email: usuarioAEmail,
        hashSenha,
        perfil: 'GERENTE',
        ativo: true,
      },
    });

    usuariosCriados.push(usuarioA.id);
    usuarioAId = usuarioA.id;

    // Cria outro usuário, vinculado à segunda empresa.
    const usuarioB = await prisma.usuario.create({
      data: {
        empresaId: empresaBId,
        nome: 'Usuário E2E B',
        email: usuarioBEmail,
        hashSenha,
        perfil: 'GERENTE',
        ativo: true,
      },
    });

    usuariosCriados.push(usuarioB.id);

    /**
     * CRIAÇÃO DO ADMINISTRADOR EXCLUSIVO DOS TESTES
     *
     * O administrador é criado diretamente no banco de testes,
     * utilizando uma senha com hash Argon2 real.
     *
     * Esse registro permite testar a rota administrativa real
     * sem depender de contas administrativas existentes no banco.
     */
    const administrador = await prisma.administradorPlataforma.create({
      data: {
        nome: 'Administrador E2E',
        email: administradorEmail,
        hashSenha,
        ativo: true,
      },
    });

    administradoresCriados.push(administrador.id);
    administradorPlataformaId = administrador.id;
  });

  // ============================================================
  // LIMPEZA DOS DADOS CRIADOS PELA SUÍTE
  // ============================================================

  afterAll(async () => {
    try {
      if (!prisma) {
        return;
      }

      // Recupera somente os provisionamentos identificados por CNPJ e nome da suíte.
      if (empresasProvisionamentoFiscal.length > 0) {
        const empresas = await prisma.empresa.findMany({
          where: { OR: empresasProvisionamentoFiscal },
          select: { id: true },
        });
        const ids = empresas.map((empresa) => empresa.id);

        if (ids.length > 0) {
          empresasCriadas.push(...ids);
          const usuarios = await prisma.usuario.findMany({
            where: { empresaId: { in: ids } },
            select: { id: true },
          });
          usuariosCriados.push(...usuarios.map((usuario) => usuario.id));
        }
      }

      /**
       * LIMPEZA DA AUDITORIA
       *
       * A tabela EventoAuditoria não possui chaves estrangeiras
       * obrigatórias para empresas e atores.
       *
       * Por isso, os eventos precisam ser removidos explicitamente
       * antes da exclusão dos registros utilizados pelos testes.
       *
       * Os filtros abaixo utilizam exclusivamente:
       * - IDs dos usuários criados pela suíte.
       * - IDs dos administradores criados pela suíte.
       * - IDs das empresas criadas pela suíte, somente para eventos
       *   anônimos de login empresarial.
       * - IDs específicos dos eventos anônimos administrativos.
       *
       * Não existe exclusão global ou remoção de auditoria preexistente.
       */
      const atoresCriados = [
        ...usuariosCriados,
        ...administradoresCriados,
      ];

      const filtrosAuditoria: Prisma.EventoAuditoriaWhereInput[] = [];

      // Remove os eventos atribuídos aos usuários e administradores de teste.
      if (atoresCriados.length > 0) {
        filtrosAuditoria.push({
          atorId: {
            in: atoresCriados,
          },
        });
      }

      /**
       * Remove somente as tentativas anônimas de login empresarial
       * relacionadas às empresas criadas por esta execução.
       *
       * Outras categorias de eventos e empresas são preservadas.
       */
      if (empresasCriadas.length > 0) {
        filtrosAuditoria.push({
          empresaId: {
            in: empresasCriadas,
          },
          atorId: null,
          tipoAtor: TipoAtorAuditoria.ANONIMO,
          modulo: 'AUTH',
          acao: 'LOGIN',
        });
      }

      // Inclui os eventos anônimos administrativos identificados individualmente.
      if (eventosAuditoriaCriados.length > 0) {
        filtrosAuditoria.push({
          id: {
            in: eventosAuditoriaCriados,
          },
        });
      }

      // Executa a limpeza somente quando existem filtros específicos.
      if (filtrosAuditoria.length > 0) {
        await prisma.eventoAuditoria.deleteMany({
          where: {
            OR: filtrosAuditoria,
          },
        });
      }

      /*
       * Remove primeiro os itens e as vendas criadas pelos testes.
       * A ordem respeita as chaves estrangeiras do banco.
       */
      if (vendasCriadas.length > 0) {
        await prisma.itemVenda.deleteMany({
          where: {
            vendaId: {
              in: vendasCriadas,
            },
          },
        });

        await prisma.venda.deleteMany({
          where: {
            id: {
              in: vendasCriadas,
            },
          },
        });
      }

      /**
       * Remove os registros dependentes antes dos produtos.
       *
       * A ordem respeita as chaves estrangeiras:
       * 1. Movimentações de estoque.
       * 2. Saldos de estoque.
       * 3. Produtos.
       * 4. Usuários.
       * 5. Administradores.
       * 6. Empresas.
       *
       * Os filtros utilizam exclusivamente os IDs registrados
       * pelos testes desta execução.
       */
      if (produtosCriados.length > 0) {
        const filtroProdutos = {
          produtoId: {
            in: produtosCriados,
          },
        };

        // Remove os recebimentos da empresa de teste antes das movimentações.
        await prisma.itemRecebimentoCompra.deleteMany({
          where: { empresaId: empresaAId },
        });
        await prisma.recebimentoCompra.deleteMany({
          where: { empresaId: empresaAId },
        });

        // 1. Remove as movimentações relacionadas aos produtos de teste.
        await prisma.movimentacaoLoteEstoque.deleteMany({
          where: filtroProdutos,
        });
        await prisma.loteEstoque.deleteMany({
          where: filtroProdutos,
        });
        await prisma.movimentacaoEstoque.deleteMany({
          where: filtroProdutos,
        });

        // 2. Remove os respectivos saldos de estoque.
        await prisma.saldoEstoque.deleteMany({
          where: filtroProdutos,
        });

        // 3. Remove os produtos depois de seus registros dependentes.
        await prisma.produto.deleteMany({
          where: {
            id: {
              in: produtosCriados,
            },
          },
        });
      }

      // 4. Remove somente os usuários criados pela suíte.
      if (usuariosCriados.length > 0) {
        await prisma.usuario.deleteMany({
          where: {
            id: {
              in: usuariosCriados,
            },
          },
        });
      }

      // 5. Remove o administrador temporário criado para os testes.
      if (administradoresCriados.length > 0) {
        await prisma.administradorPlataforma.deleteMany({
          where: {
            id: {
              in: administradoresCriados,
            },
          },
        });
      }

      // 6. Remove as empresas criadas durante esta execução.
      if (empresasCriadas.length > 0) {
        // A configuração fiscal deve ser removida antes da empresa.
        await prisma.configuracaoFiscalEmpresa.deleteMany({
          where: { empresaId: { in: empresasCriadas } },
        });

        await prisma.empresa.deleteMany({
          where: {
            id: {
              in: empresasCriadas,
            },
          },
        });
      }
    } finally {
      // Fecha a aplicação mesmo se ocorrer um erro durante a limpeza.
      if (app) {
        await app.close();
      }
    }
  });

  // ============================================================
  // FUNÇÕES AUXILIARES
  // ============================================================

  /**
   * Realiza o login pela rota HTTP e devolve o token de acesso.
   */
  async function obterToken(
    empresaId: string,
    email: string,
  ): Promise<string> {
    const resposta = await request(app!.getHttpServer())
      .post('/auth/login')
      .send({
        empresaId,
        email,
        senha: senhaTeste,
      })
      .expect(200);

    expect(resposta.body.accessToken).toEqual(
      expect.any(String),
    );

    return resposta.body.accessToken as string;
  }

  /**
   * Cadastra um produto pela API e registra seu ID para limpeza.
   *
   * A empresa é definida pelo servidor a partir do token autenticado.
   * O saldo inicial criado pelo serviço deve começar em zero quando
   * nenhuma quantidade inicial é informada.
   */
  async function criarProdutoPelaApi(
    token: string,
    nome = 'Produto E2E',
  ) {
    const resposta = await request(app!.getHttpServer())
      .post('/produtos')
      .set('Authorization', `Bearer ${token}`)
      .send({
        nome,
        sku: `E2E-${randomUUID()}`,
        preco: 10.5,
        custo: 7.25,
      })
      .expect(201);

    // Registra o ID somente depois que a API confirma o cadastro.
    produtosCriados.push(resposta.body.id);

    return resposta.body;
  }

  /**
   * Consulta um produto pela API usando o token da empresa responsável.
   */
  async function consultarProduto(
    token: string,
    produtoId: string,
  ) {
    return request(app!.getHttpServer())
      .get(`/produtos/${produtoId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
  }

  /**
   * Prepara uma requisição de movimentação de estoque pela API.
   *
   * A função retorna diretamente o objeto do Supertest para permitir
   * encadear .expect(201), .expect(400), .expect(404) e outras
   * verificações de resposta nos testes.
   *
   * O tipo, a quantidade e o motivo são enviados pelo corpo da
   * requisição. A empresa e o usuário vêm do token autenticado.
   */
  function movimentarEstoquePelaApi(
    token: string,
    produtoId: string,
    dados: {
      tipo: 'ENTRADA' | 'SAIDA' | 'AJUSTE';
      quantidade: number;
      motivo: string;
      referenciaId?: string;
      validadeEm?: string;
      codigoLote?: string;
    },
  ) {
    return request(app!.getHttpServer())
      .post(`/produtos/${produtoId}/movimentacoes`)
      .set('Authorization', `Bearer ${token}`)
      .send(dados);
  }

  /**
   * Envia uma venda pela API com o usuário autenticado.
   *
   * O backend deve calcular preços e total a partir do cadastro.
   */
  function criarVendaPelaApi(
    token: string,
    dados: {
      formaPagamento:
        | 'DINHEIRO'
        | 'PIX'
        | 'CARTAO_DEBITO'
        | 'CARTAO_CREDITO'
        | 'OUTRO';
      itens: Array<{
        produtoId: string;
        quantidade: number;
      }>;
    },
  ) {
    return request(app!.getHttpServer())
      .post('/vendas')
      .set('Authorization', `Bearer ${token}`)
      .send(dados);
  }

  /**
   * Consulta o evento mais recente que corresponde aos filtros fornecidos.
   *
   * É utilizado pelos testes para conferir a persistência real da auditoria,
   * sem depender somente de mocks do serviço.
   */
  async function buscarEventoAuditoria(
    where: Prisma.EventoAuditoriaWhereInput,
  ) {
    return prisma!.eventoAuditoria.findFirst({
      where,
      orderBy: {
        criadoEm: 'desc',
      },
    });
  }

  // ============================================================
  // APLICAÇÃO E AUTENTICAÇÃO
  // ============================================================

  it('GET / deve retornar a mensagem inicial da aplicação', async () => {
    await request(app!.getHttpServer())
      .get('/')
      .expect(200)
      .expect('Hello World!');
  });

  it('deve autenticar um usuário e consultar sua identidade', async () => {
    const token = await obterToken(
      empresaAId,
      usuarioAEmail,
    );

    const respostaUsuario = await request(app!.getHttpServer())
      .get('/usuarios/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(respostaUsuario.body).toEqual({
      usuarioId: expect.any(String),
      empresaId: empresaAId,
      perfil: 'GERENTE',
    });
  });

  it('deve autenticar a segunda empresa sem misturar as identidades', async () => {
    const token = await obterToken(
      empresaBId,
      usuarioBEmail,
    );

    const respostaUsuario = await request(app!.getHttpServer())
      .get('/usuarios/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(respostaUsuario.body.empresaId).toBe(empresaBId);
    expect(respostaUsuario.body.empresaId).not.toBe(empresaAId);
  });

  // ============================================================
  // AUDITORIA REAL DE AUTENTICAÇÃO
  // ============================================================

  /**
   * Confirma que um login empresarial realizado pela API
   * gera um evento persistido no PostgreSQL.
   *
   * O evento deve identificar o usuário e sua empresa,
   * utilizar USUARIO_EMPRESA e possuir resultado SUCESSO.
   */
  it('deve persistir auditoria após login empresarial bem-sucedido', async () => {
    const inicio = new Date();

    const resposta = await request(app!.getHttpServer())
      .post('/auth/login')
      .send({
        empresaId: empresaAId,
        email: usuarioAEmail,
        senha: senhaTeste,
      })
      .expect(200);

    expect(resposta.body.accessToken).toEqual(
      expect.any(String),
    );

    // Consulta diretamente a tabela EventoAuditoria.
    const evento = await buscarEventoAuditoria({
      empresaId: empresaAId,
      atorId: usuarioAId,
      tipoAtor: TipoAtorAuditoria.USUARIO_EMPRESA,
      modulo: 'AUTH',
      acao: 'LOGIN',
      resultado: ResultadoAuditoria.SUCESSO,
      criadoEm: {
        gte: inicio,
      },
    });

    expect(evento).not.toBeNull();

    expect(evento).toMatchObject({
      empresaId: empresaAId,
      atorId: usuarioAId,
      tipoAtor: TipoAtorAuditoria.USUARIO_EMPRESA,
      modulo: 'AUTH',
      acao: 'LOGIN',
      resultado: ResultadoAuditoria.SUCESSO,
    });

    // Registra o ID para limpeza explícita ao final da suíte.
    eventosAuditoriaCriados.push(evento!.id);
  });

  /**
   * Confirma que uma senha incorreta gera um evento anônimo de falha.
   *
   * A tentativa não pode ser atribuída ao usuário, pois a autenticação
   * não foi concluída.
   *
   * O evento pode conter empresaId como referência informada na tentativa,
   * mas não pode conter atorId.
   */
  it('deve persistir auditoria anônima após falha no login empresarial', async () => {
    const inicio = new Date();

    await request(app!.getHttpServer())
      .post('/auth/login')
      .send({
        empresaId: empresaAId,
        email: usuarioAEmail,
        senha: 'SenhaIncorreta_E2E!',
      })
      .expect(401);

    // Busca somente o evento anônimo de falha criado neste cenário.
    const evento = await buscarEventoAuditoria({
      empresaId: empresaAId,
      atorId: null,
      tipoAtor: TipoAtorAuditoria.ANONIMO,
      modulo: 'AUTH',
      acao: 'LOGIN',
      resultado: ResultadoAuditoria.FALHA,
      criadoEm: {
        gte: inicio,
      },
    });

    expect(evento).not.toBeNull();

    expect(evento).toMatchObject({
      empresaId: empresaAId,
      atorId: null,
      tipoAtor: TipoAtorAuditoria.ANONIMO,
      modulo: 'AUTH',
      acao: 'LOGIN',
      resultado: ResultadoAuditoria.FALHA,
      motivo: 'Tentativa de autenticação recusada.',
    });

    // Confirma que dados de autenticação não foram gravados no evento.
    const conteudoEvento = JSON.stringify(evento);

    expect(conteudoEvento).not.toContain(usuarioAEmail);
    expect(conteudoEvento).not.toContain('SenhaIncorreta_E2E!');

    // Registra o evento para limpeza e evita acumular dados de teste.
    eventosAuditoriaCriados.push(evento!.id);
  });

  /**
   * Confirma que o login administrativo gera um evento persistido
   * com o administrador real já validado.
   *
   * O evento não deve possuir empresaId porque o administrador
   * pertence ao contexto global da plataforma.
   */
  it('deve persistir auditoria após login administrativo bem-sucedido', async () => {
    const inicio = new Date();

    const resposta = await request(app!.getHttpServer())
      .post('/admin-plataforma/login')
      .send({
        email: administradorEmail,
        senha: senhaTeste,
      })
      .expect(200);

    expect(resposta.body.accessToken).toEqual(
      expect.any(String),
    );

    const evento = await buscarEventoAuditoria({
      empresaId: null,
      atorId: administradorPlataformaId,
      tipoAtor: TipoAtorAuditoria.ADMIN_PLATAFORMA,
      modulo: 'ADMIN_PLATAFORMA',
      acao: 'LOGIN',
      resultado: ResultadoAuditoria.SUCESSO,
      criadoEm: {
        gte: inicio,
      },
    });

    expect(evento).not.toBeNull();

    expect(evento).toMatchObject({
      empresaId: null,
      atorId: administradorPlataformaId,
      tipoAtor: TipoAtorAuditoria.ADMIN_PLATAFORMA,
      modulo: 'ADMIN_PLATAFORMA',
      acao: 'LOGIN',
      resultado: ResultadoAuditoria.SUCESSO,
    });

    eventosAuditoriaCriados.push(evento!.id);
  });

  /**
   * Confirma que uma tentativa administrativa recusada gera
   * um evento anônimo de falha, sem vínculo com empresa ou ator.
   *
   * Como eventos anônimos administrativos não possuem empresaId
   * nem atorId, o teste captura os IDs existentes antes da tentativa
   * e identifica exclusivamente o novo evento criado.
   *
   * Isso evita remover eventos administrativos preexistentes.
   */
  it('deve persistir auditoria anônima após falha no login administrativo', async () => {
    const filtroEvento = {
      empresaId: null,
      atorId: null,
      tipoAtor: TipoAtorAuditoria.ANONIMO,
      modulo: 'ADMIN_PLATAFORMA',
      acao: 'LOGIN',
      resultado: ResultadoAuditoria.FALHA,
    };

    // Guarda os IDs existentes antes da tentativa.
    const eventosAntes = await prisma!.eventoAuditoria.findMany({
      where: filtroEvento,
      select: {
        id: true,
      },
    });

    const idsAnteriores = new Set(
      eventosAntes.map((evento) => evento.id),
    );

    const inicio = new Date();

    await request(app!.getHttpServer())
      .post('/admin-plataforma/login')
      .send({
        email: administradorEmail,
        senha: 'SenhaIncorreta_Admin_E2E!',
      })
      .expect(401);

    // Consulta os eventos criados depois do início desta tentativa.
    const eventosDepois = await prisma!.eventoAuditoria.findMany({
      where: {
        ...filtroEvento,
        criadoEm: {
          gte: inicio,
        },
      },
      select: {
        id: true,
      },
    });

    // Identifica somente os IDs que não existiam antes do teste.
    const novosEventos = eventosDepois.filter(
      (evento) => !idsAnteriores.has(evento.id),
    );

    // Uma única tentativa deve gerar exatamente um novo evento.
    expect(novosEventos).toHaveLength(1);

    const eventoId = novosEventos[0].id;

    // Guarda o identificador para limpeza segura no afterAll.
    eventosAuditoriaCriados.push(eventoId);

    // Consulta o evento completo para conferir todos os campos.
    const evento = await prisma!.eventoAuditoria.findUnique({
      where: {
        id: eventoId,
      },
    });

    expect(evento).not.toBeNull();

    expect(evento).toMatchObject({
      empresaId: null,
      atorId: null,
      tipoAtor: TipoAtorAuditoria.ANONIMO,
      modulo: 'ADMIN_PLATAFORMA',
      acao: 'LOGIN',
      resultado: ResultadoAuditoria.FALHA,
      motivo: 'Tentativa de autenticação recusada.',
    });

    // Confirma que nenhum dado da credencial foi armazenado.
    const conteudoEvento = JSON.stringify(evento);

    expect(conteudoEvento).not.toContain(administradorEmail);
    expect(conteudoEvento).not.toContain(
      'SenhaIncorreta_Admin_E2E!',
    );
  });

  it('deve rejeitar um token quando o vínculo do usuário muda', async () => {
    // Cria um usuário isolado para este cenário.
    const sufixo = randomUUID().replaceAll('-', '');
    const email = `e2e-vinculo-${sufixo}@exemplo.com`;
    const hashSenha = await argon2.hash(senhaTeste);

    const usuario = await prisma!.usuario.create({
      data: {
        empresaId: empresaAId,
        nome: 'Usuário E2E para teste de vínculo',
        email,
        hashSenha,
        perfil: 'GERENTE',
        ativo: true,
      },
    });

    usuariosCriados.push(usuario.id);

    // Emite o token enquanto o usuário pertence à empresa A.
    const token = await obterToken(empresaAId, email);

    // Simula a alteração do vínculo no banco de testes.
    await prisma!.usuario.update({
      where: {
        id: usuario.id,
      },
      data: {
        empresaId: empresaBId,
      },
    });

    // O guard deve detectar a divergência e rejeitar o token.
    await request(app!.getHttpServer())
      .get('/usuarios/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(401);
  });

  // ============================================================
  // CADASTRO E CONSULTA DE PRODUTOS
  // ============================================================

  it('deve cadastrar produto vinculado à empresa autenticada', async () => {
    const token = await obterToken(
      empresaAId,
      usuarioAEmail,
    );

    const produto = await criarProdutoPelaApi(
      token,
      'Produto E2E Empresa A',
    );

    expect(produto.id).toEqual(expect.any(String));
    expect(produto.nome).toBe('Produto E2E Empresa A');
    expect(produto.empresaId).toBe(empresaAId);
    expect(produto.sku).toMatch(/^E2E-/);
  });

  it('deve listar produtos sem expor produtos de outra empresa', async () => {
    const tokenA = await obterToken(
      empresaAId,
      usuarioAEmail,
    );

    const tokenB = await obterToken(
      empresaBId,
      usuarioBEmail,
    );

    const produtoA = await criarProdutoPelaApi(
      tokenA,
      'Produto privado da empresa A',
    );

    const listagemA = await request(app!.getHttpServer())
      .get('/produtos')
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);

    const listagemB = await request(app!.getHttpServer())
      .get('/produtos')
      .set('Authorization', `Bearer ${tokenB}`)
      .expect(200);

    // O produto deve estar visível à própria empresa.
    expect(
      listagemA.body.dados.map(
        (produto: { id: string }) => produto.id,
      ),
    ).toContain(produtoA.id);

    // O produto não pode aparecer na listagem da outra empresa.
    expect(
      listagemB.body.dados.map(
        (produto: { id: string }) => produto.id,
      ),
    ).not.toContain(produtoA.id);
  });

  it('deve impedir que uma empresa consulte ou atualize produto de outra', async () => {
    const tokenA = await obterToken(
      empresaAId,
      usuarioAEmail,
    );

    const tokenB = await obterToken(
      empresaBId,
      usuarioBEmail,
    );

    const produtoA = await criarProdutoPelaApi(
      tokenA,
      'Produto protegido da empresa A',
    );

    // O produto existe, mas não deve ser acessível à empresa B.
    await request(app!.getHttpServer())
      .get(`/produtos/${produtoA.id}`)
      .set('Authorization', `Bearer ${tokenB}`)
      .expect(404);

    // A empresa B também não pode modificar o produto da empresa A.
    await request(app!.getHttpServer())
      .patch(`/produtos/${produtoA.id}`)
      .set('Authorization', `Bearer ${tokenB}`)
      .send({
        nome: 'Tentativa de alteração não autorizada',
      })
      .expect(404);
  });

  // ============================================================
  // ATUALIZAÇÃO E DESATIVAÇÃO DE PRODUTOS
  // ============================================================

  it('deve atualizar e desativar produto da própria empresa', async () => {
    const token = await obterToken(
      empresaAId,
      usuarioAEmail,
    );

    const produto = await criarProdutoPelaApi(
      token,
      'Produto E2E para atualização',
    );

    const atualizacao = await request(app!.getHttpServer())
      .patch(`/produtos/${produto.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        nome: 'Produto E2E atualizado',
        preco: 12.5,
      })
      .expect(200);

    expect(atualizacao.body.nome).toBe('Produto E2E atualizado');
    expect(atualizacao.body.empresaId).toBe(empresaAId);

    const desativacao = await request(app!.getHttpServer())
      .patch(`/produtos/${produto.id}/ativacao`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        ativo: false,
      })
      .expect(200);

    expect(desativacao.body.ativo).toBe(false);
    expect(desativacao.body.empresaId).toBe(empresaAId);
  });

  // ============================================================
  // MOVIMENTAÇÕES DE ESTOQUE
  // ============================================================

  it('deve registrar uma entrada e aumentar o saldo do produto', async () => {
    const token = await obterToken(
      empresaAId,
      usuarioAEmail,
    );

    const produto = await criarProdutoPelaApi(
      token,
      'Produto E2E para entrada',
    );

    const resposta = await movimentarEstoquePelaApi(
      token,
      produto.id,
      {
        tipo: 'ENTRADA',
        quantidade: 10,
        motivo: 'Recebimento de mercadorias',
        referenciaId: 'NF-E2E-001',
      },
    ).expect(201);

    // Confirma o tipo, a quantidade, o saldo e a auditoria operacional.
    expect(resposta.body.tipo).toBe('ENTRADA');
    expect(Number(resposta.body.quantidade)).toBe(10);
    expect(Number(resposta.body.saldoApos)).toBe(10);
    expect(resposta.body.motivo).toBe(
      'Recebimento de mercadorias',
    );
    expect(resposta.body.usuarioId).toBeDefined();

    expect(
      Number(resposta.body.saldoEstoque.quantidadeDisponivel),
    ).toBe(10);

    // Confirma que a referência opcional foi preservada.
    expect(resposta.body.referenciaId).toBe('NF-E2E-001');
  });

  it('deve registrar uma saída e reduzir o saldo disponível', async () => {
    const token = await obterToken(
      empresaAId,
      usuarioAEmail,
    );

    const produto = await criarProdutoPelaApi(
      token,
      'Produto E2E para saída',
    );

    // Inicializa o saldo com dez unidades.
    await movimentarEstoquePelaApi(
      token,
      produto.id,
      {
        tipo: 'ENTRADA',
        quantidade: 10,
        motivo: 'Entrada para teste de saída',
      },
    ).expect(201);

    // Retira quatro unidades do saldo disponível.
    const resposta = await movimentarEstoquePelaApi(
      token,
      produto.id,
      {
        tipo: 'SAIDA',
        quantidade: 4,
        motivo: 'Consumo de teste',
      },
    ).expect(201);

    expect(resposta.body.tipo).toBe('SAIDA');
    expect(Number(resposta.body.quantidade)).toBe(4);
    expect(Number(resposta.body.saldoApos)).toBe(6);

    expect(
      Number(resposta.body.saldoEstoque.quantidadeDisponivel),
    ).toBe(6);
  });

  it('deve aplicar ajustes positivos e negativos ao estoque', async () => {
    const token = await obterToken(
      empresaAId,
      usuarioAEmail,
    );

    const produto = await criarProdutoPelaApi(
      token,
      'Produto E2E para ajustes',
    );

    // Cria um saldo de dez unidades para o teste de inventário.
    await movimentarEstoquePelaApi(
      token,
      produto.id,
      {
        tipo: 'ENTRADA',
        quantidade: 10,
        motivo: 'Preparação do teste de inventário',
      },
    ).expect(201);

    // Ajuste negativo: reduz o saldo em três unidades.
    const ajusteNegativo = await movimentarEstoquePelaApi(
      token,
      produto.id,
      {
        tipo: 'AJUSTE',
        quantidade: -3,
        motivo: 'Correção negativa do inventário',
      },
    ).expect(201);

    expect(ajusteNegativo.body.tipo).toBe('AJUSTE');
    expect(Number(ajusteNegativo.body.quantidade)).toBe(-3);
    expect(Number(ajusteNegativo.body.saldoApos)).toBe(7);

    // Ajuste positivo: acrescenta duas unidades ao saldo restante.
    const ajustePositivo = await movimentarEstoquePelaApi(
      token,
      produto.id,
      {
        tipo: 'AJUSTE',
        quantidade: 2,
        motivo: 'Correção positiva do inventário',
      },
    ).expect(201);

    expect(ajustePositivo.body.tipo).toBe('AJUSTE');
    expect(Number(ajustePositivo.body.quantidade)).toBe(2);
    expect(Number(ajustePositivo.body.saldoApos)).toBe(9);

    expect(
      Number(ajustePositivo.body.saldoEstoque.quantidadeDisponivel),
    ).toBe(9);
  });

  it('deve impedir saída superior ao saldo e preservar o estoque', async () => {
    const token = await obterToken(
      empresaAId,
      usuarioAEmail,
    );

    const produto = await criarProdutoPelaApi(
      token,
      'Produto E2E para saldo insuficiente',
    );

    // O produto começa com saldo zero.
    await movimentarEstoquePelaApi(
      token,
      produto.id,
      {
        tipo: 'SAIDA',
        quantidade: 1,
        motivo: 'Tentativa de saída sem saldo',
      },
    ).expect(400);

    // Consulta o produto e confirma que o saldo não mudou.
    const consulta = await consultarProduto(token, produto.id);

    expect(
      Number(consulta.body.saldoEstoque.quantidadeDisponivel),
    ).toBe(0);

    // A saída rejeitada não deve gerar uma movimentação.
    const historico = await request(app!.getHttpServer())
      .get(`/produtos/${produto.id}/movimentacoes`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(historico.body.total).toBe(0);
    expect(historico.body.dados).toHaveLength(0);
  });

  it('deve listar o histórico de movimentações com paginação', async () => {
    const token = await obterToken(
      empresaAId,
      usuarioAEmail,
    );

    const produto = await criarProdutoPelaApi(
      token,
      'Produto E2E para histórico',
    );

    // Registra a primeira operação de entrada.
    await movimentarEstoquePelaApi(
      token,
      produto.id,
      {
        tipo: 'ENTRADA',
        quantidade: 5,
        motivo: 'Primeiro recebimento',
      },
    ).expect(201);

    // Registra uma saída para gerar um segundo evento no histórico.
    await movimentarEstoquePelaApi(
      token,
      produto.id,
      {
        tipo: 'SAIDA',
        quantidade: 2,
        motivo: 'Saída de teste',
      },
    ).expect(201);

    // Solicita um registro por página.
    const resposta = await request(app!.getHttpServer())
      .get(`/produtos/${produto.id}/movimentacoes?pagina=1&limite=1`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(resposta.body.total).toBe(2);
    expect(resposta.body.pagina).toBe(1);
    expect(resposta.body.limite).toBe(1);
    expect(resposta.body.totalPaginas).toBe(2);
    expect(resposta.body.dados).toHaveLength(1);

    // Confirma que o histórico inclui informações de auditoria operacional.
    expect(resposta.body.dados[0]).toEqual(
      expect.objectContaining({
        empresaId: empresaAId,
        produtoId: produto.id,
        tipo: expect.any(String),
        motivo: expect.any(String),
        usuarioId: expect.any(String),
      }),
    );
  });

  // ============================================================
  // VENDAS
  // ============================================================

  it('deve baixar dois lotes por ordem de validade e preservar o saldo total', async () => {
    const token = await obterToken(empresaAId, usuarioAEmail);
    const produto = await criarProdutoPelaApi(
      token,
      'Produto E2E com dois lotes',
    );
    const escopo = { empresaId: empresaAId, produtoId: produto.id };

    await movimentarEstoquePelaApi(token, produto.id, {
      tipo: 'ENTRADA',
      quantidade: 1,
      motivo: 'Teste de validade inválida',
      validadeEm: '2026-02-30',
    }).expect(400);

    const primeiraEntrada = await movimentarEstoquePelaApi(token, produto.id, {
      tipo: 'ENTRADA',
      quantidade: 6,
      motivo: 'Primeiro recebimento',
      codigoLote: 'LOTE-6',
      validadeEm: '2099-12-20',
    }).expect(201);

    const segundaEntrada = await movimentarEstoquePelaApi(token, produto.id, {
      tipo: 'ENTRADA',
      quantidade: 4,
      motivo: 'Segundo recebimento',
      codigoLote: 'LOTE-4',
      validadeEm: '2099-12-10',
    }).expect(201);

    const primeiroLote = await prisma!.movimentacaoLoteEstoque.findFirstOrThrow({
      where: { ...escopo, movimentacaoId: primeiraEntrada.body.id },
      include: { lote: true },
    });
    const segundoLote = await prisma!.movimentacaoLoteEstoque.findFirstOrThrow({
      where: { ...escopo, movimentacaoId: segundaEntrada.body.id },
      include: { lote: true },
    });

    expect(primeiroLote.loteId).not.toBe(segundoLote.loteId);
    expect(primeiroLote.lote.entradaEm).toBeInstanceOf(Date);
    expect(segundoLote.lote.entradaEm).toBeInstanceOf(Date);
    expect(primeiroLote.lote.quantidadeRestante.toString()).toBe('6');
    expect(segundoLote.lote.quantidadeRestante.toString()).toBe('4');

    expect(primeiroLote.lote.codigoLote).toBe('LOTE-6');
    expect(segundoLote.lote.codigoLote).toBe('LOTE-4');
    expect(primeiroLote.lote.validadeEm?.toISOString()).toBe(
      '2099-12-20T00:00:00.000Z',
    );
    expect(segundoLote.lote.validadeEm?.toISOString()).toBe(
      '2099-12-10T00:00:00.000Z',
    );

    const venda = await criarVendaPelaApi(token, {
      formaPagamento: 'PIX',
      itens: [{ produtoId: produto.id, quantidade: 7 }],
    }).expect(201);
    vendasCriadas.push(venda.body.id);

    expect(venda.body.itens).toHaveLength(1);
    expect(venda.body.itens[0].quantidade).toBe(7);

    const saida = await prisma!.movimentacaoEstoque.findFirstOrThrow({
      where: { ...escopo, referenciaId: venda.body.id, tipo: 'SAIDA' },
      include: { lotes: true },
    });
    expect(saida.quantidade.toString()).toBe('7');
    expect(saida.saldoApos.toString()).toBe('3');
    expect(saida.lotes).toHaveLength(2);
    expect(Object.fromEntries(
      saida.lotes.map((alocacao) => [
        alocacao.loteId,
        alocacao.quantidade.toString(),
      ]),
    )).toEqual({
      [primeiroLote.loteId]: '3',
      [segundoLote.loteId]: '4',
    });

    const lotes = await prisma!.loteEstoque.findMany({ where: escopo });
    expect(lotes).toHaveLength(2);
    const lotesPorId = new Map(lotes.map((lote) => [lote.id, lote]));
    expect(lotesPorId.get(primeiroLote.loteId)?.quantidadeRestante.toString()).toBe('3');
    expect(lotesPorId.get(segundoLote.loteId)?.quantidadeRestante.toString()).toBe('0');
    expect(lotesPorId.get(primeiroLote.loteId)?.entradaEm).toEqual(primeiroLote.lote.entradaEm);
    expect(lotesPorId.get(segundoLote.loteId)?.entradaEm).toEqual(segundoLote.lote.entradaEm);

    const saldo = await prisma!.saldoEstoque.findFirstOrThrow({ where: escopo });
    const somaDosLotes = lotes.reduce(
      (total, lote) => total.plus(lote.quantidadeRestante),
      saldo.quantidadeDisponivel.minus(saldo.quantidadeDisponivel),
    );
    expect(saldo.quantidadeDisponivel.toString()).toBe('3');
    expect(somaDosLotes.toString()).toBe(saldo.quantidadeDisponivel.toString());
  });


  it('cadastro automático de produtos a partir de nota extraída', async () => {
    const token = await obterToken(empresaAId, usuarioAEmail);
    const sufixo = randomUUID().replaceAll('-', '').slice(0, 12);
    const prefixo = `NOTA-E2E-${sufixo}-`;
    const fornecedorCnpj = '99887766000155';
    const numeroNota = String(
      BigInt('0x' + randomUUID().replaceAll('-', '')) %
        900000000n + 100000000n,
    );

    const cnpjDestinatario = (
      BigInt('0x' + randomUUID().replaceAll('-', '')) %
      100000000000000n
    ).toString().padStart(14, '0');

    const empresaOriginal = await prisma!.empresa.findUniqueOrThrow({
      where: { id: empresaAId },
      select: { cnpj: true },
    });

    const unidadeAnterior = await prisma!.unidade.findFirst({
      where: { empresaId: empresaAId, codigo: 'UN' },
      select: { id: true },
    });

    const arquivosCriados: string[] = [];

    try {
      await prisma!.empresa.update({
        where: { id: empresaAId },
        data: { cnpj: cnpjDestinatario },
      });

      const arquivo = await prisma!.arquivoNotaCompra.create({
        data: {
          empresaId: empresaAId,
          nomeOriginal: `${prefixo}teste.pdf`,
          sha256: randomUUID().replaceAll('-', '').repeat(2),
          tamanhoBytes: 100,
          status: 'AGUARDANDO_CONFERENCIA',
          extracao: {
            fornecedorNome: 'Fornecedor E2E Automático',
            fornecedorCnpj,
            destinatarioCnpj: cnpjDestinatario,
            serieNota: '1',
            numeroNota,
            itens: [
              {
                descricaoNota: `${prefixo}Produto A`,
                codigoFornecedor: 'E2EA',
                quantidadeNota: '12.000',
                unidadeNota: 'UN',
                valorTotalItemNota: '138.31',
                valorUnitarioNota: '11.5258',
              },
              {
                descricaoNota: `${prefixo}Produto B`,
                codigoFornecedor: 'E2EB',
                quantidadeNota: '3.000',
                unidadeNota: 'UN',
                valorTotalItemNota: '45.00',
              },
            ],
          },
        },
      });

      arquivosCriados.push(arquivo.id);

      const dados = {
        itens: [
          {
            indiceNota: 0,
            quantidadeRecebida: 12,
            usarPrecoDaNota: true,
            produtoNovo: { nome: `${prefixo}Produto A` },
          },
          {
            indiceNota: 1,
            quantidadeRecebida: 3,
            usarPrecoDaNota: true,
            produtoNovo: { nome: `${prefixo}Produto B` },
          },
        ],
      };

      const confirmar = () =>
        request(app!.getHttpServer())
          .post(`/recebimentos-compra/notas-pendentes/${arquivo.id}/confirmar`)
          .set('Authorization', `Bearer ${token}`)
          .send(dados);

      const resposta = await confirmar();

      expect(resposta.status, JSON.stringify(resposta.body?.message)).toBe(201);
      expect(resposta.body.itens).toHaveLength(2);

      const produtosIds = resposta.body.itens.map(
        (item: { produtoId: string }) => item.produtoId,
      );

      expect(new Set(produtosIds).size).toBe(2);

      const produtos = await prisma!.produto.findMany({
        where: {
          empresaId: empresaAId,
          id: { in: produtosIds },
        },
        include: { saldoEstoque: true },
      });

      expect(produtos).toHaveLength(2);

      // Confere custo com seis casas e preco comercial com duas.
      const produtoA = produtos.find(
        (produto) => produto.nome === `${prefixo}Produto A`,
      );
      const produtoB = produtos.find(
        (produto) => produto.nome === `${prefixo}Produto B`,
      );

      expect(produtoA?.custo.toFixed(6)).toBe('11.525833');
      expect(produtoA?.preco.toFixed(2)).toBe('16.48');
      expect(produtoB?.custo.toFixed(6)).toBe('15.000000');
      expect(produtoB?.preco.toFixed(2)).toBe('21.45');

      const skus = produtos.map((produto) => produto.sku);

      expect(new Set(skus).size).toBe(2);

      for (const sku of skus) {
        expect(sku).toMatch(/^GC-[A-F0-9]{32}$/);
      }

      const saldos = Object.fromEntries(
        produtos.map((produto) => [
          produto.nome,
          produto.saldoEstoque?.quantidadeDisponivel.toString(),
        ]),
      );

      expect(saldos).toEqual({
        [`${prefixo}Produto A`]: '12',
        [`${prefixo}Produto B`]: '3',
      });

      // Confere os valores fiscais realmente persistidos.
      const itensFiscais = await prisma!.itemRecebimentoCompra.findMany({
        where: {
          empresaId: empresaAId,
          recebimentoId: resposta.body.id,
        },
        select: {
          descricaoNota: true,
          quantidadeNota: true,
          unidadeNota: true,
          fatorEmbalagem: true,
          valorUnitarioNota: true,
          valorTotalItemNota: true,
        },
      });

      expect(itensFiscais).toHaveLength(2);

      const fiscaisPorProduto = Object.fromEntries(
        itensFiscais.map((item) => [
          item.descricaoNota,
          {
            quantidade: item.quantidadeNota?.toString(),
            unidade: item.unidadeNota,
            fator: item.fatorEmbalagem,
            valorUnitario: item.valorUnitarioNota,
            total: item.valorTotalItemNota?.toFixed(2),
          },
        ]),
      );

      expect(fiscaisPorProduto).toEqual({
        [`${prefixo}Produto A`]: {
          quantidade: '12',
          unidade: 'UN',
          fator: null,
          valorUnitario: '11.5258',
          total: '138.31',
        },
        [`${prefixo}Produto B`]: {
          quantidade: '3',
          unidade: 'UN',
          fator: null,
          valorUnitario: null,
          total: '45.00',
        },
      });

      const movimentos = await prisma!.movimentacaoEstoque.findMany({
        where: {
          empresaId: empresaAId,
          referenciaId: resposta.body.id,
          tipo: 'ENTRADA',
        },
      });

      expect(movimentos).toHaveLength(2);

      // Confere o custo historico dos lotes criados pelo recebimento.
      const alocacoesDaCompra =
        await prisma!.movimentacaoLoteEstoque.findMany({
          where: {
            empresaId: empresaAId,
            movimentacaoId: {
              in: movimentos.map((movimento) => movimento.id),
            },
          },
          select: {
            produtoId: true,
            lote: {
              select: {
                quantidadeInicial: true,
                custoUnitarioAquisicao: true,
              },
            },
          },
        });

      expect(alocacoesDaCompra).toHaveLength(2);

      const custosPorProduto = Object.fromEntries(
        alocacoesDaCompra.map(({ produtoId, lote }) => [
          produtos.find((produto) => produto.id === produtoId)?.nome,
          {
            quantidade: lote.quantidadeInicial.toString(),
            custo: lote.custoUnitarioAquisicao?.toFixed(6) ?? null,
          },
        ]),
      );

      expect(custosPorProduto).toEqual({
        [`${prefixo}Produto A`]: {
          quantidade: '12',
          custo: '11.525833',
        },
        [`${prefixo}Produto B`]: {
          quantidade: '3',
          custo: '15.000000',
        },
      });

      const tentativaDuplicada = await confirmar();
      expect(tentativaDuplicada.status).toBe(409);

      const movimentosDepois = await prisma!.movimentacaoEstoque.count({
        where: {
          empresaId: empresaAId,
          referenciaId: resposta.body.id,
          tipo: 'ENTRADA',
        },
      });

      expect(movimentosDepois).toBe(2);

      // Os dois códigos do fornecedor devem estar vinculados.
      const vinculosGravados =
        await prisma!.vinculoProdutoFornecedorCompra.findMany({
          where: {
            empresaId: empresaAId,
            fornecedorCnpj,
            codigoFornecedor: { in: ['E2EA', 'E2EB'] },
          },
          select: {
            codigoFornecedor: true,
            produtoId: true,
          },
        });

      expect(vinculosGravados).toHaveLength(2);

      const produtosPorNome = new Map(
        produtos.map((produto) => [produto.nome, produto.id]),
      );

      expect(Object.fromEntries(
        vinculosGravados.map((vinculo) => [
          vinculo.codigoFornecedor,
          vinculo.produtoId,
        ]),
      )).toEqual({
        E2EA: produtosPorNome.get(`${prefixo}Produto A`),
        E2EB: produtosPorNome.get(`${prefixo}Produto B`),
      });

      // Simula uma segunda nota, com numero distinto.
      const numeroSegundaNota = (
        BigInt(numeroNota) === 999999999n
          ? 100000000n
          : BigInt(numeroNota) + 1n
      ).toString();

      const segundaNota = await prisma!.arquivoNotaCompra.create({
        data: {
          empresaId: empresaAId,
          nomeOriginal: `${prefixo}segunda-nota.pdf`,
          sha256: randomUUID().replaceAll('-', '').repeat(2),
          tamanhoBytes: 100,
          status: 'AGUARDANDO_CONFERENCIA',
          extracao: {
            fornecedorNome: 'Fornecedor E2E Automático',
            fornecedorCnpj,
            destinatarioCnpj: cnpjDestinatario,
            serieNota: '1',
            numeroNota: numeroSegundaNota,
            itens: [
              {
                codigoFornecedor: 'E2EA',
                descricaoNota: `${prefixo}Produto A`,
                quantidadeNota: '12.000',
                unidadeNota: 'UN',
                valorTotalItemNota: '148.20',
                valorUnitarioNota: '12.3500',
              },
              {
                codigoFornecedor: 'E2EB',
                descricaoNota: `${prefixo}Produto B`,
                quantidadeNota: '1.000',
                unidadeNota: 'UN',
                valorTotalItemNota: '15.00',
              },
            ],
          },
        },
      });

      arquivosCriados.push(segundaNota.id);

      const consulta = await request(app!.getHttpServer())
        .get(
          `/recebimentos-compra/notas-pendentes/${segundaNota.id}/vinculos`,
        )
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(consulta.body.dados).toEqual([
        {
          indiceNota: 0,
          produto: expect.objectContaining({
            id: produtosPorNome.get(`${prefixo}Produto A`),
          }),
        },
        {
          indiceNota: 1,
          produto: expect.objectContaining({
            id: produtosPorNome.get(`${prefixo}Produto B`),
          }),
        },
      ]);

      // A outra empresa não pode consultar essa nota.
      const tokenOutraEmpresa = await obterToken(
        empresaBId,
        usuarioBEmail,
      );

      await request(app!.getHttpServer())
        .get(
          `/recebimentos-compra/notas-pendentes/${segundaNota.id}/vinculos`,
        )
        .set('Authorization', `Bearer ${tokenOutraEmpresa}`)
        .expect(404);

      // Confirma uma segunda compra dos produtos existentes.
      const produtoAId = produtosPorNome.get(`${prefixo}Produto A`);
      const produtoBId = produtosPorNome.get(`${prefixo}Produto B`);

      if (!produtoAId || !produtoBId) {
        throw new Error('Produtos do teste nao encontrados.');
      }

      const segundaConfirmacao = await request(app!.getHttpServer())
        .post(`/recebimentos-compra/notas-pendentes/${segundaNota.id}/confirmar`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          itens: [
            {
              indiceNota: 0,
              produtoId: produtoAId,
              quantidadeRecebida: 12,
            },
            {
              indiceNota: 1,
              produtoId: produtoBId,
              quantidadeRecebida: 1,
            },
          ],
        });

      expect(
        segundaConfirmacao.status,
        JSON.stringify(segundaConfirmacao.body?.message),
      ).toBe(201);

      // Os dois lotes devem manter seus custos originais.
      const lotesProdutoA = await prisma!.loteEstoque.findMany({
        where: {
          empresaId: empresaAId,
          produtoId: produtoAId,
        },
        select: {
          quantidadeInicial: true,
          quantidadeRestante: true,
          custoUnitarioAquisicao: true,
        },
      });

      expect(lotesProdutoA).toHaveLength(2);

      const historicoCustos = lotesProdutoA
        .map((lote) => ({
          quantidade: lote.quantidadeInicial.toString(),
          restante: lote.quantidadeRestante.toString(),
          custo: lote.custoUnitarioAquisicao?.toFixed(6) ?? null,
        }))
        .sort((a, b) =>
          (a.custo ?? '').localeCompare(b.custo ?? ''),
        );

      expect(historicoCustos).toEqual([
        {
          quantidade: '12',
          restante: '12',
          custo: '11.525833',
        },
        {
          quantidade: '12',
          restante: '12',
          custo: '12.350000',
        },
      ]);

      const saldoFinal = await prisma!.saldoEstoque.findFirstOrThrow({
        where: {
          empresaId: empresaAId,
          produtoId: produtoAId,
        },
      });

      expect(saldoFinal.quantidadeDisponivel.toString()).toBe('24');

      const itemSegundaCompra =
        await prisma!.itemRecebimentoCompra.findFirstOrThrow({
          where: {
            empresaId: empresaAId,
            recebimentoId: segundaConfirmacao.body.id,
            produtoId: produtoAId,
          },
        });

      expect(itemSegundaCompra.valorTotalItemNota?.toFixed(2))
        .toBe('148.20');
      expect(itemSegundaCompra.valorUnitarioNota)
        .toBe('12.3500');

    } finally {
      try {
        const recebimentos = await prisma!.recebimentoCompra.findMany({
          where: {
            empresaId: empresaAId,
            fornecedorCnpj,
            numeroNota: {
              in: [
                numeroNota.padStart(9, '0'),
                (
                  BigInt(numeroNota) === 999999999n
                    ? '100000000'
                    : (BigInt(numeroNota) + 1n).toString()
                ).padStart(9, '0'),
              ],
            },
          },
          select: { id: true },
        });

        const recebimentosIds = recebimentos.map(({ id }) => id);

        const produtos = await prisma!.produto.findMany({
          where: {
            empresaId: empresaAId,
            nome: { startsWith: prefixo },
          },
          select: { id: true },
        });

        const produtosIds = produtos.map(({ id }) => id);

        if (recebimentosIds.length > 0) {
          await prisma!.itemRecebimentoCompra.deleteMany({
            where: {
              empresaId: empresaAId,
              recebimentoId: { in: recebimentosIds },
            },
          });

          await prisma!.recebimentoCompra.deleteMany({
            where: {
              empresaId: empresaAId,
              id: { in: recebimentosIds },
            },
          });
        }

        if (produtosIds.length > 0) {
          const filtro = { produtoId: { in: produtosIds } };

          await prisma!.vinculoProdutoFornecedorCompra.deleteMany({
            where: {
              empresaId: empresaAId,
              ...filtro,
            },
          });

          await prisma!.movimentacaoLoteEstoque.deleteMany({
            where: filtro,
          });

          await prisma!.loteEstoque.deleteMany({
            where: filtro,
          });

          await prisma!.movimentacaoEstoque.deleteMany({
            where: filtro,
          });

          await prisma!.saldoEstoque.deleteMany({
            where: filtro,
          });

          await prisma!.produto.deleteMany({
            where: {
              empresaId: empresaAId,
              id: { in: produtosIds },
            },
          });
        }

        if (arquivosCriados.length > 0) {
          await prisma!.arquivoNotaCompra.deleteMany({
            where: {
              empresaId: empresaAId,
              id: { in: arquivosCriados },
            },
          });
        }

        if (!unidadeAnterior) {
          await prisma!.unidade.deleteMany({
            where: { empresaId: empresaAId, codigo: 'UN' },
          });
        }
      } finally {
        await prisma!.empresa.update({
          where: { id: empresaAId },
          data: { cnpj: empresaOriginal.cnpj },
        });
      }
    }
  });



  it('deve revisar OCR Ambev com auditoria sem movimentar estoque', async () => {
    validarBancoDeTeste();

    // CNPJ valido e exclusivo para esta execucao E2E.
    const baseCnpj = BigInt(
      `0x${randomUUID().replaceAll('-', '')}`,
    ).toString().slice(0, 12);

    const calcularDigitoCnpj = (parcial: string): string => {
      const pesos = parcial.length === 12
        ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
        : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];

      const soma = [...parcial].reduce(
        (total, numero, indice) =>
          total + Number(numero) * pesos[indice],
        0,
      );

      const resto = soma % 11;
      return String(resto < 2 ? 0 : 11 - resto);
    };

    const primeiroDigito = calcularDigitoCnpj(baseCnpj);
    const empresaCnpj =
      baseCnpj +
      primeiroDigito +
      calcularDigitoCnpj(baseCnpj + primeiroDigito);
    const sufixo = randomUUID().replaceAll('-', '');
    const email = `e2e-revisao-${sufixo}@exemplo.com`;

    // Empresa exclusiva para conferir o CNPJ da nota.
    const empresa = await prisma!.empresa.create({
      data: {
        nome: `Empresa Revisao OCR E2E ${sufixo}`,
        cnpj: empresaCnpj,
      },
    });

    let usuarioId: string | undefined;
    let arquivoId: string | undefined;

    try {
      const usuario = await prisma!.usuario.create({
        data: {
          empresaId: empresa.id,
          nome: 'Revisor OCR E2E',
          email,
          hashSenha: await argon2.hash(senhaTeste),
          perfil: 'GERENTE',
          ativo: true,
        },
      });
      usuarioId = usuario.id;

      const token = await obterToken(empresa.id, email);

      const itensOriginais = [
        {
          codigoFornecedor: '14550',
          descricaoNota: 'COLORADO APPIA 600ML',
          quantidadeNota: '12.000',
          unidadeNota: null,
          valorUnitarioNota: '11.5383',
          valorTotalItemNota: '138.46',
          valoresConferem: true,
        },
        {
          codigoFornecedor: '29580',
          descricaoNota: 'STELLA ARTOIS PURE GOLD 330ML',
          quantidadeNota: '24.000',
          unidadeNota: null,
          valorUnitarioNota: '4.4604',
          valorTotalItemNota: '107.05',
          valoresConferem: true,
        },
        {
          codigoFornecedor: '14552',
          descricaoNota: 'COLORADO INDICA 600ML',
          quantidadeNota: '12.000',
          unidadeNota: null,
          valorUnitarioNota: '11.2916',
          valorTotalItemNota: '135.50',
          valoresConferem: true,
        },
        {
          codigoFornecedor: '19166',
          descricaoNota: 'COLORADO LAGER 600ML',
          quantidadeNota: '12.000',
          unidadeNota: null,
          valorUnitarioNota: '11.8258',
          valorTotalItemNota: '138.31',
          valoresConferem: false,
        },
      ];

      const extracaoOriginal = {
        modoExtracao: 'OCR_PILOTO',
        fornecedorNome: 'Ambev S.A. - CDD Embu',
        fornecedorCnpj: '07526557008194',
        destinatarioCnpj: empresaCnpj,
        numeroNota: '083929',
        serieNota: '025',
        emitidaEm: null,
        valorTotalProdutos: '519.32',
        somaItensExtraidos: '519.32',
        aptoParaConfirmacaoAutomatica: false,
        totalItens: 4,
        itens: itensOriginais,
        avisos: ['Revisao fiscal necessaria.'],
      };

      const arquivo = await prisma!.arquivoNotaCompra.create({
        data: {
          empresaId: empresa.id,
          nomeOriginal: `am bev revisao e2e ${sufixo}.pdf`,
          sha256: sufixo.padEnd(64, '0'),
          tamanhoBytes: 1024,
          status: 'AGUARDANDO_CONFERENCIA',
          extracao: extracaoOriginal,
        },
      });
      arquivoId = arquivo.id;

      const contagensAntes = await Promise.all([
        prisma!.produto.count({ where: { empresaId: empresa.id } }),
        prisma!.recebimentoCompra.count({ where: { empresaId: empresa.id } }),
        prisma!.movimentacaoEstoque.count({ where: { empresaId: empresa.id } }),
        prisma!.saldoEstoque.count({ where: { empresaId: empresa.id } }),
        prisma!.loteEstoque.count({ where: { empresaId: empresa.id } }),
      ]);

      const itensRevisados = itensOriginais.map((item, indiceNota) => ({
        indiceNota,
        descricaoNota: item.descricaoNota,
        quantidadeNota: item.quantidadeNota,
        unidadeNota: 'UN',
        valorUnitarioNota:
          indiceNota === 3 ? '11.5258' : item.valorUnitarioNota,
        valorTotalItemNota: item.valorTotalItemNota,
      }));

      const rota =
        `/recebimentos-compra/notas-pendentes/${arquivo.id}/revisar`;

      // Deve rejeitar divergencia matematica.
      const revisaoInvalida = {
        emitidaEm: '2026-11-05',
        justificativa:
          'Conferencia manual de teste com valores divergentes.',
        itens: itensRevisados.map((item, indice) => (
          indice === 3
            ? { ...item, valorUnitarioNota: '11.8258' }
            : item
        )),
      };

      await request(app!.getHttpServer())
        .post(rota)
        .set('Authorization', `Bearer ${token}`)
        .send(revisaoInvalida)
        .expect(400);

      // A tentativa invalida nao pode alterar a extracao.
      const antes = await prisma!.arquivoNotaCompra.findUnique({
        where: { id: arquivo.id },
        select: { extracao: true },
      });

      expect(antes?.extracao).toEqual(extracaoOriginal);

      const revisaoValida = {
        emitidaEm: '2026-11-05',
        justificativa:
          'Conferencia manual E2E dos quatro itens da nota digitalizada.',
        itens: itensRevisados,
      };

      const resposta = await request(app!.getHttpServer())
        .post(rota)
        .set('Authorization', `Bearer ${token}`)
        .send(revisaoValida)
        .expect(201);

      expect(resposta.body).toMatchObject({
        arquivoId: arquivo.id,
        status: 'AGUARDANDO_CONFERENCIA',
        revisaoFiscal: 'VALIDADA',
        quantidadeItens: 4,
        totalProdutos: '519.32',
      });

      const atualizado = await prisma!.arquivoNotaCompra.findUnique({
        where: { id: arquivo.id },
        select: { status: true, extracao: true },
      });

      expect(atualizado?.status).toBe('AGUARDANDO_CONFERENCIA');
      expect(atualizado?.extracao).toMatchObject({
        emitidaEm: '2026-11-05',
        aptoParaConfirmacaoAutomatica: false,
        revisaoFiscal: {
          status: 'VALIDADA',
          revisadaPorId: usuario.id,
        },
        extracaoOriginalOcr: extracaoOriginal,
      });

      const dados = atualizado?.extracao;

      if (
        !dados ||
        typeof dados !== 'object' ||
        Array.isArray(dados) ||
        !Array.isArray(dados.itens)
      ) {
        throw new Error('Revisao fiscal nao foi persistida.');
      }

      expect(dados.itens[3]).toMatchObject({
        codigoFornecedor: '19166',
        valorUnitarioNota: '11.5258',
        valorTotalItemNota: '138.31',
        valoresConferem: true,
      });

      const auditoria = await prisma!.eventoAuditoria.findFirst({
        where: {
          empresaId: empresa.id,
          atorId: usuario.id,
          acao: 'REVISAR_NOTA_OCR',
          entidadeId: arquivo.id,
        },
      });

      expect(auditoria).not.toBeNull();
      expect(auditoria?.resultado).toBe(ResultadoAuditoria.SUCESSO);

      const contagensDepois = await Promise.all([
        prisma!.produto.count({ where: { empresaId: empresa.id } }),
        prisma!.recebimentoCompra.count({ where: { empresaId: empresa.id } }),
        prisma!.movimentacaoEstoque.count({ where: { empresaId: empresa.id } }),
        prisma!.saldoEstoque.count({ where: { empresaId: empresa.id } }),
        prisma!.loteEstoque.count({ where: { empresaId: empresa.id } }),
      ]);

      expect(contagensDepois).toEqual(contagensAntes);

      console.log('Revisao OCR validada e auditada no E2E.');
      console.log('OCR original preservado. Nenhum estoque alterado.');
    } finally {
      // Limpeza restrita a empresa criada por este teste.
      await prisma!.eventoAuditoria.deleteMany({
        where: { empresaId: empresa.id },
      });

      if (arquivoId) {
        await prisma!.arquivoNotaCompra.deleteMany({
          where: { id: arquivoId, empresaId: empresa.id },
        });
      }

      if (usuarioId) {
        await prisma!.usuario.deleteMany({
          where: { id: usuarioId, empresaId: empresa.id },
        });
      }

      await prisma!.empresa.deleteMany({
        where: { id: empresa.id },
      });
    }
  }, 60000);

  it('deve integrar monitor e OCR Ambev sem movimentar estoque', async () => {
    validarBancoDeTeste();

    if (process.env.NODE_ENV !== 'test') {
      throw new Error('Piloto OCR exige NODE_ENV=test.');
    }

    const { createHash } = await import('node:crypto');
    const { copyFile, mkdtemp, readFile, rm } =
      await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { homedir } = await import('node:os');
    const { join } = await import('node:path');
    const { MonitorNotasCompraService } =
      await import('../src/recebimentos-compra/monitor-notas-compra.service.js');

    const origem = join(
      homedir(),
      'Downloads',
      'CamScanner 05-11-2026 15.18.pdf',
    );

    const conteudoPdf = await readFile(origem);

    if (
      !conteudoPdf.subarray(0, 5).equals(Buffer.from('%PDF-')) ||
      conteudoPdf.length === 0 ||
      conteudoPdf.length > 20 * 1024 * 1024
    ) {
      throw new Error('PDF do piloto invalido ou acima do limite.');
    }

    const sha256 = createHash('sha256')
      .update(conteudoPdf)
      .digest('hex');

    // Nunca reutiliza ou altera uma nota existente.
    const arquivoExistente =
      await prisma!.arquivoNotaCompra.findFirst({
        where: { sha256 },
        select: { id: true },
      });

    if (arquivoExistente) {
      throw new Error(
        'PDF ja registrado no E2E. Teste cancelado para preservar o registro.',
      );
    }

    const contagensAntes = await Promise.all([
      prisma!.produto.count({ where: { empresaId: empresaAId } }),
      prisma!.recebimentoCompra.count({ where: { empresaId: empresaAId } }),
      prisma!.movimentacaoEstoque.count({ where: { empresaId: empresaAId } }),
      prisma!.saldoEstoque.count({ where: { empresaId: empresaAId } }),
      prisma!.loteEstoque.count({ where: { empresaId: empresaAId } }),
    ]);

    const pasta = await mkdtemp(
      join(tmpdir(), 'agc-ocr-e2e-'),
    );

    const nome = `ambev-ocr-${randomUUID()}.pdf`;

    const variaveis = [
      'NOTAS_COMPRA_PYTHON',
      'NOTAS_COMPRA_OCR_PILOTO',
      'NOTAS_COMPRA_ENTRADA_AUTOMATICA',
      'NOTAS_COMPRA_SIMULAR_AUTOMACAO',
    ];

    const anteriores = Object.fromEntries(
      variaveis.map((chave) => [chave, process.env[chave]]),
    );

    try {
      process.env.NOTAS_COMPRA_PYTHON = 'python';
      process.env.NOTAS_COMPRA_OCR_PILOTO = '1';
      process.env.NOTAS_COMPRA_ENTRADA_AUTOMATICA = '0';
      process.env.NOTAS_COMPRA_SIMULAR_AUTOMACAO = '0';

      await copyFile(origem, join(pasta, nome));

      const monitor = app!.get(MonitorNotasCompraService);

      const executarVerificacao = monitor as unknown as {
        verificarArquivo(
          pasta: string,
          empresaId: string,
          nome: string,
        ): Promise<void>;
      };

      // Primeira verificacao: observa a assinatura do arquivo.
      await executarVerificacao.verificarArquivo(
        pasta, empresaAId, nome,
      );

      // Segunda verificacao: executa o processamento real.
      await executarVerificacao.verificarArquivo(
        pasta, empresaAId, nome,
      );

      const registro =
        await prisma!.arquivoNotaCompra.findFirst({
          where: {
            empresaId: empresaAId,
            sha256,
          },
          select: {
            id: true,
            status: true,
            extracao: true,
          },
        });

      expect(registro).not.toBeNull();
      expect(registro?.status).toBe('AGUARDANDO_CONFERENCIA');

      expect(registro?.extracao).toMatchObject({
        modoExtracao: 'OCR_PILOTO',
        fornecedorNome: 'Ambev S.A. - CDD Embu',
        fornecedorCnpj: '07526557008194',
        destinatarioCnpj: '66804456000112',
        numeroNota: '083929',
        serieNota: '025',
        totalItens: 4,
        valorTotalProdutos: '519.32',
        somaItensExtraidos: '519.32',
        aptoParaConfirmacaoAutomatica: false,
      });

      const extracao = registro?.extracao;

      if (
        !extracao ||
        typeof extracao !== 'object' ||
        Array.isArray(extracao) ||
        !Array.isArray(extracao.itens)
      ) {
        throw new Error('Itens OCR nao foram persistidos.');
      }

      const itens = extracao.itens;

      expect(itens).toHaveLength(4);

      expect(itens.map((item) => item.codigoFornecedor)).toEqual([
        '14550',
        '29580',
        '14552',
        '19166',
      ]);

      expect(itens[3]).toMatchObject({
        codigoFornecedor: '19166',
        valorTotalItemNota: '138.31',
        valoresConferem: false,
      });

      const contagensDepois = await Promise.all([
        prisma!.produto.count({ where: { empresaId: empresaAId } }),
        prisma!.recebimentoCompra.count({ where: { empresaId: empresaAId } }),
        prisma!.movimentacaoEstoque.count({ where: { empresaId: empresaAId } }),
        prisma!.saldoEstoque.count({ where: { empresaId: empresaAId } }),
        prisma!.loteEstoque.count({ where: { empresaId: empresaAId } }),
      ]);

      expect(contagensDepois).toEqual(contagensAntes);

      console.log(
        'OCR Ambev integrado: 4 produtos, R$ 519,32, aguardando conferencia.',
      );
      console.log(
        'Nenhum produto, recebimento, saldo ou lote criado.',
      );

    } finally {
      // Remove somente o arquivo registrado por este teste.
      await prisma!.arquivoNotaCompra.deleteMany({
        where: {
          empresaId: empresaAId,
          sha256,
        },
      });

      await rm(pasta, {
        recursive: true,
        force: true,
      });

      for (const chave of variaveis) {
        const valor = anteriores[chave];

        if (valor === undefined) {
          delete process.env[chave];
        } else {
          process.env[chave] = valor;
        }
      }
    }
  }, 240000);


  it('deve rejeitar nota extraída com destinatário divergente', async () => {
    const token = await obterToken(empresaAId, usuarioAEmail);
    const identificador = randomUUID().replaceAll('-', '');
    const nomeProduto = `Produto CNPJ divergente ${identificador.slice(0, 12)}`;
    const numeroNota = String(
      BigInt('0x' + identificador) % 900000000n + 100000000n,
    );

    const empresa = await prisma!.empresa.findUniqueOrThrow({
      where: { id: empresaAId },
      select: { cnpj: true },
    });

    const destinatarioDivergente =
      empresa.cnpj?.replace(/\D/g, '') === '12345678000190'
        ? '98765432000100'
        : '12345678000190';

    const fornecedorCnpj = '99887766000155';

    const arquivo = await prisma!.arquivoNotaCompra.create({
      data: {
        empresaId: empresaAId,
        nomeOriginal: `${identificador}.pdf`,
        sha256: identificador.repeat(2),
        tamanhoBytes: 100,
        status: 'AGUARDANDO_CONFERENCIA',
        extracao: {
          fornecedorNome: 'Fornecedor E2E Destinatário',
          fornecedorCnpj,
          destinatarioCnpj: destinatarioDivergente,
          serieNota: '1',
          numeroNota,
          itens: [{
            descricaoNota: nomeProduto,
            codigoFornecedor: 'TESTE-CNPJ',
            quantidadeNota: '1.000',
            unidadeNota: 'UN',
            valorTotalItemNota: '10.00',
          }],
        },
      },
    });

    try {
      const resposta = await request(app!.getHttpServer())
        .post(`/recebimentos-compra/notas-pendentes/${arquivo.id}/confirmar`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          itens: [{
            indiceNota: 0,
            quantidadeRecebida: 1,
            usarPrecoDaNota: true,
            produtoNovo: { nome: nomeProduto },
          }],
        });

      expect(resposta.status).toBe(400);
      expect(JSON.stringify(resposta.body.message))
        .toContain('CNPJ do destinatário');

      const arquivoDepois = await prisma!.arquivoNotaCompra.findUniqueOrThrow({
        where: { id: arquivo.id },
        select: { status: true },
      });

      expect(arquivoDepois.status).toBe('AGUARDANDO_CONFERENCIA');

      expect(await prisma!.produto.count({
        where: { empresaId: empresaAId, nome: nomeProduto },
      })).toBe(0);

      expect(await prisma!.recebimentoCompra.count({
        where: {
          empresaId: empresaAId,
          fornecedorCnpj,
          serieNota: '001',
          numeroNota: numeroNota.padStart(9, '0'),
        },
      })).toBe(0);
    } finally {
      await prisma!.arquivoNotaCompra.deleteMany({
        where: { id: arquivo.id, empresaId: empresaAId },
      });
    }
  });


  it('deve bloquear nota com pendencias de OCR sem gerar recebimento', async () => {
    const token = await obterToken(empresaAId, usuarioAEmail);

    const empresa = await prisma!.empresa.findUniqueOrThrow({
      where: { id: empresaAId },
      select: { cnpj: true },
    });

    const cenarios = [
      {
        nome: 'nota marcada para revisao',
        apto: false,
        itemConfere: true,
        valorUnitario: '11.5258',
      },
      {
        nome: 'item com divergencia fiscal',
        apto: true,
        itemConfere: false,
        valorUnitario: '11.8258',
      },
    ];

    for (const cenario of cenarios) {
      const identificador = randomUUID().replaceAll('-', '');
      const numeroNota = (
        BigInt('0x' + identificador) % 900000000n + 100000000n
      ).toString();

      const nomeProduto =
        `OCR-BLOQUEADO-${identificador.slice(0, 12)}`;

      const fornecedorCnpj = '07526557008194';

      const arquivo = await prisma!.arquivoNotaCompra.create({
        data: {
          empresaId: empresaAId,
          nomeOriginal: `${identificador}.pdf`,
          sha256: identificador.repeat(2),
          tamanhoBytes: 100,
          status: 'AGUARDANDO_CONFERENCIA',
          extracao: {
            fornecedorNome: 'Ambev S.A. - CDD Embu',
            fornecedorCnpj,
            destinatarioCnpj:
              empresa.cnpj?.replace(/\D/g, '') ??
              '66804456000112',
            numeroNota,
            serieNota: '025',
            aptoParaConfirmacaoAutomatica: cenario.apto,
            itens: [{
              codigoFornecedor: '19166',
              descricaoNota: 'COLORADO LAGER 600ML',
              quantidadeNota: '12.000',
              unidadeNota: 'UN',
              valorUnitarioNota: cenario.valorUnitario,
              valorTotalItemNota: '138.31',
              valoresConferem: cenario.itemConfere,
            }],
          },
        },
      });

      try {
        const resposta = await request(app!.getHttpServer())
          .post(
            `/recebimentos-compra/notas-pendentes/${arquivo.id}/confirmar`,
          )
          .set('Authorization', `Bearer ${token}`)
          .send({
            itens: [{
              indiceNota: 0,
              quantidadeRecebida: 12,
              usarPrecoDaNota: true,
              produtoNovo: { nome: nomeProduto },
            }],
          });

        expect(resposta.status).toBe(400);
        expect(JSON.stringify(resposta.body.message))
          .toContain('pendencias de OCR');

        const arquivoDepois =
          await prisma!.arquivoNotaCompra.findUniqueOrThrow({
            where: { id: arquivo.id },
            select: { status: true },
          });

        expect(arquivoDepois.status)
          .toBe('AGUARDANDO_CONFERENCIA');

        expect(await prisma!.produto.count({
          where: {
            empresaId: empresaAId,
            nome: nomeProduto,
          },
        })).toBe(0);

        expect(await prisma!.recebimentoCompra.count({
          where: {
            empresaId: empresaAId,
            fornecedorCnpj,
            serieNota: '025',
            numeroNota,
          },
        })).toBe(0);
      } finally {
        await prisma!.arquivoNotaCompra.deleteMany({
          where: {
            empresaId: empresaAId,
            id: arquivo.id,
          },
        });
      }
    }
  });


  it('deve reverter produtos novos quando um item posterior falha', async () => {
    const token = await obterToken(empresaAId, usuarioAEmail);
    const identificador = randomUUID().replaceAll('-', '');
    const prefixo = `ROLLBACK-NOTA-${identificador.slice(0, 12)}-`;
    const fornecedorCnpj = '99887766000155';
    const numeroNota = (
      BigInt('0x' + identificador) % 900000000n + 100000000n
    ).toString();

    const destinatarioCnpj = (
      BigInt('0x' + identificador) % 100000000000000n
    ).toString().padStart(14, '0');

    const empresaOriginal = await prisma!.empresa.findUniqueOrThrow({
      where: { id: empresaAId },
      select: { cnpj: true },
    });

    const unidadeOriginal = await prisma!.unidade.findFirst({
      where: { empresaId: empresaAId, codigo: 'UN' },
      select: { id: true },
    });

    let arquivoId: string | undefined;

    try {
      await prisma!.empresa.update({
        where: { id: empresaAId },
        data: { cnpj: destinatarioCnpj },
      });

      const arquivo = await prisma!.arquivoNotaCompra.create({
        data: {
          empresaId: empresaAId,
          nomeOriginal: `${prefixo}teste.pdf`,
          sha256: identificador.repeat(2),
          tamanhoBytes: 100,
          status: 'AGUARDANDO_CONFERENCIA',
          extracao: {
            fornecedorNome: 'Fornecedor E2E Rollback',
            fornecedorCnpj,
            destinatarioCnpj,
            serieNota: '1',
            numeroNota,
            itens: [
              {
                descricaoNota: `${prefixo}Produto A`,
                codigoFornecedor: `RA-${identificador.slice(0, 10)}`,
                quantidadeNota: '2.000',
                unidadeNota: 'UN',
                valorTotalItemNota: '20.00',
              },
              {
                descricaoNota: `${prefixo}Produto B`,
                codigoFornecedor: `RB-${identificador.slice(0, 10)}`,
                quantidadeNota: '3.000',
                unidadeNota: 'UN',
                valorTotalItemNota: '30.00',
              },
            ],
          },
        },
      });

      arquivoId = arquivo.id;

      const resposta = await request(app!.getHttpServer())
        .post(`/recebimentos-compra/notas-pendentes/${arquivo.id}/confirmar`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          itens: [
            {
              indiceNota: 0,
              quantidadeRecebida: 2,
              usarPrecoDaNota: true,
              produtoNovo: {
                nome: `${prefixo}Produto A`,
              },
            },
            {
              indiceNota: 1,
              quantidadeRecebida: 3,
              usarPrecoDaNota: false,
              produtoNovo: {
                nome: `${prefixo}Produto B`,
              },
            },
          ],
        });

      expect(resposta.status, JSON.stringify(resposta.body?.message)).toBe(400);
      expect(JSON.stringify(resposta.body?.message))
        .toContain('Informe custo e preço');

      const arquivoDepois = await prisma!.arquivoNotaCompra.findUniqueOrThrow({
        where: { id: arquivo.id },
        select: { status: true },
      });

      expect(arquivoDepois.status).toBe('AGUARDANDO_CONFERENCIA');

      const produtos = await prisma!.produto.findMany({
        where: {
          empresaId: empresaAId,
          nome: { startsWith: prefixo },
        },
      });

      expect(produtos).toHaveLength(0);

      const recebimentos = await prisma!.recebimentoCompra.count({
        where: {
          empresaId: empresaAId,
          fornecedorCnpj,
          serieNota: '001',
          numeroNota: numeroNota.padStart(9, '0'),
        },
      });

      expect(recebimentos).toBe(0);
    } finally {
      try {
        // Limpeza defensiva caso uma regressão permita gravação parcial.
        const recebimentos = await prisma!.recebimentoCompra.findMany({
          where: {
            empresaId: empresaAId,
            fornecedorCnpj,
            serieNota: '001',
            numeroNota: numeroNota.padStart(9, '0'),
          },
          select: { id: true },
        });

        const recebimentosIds = recebimentos.map(({ id }) => id);

        const produtos = await prisma!.produto.findMany({
          where: {
            empresaId: empresaAId,
            nome: { startsWith: prefixo },
          },
          select: { id: true },
        });

        const produtosIds = produtos.map(({ id }) => id);

        if (recebimentosIds.length > 0) {
          await prisma!.itemRecebimentoCompra.deleteMany({
            where: {
              empresaId: empresaAId,
              recebimentoId: { in: recebimentosIds },
            },
          });

          await prisma!.recebimentoCompra.deleteMany({
            where: {
              empresaId: empresaAId,
              id: { in: recebimentosIds },
            },
          });
        }

        if (produtosIds.length > 0) {
          const filtro = { produtoId: { in: produtosIds } };

          await prisma!.vinculoProdutoFornecedorCompra.deleteMany({
            where: { empresaId: empresaAId, ...filtro },
          });
          await prisma!.movimentacaoLoteEstoque.deleteMany({ where: filtro });
          await prisma!.loteEstoque.deleteMany({ where: filtro });
          await prisma!.movimentacaoEstoque.deleteMany({ where: filtro });
          await prisma!.saldoEstoque.deleteMany({ where: filtro });

          await prisma!.produto.deleteMany({
            where: {
              empresaId: empresaAId,
              id: { in: produtosIds },
            },
          });
        }

        if (arquivoId) {
          await prisma!.arquivoNotaCompra.deleteMany({
            where: { empresaId: empresaAId, id: arquivoId },
          });
        }

        if (!unidadeOriginal) {
          await prisma!.unidade.deleteMany({
            where: { empresaId: empresaAId, codigo: 'UN' },
          });
        }
      } finally {
        await prisma!.empresa.update({
          where: { id: empresaAId },
          data: { cnpj: empresaOriginal.cnpj },
        });
      }
    }
  });

  describe('recebimento manual de compra', () => {
    const nota = {
      fornecedorNome: 'Fornecedor E2E',
      fornecedorCnpj: '11.222.333/0001-81',
      serieNota: '1',
      numeroNota: '123',
    };

    function confirmarCompra(token: string, dados: object) {
      return request(app!.getHttpServer())
        .post('/recebimentos-compra/confirmar')
        .set('Authorization', `Bearer ${token}`)
        .send(dados);
    }

    it('grava a entrada e rejeita a mesma nota com formatação diferente', async () => {
      const token = await obterToken(empresaAId, usuarioAEmail);
      const produto = await criarProdutoPelaApi(token, 'Produto de compra E2E');
      const escopo = { empresaId: empresaAId, produtoId: produto.id };
      const dados = {
        ...nota,
        itens: [{
          produtoId: produto.id,
          descricaoNota: 'Item da nota',
          quantidadeRecebida: 4,
          codigoLote: 'COMPRA-E2E',
          validadeEm: '2099-12-10',
        }],
      };

      const resposta = await confirmarCompra(token, dados);
      expect(resposta.status, JSON.stringify(resposta.body?.message)).toBe(201);
      expect(resposta.body).toMatchObject({
        empresaId: empresaAId,
        origem: 'MANUAL',
        status: 'INCLUIDO',
        incluidoPorOrigem: 'MANUAL',
        incluidoPorUsuarioId: expect.any(String),
        incluidoPorNome: expect.any(String),
        incluidoEm: expect.any(String),
      });
      expect(resposta.body.itens).toHaveLength(1);

      await confirmarCompra(token, {
        ...dados,
        fornecedorCnpj: '11222333000181',
        serieNota: '001',
        numeroNota: '000000123',
      }).expect(409);

      await request(app!.getHttpServer())
        .get('/recebimentos-compra')
        .expect(401);

      const historico = await request(app!.getHttpServer())
        .get('/recebimentos-compra?pagina=1&limite=10')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(historico.body).toMatchObject({ pagina: 1, limite: 10 });
      expect(historico.body.total).toBeGreaterThanOrEqual(1);

      // Confere o recebimento desta execucao, sem exigir
      // que nao existam outras notas da empresa.
      const registrosDaNota = historico.body.dados.filter(
        (item: { id: string }) => item.id === resposta.body.id,
      );
      expect(registrosDaNota).toHaveLength(1);
      expect(registrosDaNota[0]).toMatchObject({
        id: resposta.body.id,
        fornecedorNome: 'Fornecedor E2E',
        numeroNota: '000000123',
        origem: 'MANUAL',
        incluidoPorOrigem: 'MANUAL',
        incluidoPorNome: resposta.body.incluidoPorNome,
        incluidoEm: resposta.body.incluidoEm,
        quantidadeItens: 1,
        status: 'INCLUIDO',
      });

      const recebimento = await prisma!.recebimentoCompra.findFirstOrThrow({
        where: { id: resposta.body.id, empresaId: empresaAId },
        include: { itens: { include: { movimentacao: { include: { lotes: true } } } } },
      });
      expect(recebimento.itens).toHaveLength(1);
      const movimento = recebimento.itens[0].movimentacao;
      expect(movimento?.referenciaId).toBe(recebimento.id);
      expect(movimento?.lotes).toHaveLength(1);

      const lotes = await prisma!.loteEstoque.findMany({ where: escopo });
      expect(lotes).toHaveLength(1);
      expect(lotes[0].id).toBe(movimento?.lotes[0].loteId);
      expect(lotes[0].codigoLote).toBe('COMPRA-E2E');
      expect(lotes[0].validadeEm?.toISOString()).toBe('2099-12-10T00:00:00.000Z');
      expect(lotes[0].quantidadeRestante.toString()).toBe('4');

      const saldo = await prisma!.saldoEstoque.findFirstOrThrow({ where: escopo });
      expect(saldo.quantidadeDisponivel.toString()).toBe('4');
    });

    it('reverte a compra inteira quando um item posterior é inválido', async () => {
      const token = await obterToken(empresaAId, usuarioAEmail);
      const produto = await criarProdutoPelaApi(token, 'Produto de rollback E2E');
      const escopo = { empresaId: empresaAId, produtoId: produto.id };

      await confirmarCompra(token, {
        ...nota,
        numeroNota: '124',
        itens: [
          {
            produtoId: produto.id,
            descricaoNota: 'Primeiro item válido',
            quantidadeRecebida: 3,
          },
          {
            produtoId: '00000000-0000-4000-8000-000000000001',
            descricaoNota: 'Produto inexistente',
            quantidadeRecebida: 1,
          },
        ],
      }).expect(404);

      const saldo = await prisma!.saldoEstoque.findFirstOrThrow({ where: escopo });
      expect(saldo.quantidadeDisponivel.toString()).toBe('0');
      expect(await prisma!.loteEstoque.count({ where: escopo })).toBe(0);
      expect(await prisma!.movimentacaoEstoque.count({ where: escopo })).toBe(0);
      expect(await prisma!.recebimentoCompra.count({
        where: {
          empresaId: empresaAId,
          fornecedorCnpj: '11222333000181',
          serieNota: '001',
          numeroNota: '000000124',
        },
      })).toBe(0);
    });
  });

  it('deve registrar uma venda e baixar o estoque pela API', async () => {
    const token = await obterToken(empresaAId, usuarioAEmail);

    const produto = await criarProdutoPelaApi(
      token,
      'Produto para venda E2E',
    );

    await movimentarEstoquePelaApi(token, produto.id, {
      tipo: 'ENTRADA',
      quantidade: 10,
      motivo: 'Estoque inicial para teste de venda',
    }).expect(201);

    const resposta = await criarVendaPelaApi(token, {
      formaPagamento: 'PIX',
      itens: [
        {
          produtoId: produto.id,
          quantidade: 2,
        },
      ],
    }).expect(201);

    // Registra o ID assim que a API confirmar a venda,
    // permitindo que afterAll a remova com segurança.
    vendasCriadas.push(resposta.body.id);

    expect(resposta.body).toMatchObject({
      id: expect.any(String),
      empresaId: empresaAId,
      formaPagamento: 'PIX',
      total: 21,
    });

    expect(resposta.body.itens).toHaveLength(1);
    expect(resposta.body.itens[0]).toMatchObject({
      quantidade: 2,
      precoUnitario: 10.5,
      subtotal: 21,
    });

    // Confirma o saldo real após a venda.
    const saldo = await prisma!.saldoEstoque.findUnique({
      where: {
        produtoId: produto.id,
      },
    });

    expect(Number(saldo?.quantidadeDisponivel.toString())).toBe(8);

    // Confirma que foi registrada uma saída vinculada à venda.
    const movimentacao = await prisma!.movimentacaoEstoque.findFirst({
      where: {
        empresaId: empresaAId,
        produtoId: produto.id,
        referenciaId: resposta.body.id,
        tipo: 'SAIDA',
      },
    });

    expect(movimentacao).not.toBeNull();
    expect(Number(movimentacao!.quantidade.toString())).toBe(2);
    expect(Number(movimentacao!.saldoApos.toString())).toBe(8);

    // Confirma a persistência real da auditoria da venda.
    const eventoAuditoria = await buscarEventoAuditoria({
      empresaId: empresaAId,
      atorId: usuarioAId,
      tipoAtor: TipoAtorAuditoria.USUARIO_EMPRESA,
      modulo: 'VENDAS',
      acao: 'CRIAR',
      entidade: 'VENDA',
      entidadeId: resposta.body.id,
      resultado: ResultadoAuditoria.SUCESSO,
    });

    expect(eventoAuditoria).not.toBeNull();
    expect(eventoAuditoria).toMatchObject({
      empresaId: empresaAId,
      atorId: usuarioAId,
      tipoAtor: TipoAtorAuditoria.USUARIO_EMPRESA,
      modulo: 'VENDAS',
      acao: 'CRIAR',
      entidade: 'VENDA',
      entidadeId: resposta.body.id,
      resultado: ResultadoAuditoria.SUCESSO,
      dadosPosteriores: {
        formaPagamento: 'PIX',
        quantidadeItens: 1,
      },
      metadados: {
        quantidadeProdutos: 1,
        estoqueBaixado: true,
      },
    });

    // Permite que o afterAll remova somente este evento de auditoria.
    eventosAuditoriaCriados.push(eventoAuditoria!.id);
  });

  it('deve rejeitar venda com estoque insuficiente sem alterar o saldo', async () => {
    const token = await obterToken(empresaAId, usuarioAEmail);

    const produto = await criarProdutoPelaApi(
      token,
      'Produto com estoque insuficiente E2E',
    );

    await movimentarEstoquePelaApi(token, produto.id, {
      tipo: 'ENTRADA',
      quantidade: 1,
      motivo: 'Estoque inicial para teste de venda',
    }).expect(201);

    const totalVendasAntes = await prisma!.venda.count({
      where: {
        empresaId: empresaAId,
      },
    });

    const resposta = await criarVendaPelaApi(token, {
      formaPagamento: 'DINHEIRO',
      itens: [
        {
          produtoId: produto.id,
          quantidade: 2,
        },
      ],
    }).expect(400);

    expect(resposta.body.message).toContain('Estoque insuficiente');

    // A venda não pode existir se a quantidade disponível for insuficiente.
    const totalVendasDepois = await prisma!.venda.count({
      where: {
        empresaId: empresaAId,
      },
    });

    expect(totalVendasDepois).toBe(totalVendasAntes);

    const saldo = await prisma!.saldoEstoque.findUnique({
      where: {
        produtoId: produto.id,
      },
    });

    expect(Number(saldo?.quantidadeDisponivel.toString())).toBe(1);
  });

  it('deve impedir uma empresa de vender produto de outra empresa', async () => {
    const tokenA = await obterToken(empresaAId, usuarioAEmail);
    const tokenB = await obterToken(empresaBId, usuarioBEmail);

    const produto = await criarProdutoPelaApi(
      tokenA,
      'Produto exclusivo da empresa A',
    );

    await movimentarEstoquePelaApi(tokenA, produto.id, {
      tipo: 'ENTRADA',
      quantidade: 4,
      motivo: 'Estoque inicial para teste de isolamento',
    }).expect(201);

    const totalVendasEmpresaBAntes = await prisma!.venda.count({
      where: {
        empresaId: empresaBId,
      },
    });

    await criarVendaPelaApi(tokenB, {
      formaPagamento: 'PIX',
      itens: [
        {
          produtoId: produto.id,
          quantidade: 1,
        },
      ],
    }).expect(404);

    // A empresa B não deve registrar venda nem alterar o saldo da A.
    const totalVendasEmpresaBDepois = await prisma!.venda.count({
      where: {
        empresaId: empresaBId,
      },
    });

    expect(totalVendasEmpresaBDepois).toBe(
      totalVendasEmpresaBAntes,
    );

    const saldo = await prisma!.saldoEstoque.findUnique({
      where: {
        produtoId: produto.id,
      },
    });

    expect(Number(saldo?.quantidadeDisponivel.toString())).toBe(4);
  });

  it('deve listar vendas paginadas e consultar seus detalhes', async () => {
    const token = await obterToken(empresaAId, usuarioAEmail);

    const produto = await criarProdutoPelaApi(
      token,
      'Produto histórico E2E',
    );

    // Prepara estoque suficiente para a venda de teste.
    await movimentarEstoquePelaApi(token, produto.id, {
      tipo: 'ENTRADA',
      quantidade: 5,
      motivo: 'Estoque para teste do histórico de vendas',
    }).expect(201);

    // Cria a venda através da API real.
    const respostaVenda = await criarVendaPelaApi(token, {
      formaPagamento: 'PIX',
      itens: [
        {
          produtoId: produto.id,
          quantidade: 2,
        },
      ],
    }).expect(201);

    // Permite que a limpeza da suíte remova esta venda ao terminar.
    vendasCriadas.push(respostaVenda.body.id);

    // Confere a listagem paginada e o filtro de pagamento.
    const respostaLista = await request(app!.getHttpServer())
      .get('/vendas?pagina=1&limite=10&formaPagamento=PIX')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(respostaLista.body).toMatchObject({
      pagina: 1,
      limite: 10,
      dados: expect.any(Array),
    });

    const vendaNaLista = respostaLista.body.dados.find(
      (venda: { id: string }) =>
        venda.id === respostaVenda.body.id,
    );

    expect(vendaNaLista).toMatchObject({
      id: respostaVenda.body.id,
      formaPagamento: 'PIX',
      total: 21,
      quantidadeItens: 1,
    });

    // Consulta os detalhes e os preços históricos dos itens.
    const respostaDetalhes = await request(app!.getHttpServer())
      .get(`/vendas/${respostaVenda.body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(respostaDetalhes.body).toMatchObject({
      id: respostaVenda.body.id,
      formaPagamento: 'PIX',
      total: 21,
    });

    expect(respostaDetalhes.body.itens).toEqual([
      expect.objectContaining({
        quantidade: 2,
        precoUnitario: 10.5,
        subtotal: 21,
        produto: expect.objectContaining({
          id: produto.id,
          nome: 'Produto histórico E2E',
        }),
      }),
    ]);
  });

  it('deve impedir que uma empresa consulte vendas de outra', async () => {
    const tokenA = await obterToken(empresaAId, usuarioAEmail);
    const tokenB = await obterToken(empresaBId, usuarioBEmail);

    const produto = await criarProdutoPelaApi(
      tokenA,
      'Produto isolado para histórico E2E',
    );

    await movimentarEstoquePelaApi(tokenA, produto.id, {
      tipo: 'ENTRADA',
      quantidade: 3,
      motivo: 'Estoque para teste de isolamento de vendas',
    }).expect(201);

    const respostaVenda = await criarVendaPelaApi(tokenA, {
      formaPagamento: 'DINHEIRO',
      itens: [
        {
          produtoId: produto.id,
          quantidade: 1,
        },
      ],
    }).expect(201);

    vendasCriadas.push(respostaVenda.body.id);

    // A empresa B não deve encontrar a venda da empresa A.
    const respostaListaB = await request(app!.getHttpServer())
      .get('/vendas?pagina=1&limite=100')
      .set('Authorization', `Bearer ${tokenB}`)
      .expect(200);

    expect(
      respostaListaB.body.dados.some(
        (venda: { id: string }) =>
          venda.id === respostaVenda.body.id,
      ),
    ).toBe(false);

    // A consulta direta também precisa negar acesso.
    await request(app!.getHttpServer())
      .get(`/vendas/${respostaVenda.body.id}`)
      .set('Authorization', `Bearer ${tokenB}`)
      .expect(404);
  });

  it('deve impedir movimentações e consultas de estoque entre empresas', async () => {
    const tokenA = await obterToken(
      empresaAId,
      usuarioAEmail,
    );

    const tokenB = await obterToken(
      empresaBId,
      usuarioBEmail,
    );

    const produto = await criarProdutoPelaApi(
      tokenA,
      'Produto E2E protegido por empresa',
    );

    // A empresa B não pode movimentar o produto da empresa A.
    await movimentarEstoquePelaApi(
      tokenB,
      produto.id,
      {
        tipo: 'ENTRADA',
        quantidade: 5,
        motivo: 'Tentativa de acesso não autorizado',
      },
    ).expect(404);

    // A empresa B também não pode consultar o histórico do produto.
    await request(app!.getHttpServer())
      .get(`/produtos/${produto.id}/movimentacoes`)
      .set('Authorization', `Bearer ${tokenB}`)
      .expect(404);

    // Confirma que a operação recusada não alterou o saldo da empresa A.
    const consulta = await consultarProduto(
      tokenA,
      produto.id,
    );

    expect(
      Number(consulta.body.saldoEstoque.quantidadeDisponivel),
    ).toBe(0);
  });

  describe('provisionamento fiscal SaaS', () => {
    let tokenAdministrador: string;

    beforeAll(async () => {
      const resposta = await request(app!.getHttpServer())
        .post('/admin-plataforma/login')
        .send({ email: administradorEmail, senha: senhaTeste })
        .expect(200);

      expect(resposta.body.accessToken).toEqual(expect.any(String));
      tokenAdministrador = resposta.body.accessToken as string;
    });

    function montarPayloadFiscal(configuracaoFiscal: Record<string, string>) {
      // A rota valida os dígitos do CNPJ. Cada cenário usa uma raiz própria.
      const base = `${sortearRaizCnpjFiscal(10_000_000, 100_000_000)}0001`;
      const digito = (valor: string, pesos: number[]) => {
        const soma = pesos.reduce(
          (total, peso, indice) => total + Number(valor.charAt(indice)) * peso,
          0,
        );
        const resto = soma % 11;
        return resto < 2 ? 0 : 11 - resto;
      };
      const primeiro = digito(base, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
      const parcial = `${base}${primeiro}`;
      const cnpj = `${parcial}${digito(parcial, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])}`;
      const nome = `Empresa fiscal E2E ${administradorPlataformaId}-${cnpj}`;
      empresasProvisionamentoFiscal.push({ cnpj, nome });

      return {
        cnpj,
        nome,
        administradores: [
          {
            nome: 'Administrador fiscal E2E',
            email: `fiscal-${administradorPlataformaId}-${cnpj}@exemplo.com`,
            senha: senhaTeste,
          },
        ],
        configuracaoFiscal,
      };
    }

    const provisionar = (payload: ReturnType<typeof montarPayloadFiscal>) =>
      request(app!.getHttpServer())
        .post('/empresas/com-administradores')
        .set('Authorization', `Bearer ${tokenAdministrador}`)
        .send(payload);

    it('deve provisionar empresa com administrador e cadastro fiscal normalizado', async () => {
      const payload = montarPayloadFiscal({
        razaoSocial: '  Empresa Fiscal E2E  ',
        uf: ' sp ',
        cep: '01234567',
      });

      const resposta = await provisionar(payload).expect(201);
      const empresa = await prisma!.empresa.findUniqueOrThrow({
        where: { cnpj: payload.cnpj },
      });
      const fiscal = await prisma!.configuracaoFiscalEmpresa.findUniqueOrThrow({
        where: { empresaId: empresa.id },
      });
      const usuario = await prisma!.usuario.findFirstOrThrow({
        where: { empresaId: empresa.id, email: payload.administradores[0].email },
      });

      expect(resposta.body.empresa.id).toBe(empresa.id);
      expect(usuario.perfil).toBe('ADMINISTRADOR');
      expect(fiscal).toMatchObject({
        razaoSocial: 'Empresa Fiscal E2E',
        uf: 'SP',
        cep: '01234567',
      });

      // O evento SaaS aponta para a empresa alvo e guarda os nomes dos campos.
      const evento = await prisma!.eventoAuditoria.findFirstOrThrow({
        where: {
          atorId: administradorPlataformaId,
          tipoAtor: TipoAtorAuditoria.ADMIN_PLATAFORMA,
          empresaId: null,
          modulo: 'CONFIGURACAO_FISCAL',
          acao: 'CRIAR',
          entidadeId: fiscal.id,
          resultado: ResultadoAuditoria.SUCESSO,
        },
      });

      expect(evento.metadados).toEqual({
        empresaAlvoId: empresa.id,
        camposInformados: expect.arrayContaining(['razaoSocial', 'uf', 'cep']),
      });
    });

    it('deve rejeitar empresaId informado dentro da configuração fiscal', async () => {
      const payload = montarPayloadFiscal({
        razaoSocial: 'Empresa Fiscal E2E',
        empresaId: empresaAId,
      });

      const resposta = await provisionar(payload).expect(400);
      expect(JSON.stringify(resposta.body.message)).toContain('empresaId');
      expect(await prisma!.empresa.count({ where: { cnpj: payload.cnpj } })).toBe(0);
    });

    it('deve reverter o provisionamento quando a auditoria fiscal falhar', async () => {
      const payload = montarPayloadFiscal({ razaoSocial: 'Fiscal E2E Rollback' });
      const auditoria = app!.get(AuditoriaProvisionamentoE2E);
      const registrarOriginal = auditoria.registrar.bind(auditoria);
      const entidadesCriadas: string[] = [];
      let falhaInjetada = false;

      // A exceção ocorre após gravar o evento fiscal real e antes do commit.
      const simulacao = vi.spyOn(auditoria, 'registrar').mockImplementation(
        async (entrada, transacao) => {
          const evento = await registrarOriginal(entrada, transacao);
          if (
            transacao &&
            entrada.atorId === administradorPlataformaId &&
            entrada.resultado === ResultadoAuditoria.SUCESSO &&
            entrada.entidadeId
          ) {
            entidadesCriadas.push(entrada.entidadeId);
            if (entrada.modulo === 'CONFIGURACAO_FISCAL' && entrada.acao === 'CRIAR') {
              falhaInjetada = true;
              throw new Error('Falha de auditoria simulada no provisionamento fiscal.');
            }
          }
          return evento;
        },
      );

      try {
        await provisionar(payload).expect(500);
      } finally {
        simulacao.mockRestore();
      }

      expect(falhaInjetada).toBe(true);
      expect(entidadesCriadas).toHaveLength(3);

      // Consulta o banco após a resposta para verificar as gravações revertidas.
      const ids = { in: entidadesCriadas };
      const [empresas, usuarios, cadastros, sucessos] = await Promise.all([
        prisma!.empresa.count({ where: { cnpj: payload.cnpj } }),
        prisma!.usuario.count({ where: { id: ids } }),
        prisma!.configuracaoFiscalEmpresa.count({ where: { id: ids } }),
        prisma!.eventoAuditoria.count({
          where: {
            atorId: administradorPlataformaId,
            entidadeId: ids,
            resultado: ResultadoAuditoria.SUCESSO,
          },
        }),
      ]);
      expect({ empresas, usuarios, cadastros, sucessos }).toEqual({
        empresas: 0,
        usuarios: 0,
        cadastros: 0,
        sucessos: 0,
      });

      const falha = await prisma!.eventoAuditoria.findFirst({
        where: {
          atorId: administradorPlataformaId,
          modulo: 'EMPRESAS',
          acao: 'CRIAR_COM_ADMINISTRADORES',
          resultado: ResultadoAuditoria.FALHA,
        },
      });
      expect(falha).not.toBeNull();
    });
  });

  it('restringe o primeiro acesso e consome a autorização ao trocar a senha', async () => {
    const senhaTemporaria = 'TemporariaE2E_2026#Senha';
    const novaSenha = 'SenhaDefinitivaE2E_2026#';
    const email = 'primeiro-acesso-' + uuidPrimeiroAcessoE2E() + '@exemplo.com';
    const usuario = await prisma!.usuario.create({
      data: {
        nome: 'Primeiro Acesso E2E',
        empresaId: empresaAId,
        email,
        hashSenha: await argon2.hash(senhaTemporaria),
        perfil: 'CAIXA',
        ativo: true,
        deveTrocarSenha: true,
      },
    });
    usuariosCriados.push(usuario.id);

    const login = (senha: string) => request(app!.getHttpServer())
      .post('/auth/login')
      .send({ empresaId: empresaAId, email, senha });
    const alterar = (token: string, senha: string) => request(app!.getHttpServer())
      .post('/auth/primeiro-acesso')
      .set('Authorization', 'Bearer ' + token)
      .send({ novaSenha: senha });
    const consultar = (token: string) => request(app!.getHttpServer())
      .get('/usuarios/me')
      .set('Authorization', 'Bearer ' + token);

    const entrada = await login(senhaTemporaria).expect(200);
    expect(entrada.body).toMatchObject({
      requerTrocaSenha: true,
      tokenPrimeiroAcesso: expect.any(String),
      expiresIn: 300,
    });
    expect(entrada.body.accessToken).toBeUndefined();
    const token = entrada.body.tokenPrimeiroAcesso as string;

    // A autorização temporária não dá acesso às rotas empresariais.
    await consultar(token).expect(401);
    await alterar(token, senhaTemporaria).expect(400);
    const troca = await alterar(token, novaSenha);
    expect(troca.status, JSON.stringify(troca.body?.message)).toBe(204);
    await alterar(token, novaSenha).expect(401);
    await login(senhaTemporaria).expect(401);

    const sessao = await login(novaSenha).expect(200);
    expect(sessao.body.accessToken).toEqual(expect.any(String));
    await consultar(sessao.body.accessToken).expect(200);
    await alterar(sessao.body.accessToken, novaSenha).expect(401);

    const evento = await prisma!.eventoAuditoria.count({
      where: {
        empresaId: empresaAId,
        atorId: usuario.id,
        modulo: 'AUTH',
        acao: 'TROCAR_SENHA_PRIMEIRO_ACESSO',
        resultado: ResultadoAuditoria.SUCESSO,
      },
    });
    expect(evento).toBe(1);
  });
});
