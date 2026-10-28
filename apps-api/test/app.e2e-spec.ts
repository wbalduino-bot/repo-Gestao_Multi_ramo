
import { randomUUID } from 'node:crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types.js';
import * as argon2 from 'argon2';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from './../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

/**
 * Testes E2E da aplicação, autenticação, produtos e estoque.
 *
 * Os testes utilizam:
 * - A aplicação NestJS real.
 * - As rotas HTTP protegidas por autenticação.
 * - O PostgreSQL exclusivo para testes.
 *
 * Cenários validados:
 * - Autenticação e isolamento entre empresas.
 * - Cadastro, consulta, atualização e desativação de produtos.
 * - Entrada, saída e ajustes de estoque.
 * - Bloqueio de saídas que ultrapassam o saldo disponível.
 * - Histórico paginado de movimentações.
 * - Limpeza dos registros criados durante a execução.
 */
describe('Aplicação, autenticação, produtos e estoque (e2e)', () => {
  let app: INestApplication<App> | undefined;
  let prisma: PrismaService | undefined;

  // Registra somente os IDs criados por esta execução da suíte.
  const empresasCriadas: string[] = [];
  const usuariosCriados: string[] = [];
  const produtosCriados: string[] = [];
  const vendasCriadas: string[] = [];

  const senhaTeste = 'SenhaE2E_2026!';

  let empresaAId: string;
  let empresaBId: string;

  let usuarioAEmail: string;
  let usuarioBEmail: string;

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
      url.port !== '5432' ||
      banco !== 'gestao_test'
    ) {
      throw new Error(
        'E2E interrompido: a conexão precisa apontar para ' +
          '127.0.0.1:5432/gestao_test.',
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
    await app.init();

    prisma = app.get(PrismaService);

    // Gera identificadores exclusivos para evitar colisões.
    const sufixo = randomUUID().replaceAll('-', '');

    usuarioAEmail = `e2e-a-${sufixo}@exemplo.com`;
    usuarioBEmail = `e2e-b-${sufixo}@exemplo.com`;

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
  });

  // ============================================================
  // LIMPEZA DOS DADOS CRIADOS PELA SUÍTE
  // ============================================================

  afterAll(async () => {
    try {
      if (!prisma) {
        return;
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
       * 5. Empresas.
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

        // 1. Remove as movimentações relacionadas aos produtos de teste.
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

      // 5. Remove as empresas criadas durante esta execução.
      if (empresasCriadas.length > 0) {
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
   * O tipo, a quantidade e o motivo são enviados pelo corpo da
   * requisição. A empresa e o usuário vêm do token autenticado.
   *
   * A empresa e o usuário responsável são definidos pelo token JWT.
   */
  function movimentarEstoquePelaApi(
    token: string,
    produtoId: string,
    dados: {
      tipo: 'ENTRADA' | 'SAIDA' | 'AJUSTE';
      quantidade: number;
      motivo: string;
      referenciaId?: string;
    },
  ) {
    return request(app!.getHttpServer())
      .post(`/produtos/${produtoId}/movimentacoes`)
      .set('Authorization', `Bearer ${token}`)
      .send(dados);
  }

    /**
   * Envia uma venda pela API com o usuário autenticado.
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

    // Confirma o tipo, a quantidade, o saldo e a auditoria.
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

    // Confirma que o histórico inclui informações de auditoria.
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
});
