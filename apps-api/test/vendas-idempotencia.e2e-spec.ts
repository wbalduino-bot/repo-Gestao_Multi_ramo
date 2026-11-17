import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Prisma, ResultadoAuditoria } from '@prisma/client';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import * as argon2 from 'argon2';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { AuditoriaService } from '../src/auditoria/auditoria.service.js';
import { configurarAplicacao } from '../src/configurar-aplicacao.js';

function validarBancoE2E() {
  try {
    const url = new URL(process.env.DATABASE_URL ?? '');
    if (process.env.NODE_ENV !== 'test' || !['postgresql:', 'postgres:'].includes(url.protocol) ||
        url.hostname !== '127.0.0.1' || url.port !== '5435' ||
        decodeURIComponent(url.pathname.slice(1)) !== 'gestao_test') throw new Error();
    if ([...url.searchParams.keys()].some(k => ['host', 'hostaddr', 'port', 'dbname', 'database', 'service', 'options'].includes(k.toLowerCase()))) throw new Error();
  } catch { throw new Error('E2E interrompido: exige NODE_ENV=test e 127.0.0.1:5435/gestao_test.'); }
}

// Antes de importar AppModule ou inicializar servicos que conectam ao banco.
validarBancoE2E();

describe('Vendas: idempotencia e concorrencia no PostgreSQL E2E', () => {
  let app: INestApplication<App> | undefined;
  let prisma: PrismaService | undefined;
  let bancoConfirmado = false;
  const empresas: string[] = [];
  let empresaA: string;
  let empresaB: string;
  let kgA: string;
  let kgB: string;
  let gerenteA: string;
  let caixaA: string;
  let gerenteB: string;
  const senha = 'E2E-' + randomUUID() + '!';

  beforeAll(async () => {
    validarBancoE2E();
    const { AppModule } = await import('../src/app.module.js');
    const modulo = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = modulo.createNestApplication();
    configurarAplicacao(app);
    await app.init();
    prisma = app.get(PrismaService);
    const atual = await prisma.$queryRaw<Array<{ banco: string }>>`SELECT current_database() AS banco`;
    if (atual[0]?.banco !== 'gestao_test') throw new Error('Banco conectado nao corresponde ao E2E.');
    bancoConfirmado = true;
    const colunas = await prisma.$queryRaw<Array<{ quantidade: bigint }>>`
      SELECT COUNT(*) AS quantidade FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'Venda'
      AND column_name IN ('chaveOperacao', 'hashRequisicao')`;
    if (Number(colunas[0]?.quantidade) !== 2) throw new Error('Aplique as migracoes no banco E2E antes desta suite.');

    const sufixo = randomUUID().replaceAll('-', '');
    for (const letra of ['A', 'B']) {
      const e = await prisma.empresa.create({ data: { nome: `E2E Idempotencia ${letra} ${sufixo}`, cnpj: `E2E-IDEMP-${sufixo}-${letra}` } });
      empresas.push(e.id);
    }
    [empresaA, empresaB] = empresas;
    kgA = (await prisma.unidade.create({ data: { empresaId: empresaA, codigo: 'KG', nome: 'Quilograma E2E' } })).id;
    kgB = (await prisma.unidade.create({ data: { empresaId: empresaB, codigo: 'KG', nome: 'Quilograma E2E' } })).id;
    const hashSenha = await argon2.hash(senha);
    async function usuario(empresaId: string, perfil: 'GERENTE' | 'CAIXA', rotulo: string) {
      const email = `idempotencia-${rotulo}-${sufixo}@exemplo.com`;
      await prisma!.usuario.create({ data: { empresaId, nome: `E2E ${rotulo}`, email, hashSenha, perfil, ativo: true } });
      const login = await request(app!.getHttpServer()).post('/auth/login').send({ empresaId, email, senha }).expect(200);
      expect(login.body.accessToken).toEqual(expect.any(String));
      return login.body.accessToken as string;
    }
    gerenteA = await usuario(empresaA, 'GERENTE', 'gerente-a');
    caixaA = await usuario(empresaA, 'CAIXA', 'caixa-a');
    gerenteB = await usuario(empresaB, 'GERENTE', 'gerente-b');
  }, 120000);

  afterAll(async () => {
    try {
      if (!prisma || !bancoConfirmado || empresas.length === 0) return;
      validarBancoE2E();
      const filtroEmpresa = { empresaId: { in: empresas } };
      const produtos = await prisma.produto.findMany({ where: filtroEmpresa, select: { id: true } });
      const vendas = await prisma.venda.findMany({ where: filtroEmpresa, select: { id: true } });
      await prisma.$transaction(async tx => {
        // Apenas empresas novas desta execucao; nunca ha deleteMany sem filtro.
        await tx.eventoAuditoria.deleteMany({ where: filtroEmpresa });
        if (vendas.length) await tx.itemVenda.deleteMany({ where: { vendaId: { in: vendas.map(v => v.id) } } });
        await tx.venda.deleteMany({ where: filtroEmpresa });
        if (produtos.length) {
          const filtroProdutos = { produtoId: { in: produtos.map(p => p.id) } };
          await tx.movimentacaoLoteEstoque.deleteMany({ where: filtroProdutos });
          await tx.loteEstoque.deleteMany({ where: filtroProdutos });
          await tx.movimentacaoEstoque.deleteMany({ where: filtroProdutos });
          await tx.saldoEstoque.deleteMany({ where: filtroProdutos });
        }
        await tx.produto.deleteMany({ where: filtroEmpresa });
        await tx.unidade.deleteMany({ where: filtroEmpresa });
        await tx.usuario.deleteMany({ where: filtroEmpresa });
        await tx.empresa.deleteMany({ where: { id: { in: empresas } } });
      }, { timeout: 30000 });
    } finally { if (app) await app.close(); }
  }, 60000);

  async function prepararProduto(outraEmpresa = false) {
    const token = outraEmpresa ? gerenteB : gerenteA;
    const p = await request(app!.getHttpServer()).post('/produtos').set('Authorization', `Bearer ${token}`)
      .send({ nome: 'Tomate E2E Idempotencia', sku: 'E2E-IDEMP-' + randomUUID(),
        preco: 10.50, custo: 7.25, unidadeId: outraEmpresa ? kgB : kgA }).expect(201);
    expect(p.body.id).toEqual(expect.any(String));
    await request(app!.getHttpServer()).post(`/produtos/${p.body.id}/movimentacoes`)
      .set('Authorization', `Bearer ${token}`)
      .send({ tipo: 'ENTRADA', quantidade: 10, motivo: 'Preparacao isolada E2E de idempotencia' }).expect(201);
    return p.body.id as string;
  }
  function pedido(produtoId: string, chaveOperacao = randomUUID()) {
    return { chaveOperacao, formaPagamento: 'PIX', itens: [{ produtoId, quantidade: 1.25 }] };
  }
  function enviar(token: string, corpo: ReturnType<typeof pedido>) {
    return request(app!.getHttpServer()).post('/vendas').set('Authorization', `Bearer ${token}`).send(corpo);
  }
  function consultar(token: string, chave: string) {
    return request(app!.getHttpServer()).get(`/vendas/operacoes/${chave}`).set('Authorization', `Bearer ${token}`);
  }
  async function comprovarUmaBaixa(empresaId: string, produtoId: string, chave: string, vendaId: string) {
    const vendas = await prisma!.venda.findMany({ where: { empresaId, chaveOperacao: chave }, include: { itens: true } });
    expect(vendas).toHaveLength(1);
    expect(vendas[0].id).toBe(vendaId);
    expect(vendas[0].itens).toHaveLength(1);
    expect(vendas[0].itens[0].quantidade.toFixed(3)).toBe('1.250');
    expect(vendas[0].itens[0].subtotal.toFixed(2)).toBe('13.13');
    const saldo = await prisma!.saldoEstoque.findFirst({ where: { empresaId, produtoId } });
    expect(saldo?.quantidadeDisponivel.toFixed(3)).toBe('8.750');
    const saidas = await prisma!.movimentacaoEstoque.findMany({ where: { empresaId, produtoId, tipo: 'SAIDA' } });
    expect(saidas).toHaveLength(1);
    expect(saidas[0].referenciaId).toBe(vendaId);
    expect(saidas[0].quantidade.toFixed(3)).toBe('1.250');
    expect(await prisma!.movimentacaoLoteEstoque.count({ where: { empresaId, produtoId, movimentacaoId: saidas[0].id } })).toBe(1);
    expect(await prisma!.eventoAuditoria.count({ where: { empresaId, entidade: 'VENDA', entidadeId: vendaId,
      modulo: 'VENDAS', acao: 'CRIAR', resultado: ResultadoAuditoria.SUCESSO } })).toBe(1);
  }

  it('Catalogo hortifruti: pesquisa alem dos primeiros cem por nome, SKU e codigo de barras', async () => {
    const prefixo = 'E2E-CAT-' + randomUUID().replaceAll('-', '');
    const codigoBarras = '789' + Date.now().toString().slice(-10);
    const registros = Array.from({ length: 105 }, (_, indice) => ({
      id: randomUUID(), empresaId: empresaA, nome: `${prefixo} Produto ${String(indice).padStart(3, '0')}`,
      sku: `${prefixo}-${indice}`, preco: new Prisma.Decimal(8), custo: new Prisma.Decimal(4),
      unidadeId: kgA, ativo: true, codigoBarras: indice === 104 ? codigoBarras : null,
    }));
    const alvo = registros[104];
    await prisma!.produto.createMany({ data: registros });
    await prisma!.produto.create({ data: { ...alvo, id: randomUUID(), sku: prefixo + '-inativo', ativo: false } });
    await prisma!.produto.create({ data: { ...alvo, id: randomUUID(), empresaId: empresaB, unidadeId: kgB } });
    const listar = (query: { busca: string; pagina: number; limite: number; ativo: boolean }) =>
      request(app!.getHttpServer()).get('/produtos').set('Authorization', `Bearer ${caixaA}`).query(query);
    const primeira = await listar({ busca: prefixo, pagina: 1, limite: 100, ativo: true }).expect(200);
    expect(primeira.body.total).toBe(105);
    expect(primeira.body.dados).toHaveLength(100);
    expect(primeira.body.dados.some((p: { id: string }) => p.id === alvo.id)).toBe(false);
    const ultima = await listar({ busca: prefixo, pagina: 6, limite: 20, ativo: true }).expect(200);
    expect(ultima.body.totalPaginas).toBe(6);
    expect(ultima.body.dados).toHaveLength(5);
    expect(ultima.body.dados.some((p: { id: string }) => p.id === alvo.id)).toBe(true);
    for (const busca of [alvo.nome, alvo.sku, codigoBarras]) {
      const r = await listar({ busca, pagina: 1, limite: 20, ativo: true }).expect(200);
      expect(r.body.total).toBe(1);
      expect(r.body.dados).toHaveLength(1);
      expect(r.body.dados[0].id).toBe(alvo.id);
      expect(r.body.dados[0].unidadeCodigo).toBe('KG');
    }
  }, 60000);

  it('Catalogo hortifruti: recupera produto por ID com unidade e saldo para restaurar o carrinho', async () => {
    const produtoId = await prepararProduto();
    const r = await request(app!.getHttpServer()).get(`/produtos/${produtoId}`)
      .set('Authorization', `Bearer ${caixaA}`).expect(200);
    expect(r.body.id).toBe(produtoId);
    expect(r.body.unidadeCodigo).toBe('KG');
    expect(Number(r.body.saldoEstoque.quantidadeDisponivel)).toBe(10);
  }, 60000);

  it('reenvio retorna o mesmo id e valor historico, mesmo com preco atualizado', async () => {
    const produto = await prepararProduto();
    const corpo = pedido(produto);
    const primeira = await enviar(caixaA, corpo).expect(201);
    expect(primeira.body.total).toBe(13.13);
    expect(primeira.body).not.toHaveProperty('custoTotal');
    await prisma!.produto.update({ where: { id: produto }, data: { preco: new Prisma.Decimal(99) } });
    const repetida = await enviar(caixaA, corpo).expect(201);
    expect(repetida.body.id).toBe(primeira.body.id);
    expect(repetida.body.total).toBe(13.13);
    expect(repetida.body).not.toHaveProperty('lucroBrutoTotal');
    const resultado = await consultar(caixaA, corpo.chaveOperacao).expect(200);
    expect(resultado.body.situacao).toBe('CONCLUIDA');
    expect(resultado.body.venda.id).toBe(primeira.body.id);
    expect(resultado.body.venda).not.toHaveProperty('custoTotal');
    expect(resultado.body.venda.itens[0]).not.toHaveProperty('custoUnitario');
    await comprovarUmaBaixa(empresaA, produto, corpo.chaveOperacao, primeira.body.id);
  }, 60000);

  it('duas confirmacoes simultaneas e um reenvio geram uma unica venda e baixa', async () => {
    const produto = await prepararProduto();
    const corpo = pedido(produto);
    const respostas = await Promise.all([enviar(caixaA, corpo), enviar(caixaA, corpo)]);
    for (const resposta of respostas) expect([201, 409]).toContain(resposta.status);
    const vencedora = respostas.find(r => r.status === 201);
    expect(vencedora).toBeDefined();
    const repetida = await enviar(caixaA, corpo).expect(201);
    expect(repetida.body.id).toBe(vencedora!.body.id);
    for (const r of respostas.filter(r => r.status === 201)) expect(r.body.id).toBe(repetida.body.id);
    await comprovarUmaBaixa(empresaA, produto, corpo.chaveOperacao, repetida.body.id);
  }, 60000);

  it('mesma chave com quantidade ou pagamento diferente retorna conflito sem segunda baixa', async () => {
    const produto = await prepararProduto();
    const corpo = pedido(produto);
    const primeira = await enviar(caixaA, corpo).expect(201);
    await enviar(caixaA, { ...corpo, itens: [{ produtoId: produto, quantidade: 2 }] }).expect(409);
    await enviar(caixaA, { ...corpo, formaPagamento: 'CARTAO_DEBITO' }).expect(409);
    await comprovarUmaBaixa(empresaA, produto, corpo.chaveOperacao, primeira.body.id);
  }, 60000);

  it('outro usuario nao reutiliza a chave nem recupera a venda por essa consulta', async () => {
    const produto = await prepararProduto();
    const corpo = pedido(produto);
    const primeira = await enviar(caixaA, corpo).expect(201);
    await enviar(gerenteA, corpo).expect(409);
    const consulta = await consultar(gerenteA, corpo.chaveOperacao).expect(200);
    expect(consulta.body).toEqual({ situacao: 'NAO_LOCALIZADA' });
    await comprovarUmaBaixa(empresaA, produto, corpo.chaveOperacao, primeira.body.id);
  }, 60000);

  it('a mesma chave em empresas distintas mantem vendas e estoques isolados', async () => {
    const a = await prepararProduto();
    const b = await prepararProduto(true);
    const chave = randomUUID();
    const vendaA = await enviar(caixaA, pedido(a, chave)).expect(201);
    const vendaB = await enviar(gerenteB, pedido(b, chave)).expect(201);
    expect(vendaA.body.id).not.toBe(vendaB.body.id);
    const consultaA = await consultar(caixaA, chave).expect(200);
    const consultaB = await consultar(gerenteB, chave).expect(200);
    expect(consultaA.body.venda.id).toBe(vendaA.body.id);
    expect(consultaB.body.venda.id).toBe(vendaB.body.id);
    await comprovarUmaBaixa(empresaA, a, chave, vendaA.body.id);
    await comprovarUmaBaixa(empresaB, b, chave, vendaB.body.id);
  }, 60000);

  it('consultar chave ainda nao concluida nao cria nem cancela uma venda', async () => {
    const antes = await prisma!.venda.count({ where: { empresaId: empresaA } });
    const r = await consultar(caixaA, randomUUID()).expect(200);
    expect(r.body).toEqual({ situacao: 'NAO_LOCALIZADA' });
    expect(await prisma!.venda.count({ where: { empresaId: empresaA } })).toBe(antes);
  }, 30000);

  it('falha na auditoria reverte venda, saldo e saida de lote; mesma chave pode ser reenviada', async () => {
    const produto = await prepararProduto();
    const corpo = pedido(produto);
    const auditoria = app!.get(AuditoriaService);
    const original = auditoria.registrar.bind(auditoria);
    const espiao = vi.spyOn(auditoria, 'registrar').mockImplementation(async (...args: Parameters<AuditoriaService['registrar']>) => {
      const [evento] = args;
      if (evento.empresaId === empresaA && evento.modulo === 'VENDAS' && evento.acao === 'CRIAR' &&
          evento.resultado === ResultadoAuditoria.SUCESSO) throw new Error('Falha E2E controlada de auditoria');
      return original(...args);
    });
    try {
      await enviar(caixaA, corpo).expect(500);
      expect(await prisma!.venda.count({ where: { empresaId: empresaA, chaveOperacao: corpo.chaveOperacao } })).toBe(0);
      const saldo = await prisma!.saldoEstoque.findFirst({ where: { empresaId: empresaA, produtoId: produto } });
      expect(saldo?.quantidadeDisponivel.toFixed(3)).toBe('10.000');
      expect(await prisma!.movimentacaoEstoque.count({ where: { empresaId: empresaA, produtoId: produto, tipo: 'SAIDA' } })).toBe(0);
      // A entrada inicial gera um movimento de lote. A saida abortada nao pode permanecer.
      expect(await prisma!.movimentacaoLoteEstoque.count({ where: { empresaId: empresaA, produtoId: produto } })).toBe(1);
    } finally { espiao.mockRestore(); }
    const resposta = await enviar(caixaA, corpo).expect(201);
    await comprovarUmaBaixa(empresaA, produto, corpo.chaveOperacao, resposta.body.id);
  }, 60000);
});
