import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ResultadoAuditoria } from '@prisma/client';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import * as argon2 from 'argon2';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { AuditoriaService } from '../src/auditoria/auditoria.service.js';
import { configurarAplicacao } from '../src/configurar-aplicacao.js';

function validarBanco() {
  const url = new URL(process.env.DATABASE_URL ?? 'http://invalido');
  if (process.env.NODE_ENV !== 'test' || !['postgres:', 'postgresql:'].includes(url.protocol) ||
      url.hostname !== '127.0.0.1' || url.port !== '5435' || url.pathname !== '/gestao_test' ||
      [...url.searchParams.keys()].some(k => ['host', 'hostaddr', 'port', 'dbname', 'database', 'service', 'options'].includes(k.toLowerCase()))) {
    throw new Error('Trial E2E exige NODE_ENV=test e 127.0.0.1:5435/gestao_test.');
  }
}
validarBanco();

describe('Trial: autorizacao, vencimento e liberacao no PostgreSQL E2E', () => {
  let app: INestApplication<App> | undefined;
  let prisma: PrismaService;
  let bancoConfirmado = false;
  const empresas: string[] = [];
  let administradorId: string | undefined;
  let tokenAdmin: string;
  let tokenCliente: string;
  let emailCliente: string;
  const senha = 'TrialE2E-' + randomUUID() + '!';

  beforeAll(async () => {
    validarBanco();
    const { AppModule } = await import('../src/app.module.js');
    const modulo = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = modulo.createNestApplication();
    configurarAplicacao(app);
    await app.init();
    prisma = app.get(PrismaService);
    const banco = await prisma.$queryRaw<Array<{ banco: string }>>`SELECT current_database() AS banco`;
    if (banco[0]?.banco !== 'gestao_test') throw new Error('Banco diferente do E2E.');
    bancoConfirmado = true;
    const sufixo = randomUUID();
    for (const letra of ['A', 'B']) {
      const empresa = await prisma.empresa.create({ data: { nome: `Trial E2E ${letra} ${sufixo}`, cnpj: `TRIAL-E2E-${letra}-${sufixo}` } });
      empresas.push(empresa.id);
    }
    const hashSenha = await argon2.hash(senha);
    emailCliente = `trial-cliente-${sufixo}@exemplo.com`;
    await prisma.usuario.create({ data: { empresaId: empresas[0], nome: 'Cliente E2E', email: emailCliente, hashSenha, perfil: 'ADMINISTRADOR', ativo: true, deveTrocarSenha: false } });
    const adminEmail = `trial-admin-${sufixo}@exemplo.com`;
    administradorId = (await prisma.administradorPlataforma.create({ data: { nome: 'Admin Trial E2E', email: adminEmail, hashSenha, ativo: true } })).id;
    tokenAdmin = (await request(app.getHttpServer()).post('/admin-plataforma/login').send({ email: adminEmail, senha }).expect(200)).body.accessToken;
    tokenCliente = (await login().expect(200)).body.accessToken;
    expect(tokenAdmin).toEqual(expect.any(String));
  }, 120000);

  afterAll(async () => {
    try {
      if (!bancoConfirmado) return;
      validarBanco();
      if (empresas.length) {
        await prisma.eventoAuditoria.deleteMany({ where: { OR: [
          { empresaId: { in: empresas } }, { entidadeId: { in: empresas } },
          ...(administradorId ? [{ atorId: administradorId }] : []),
        ] } });
        await prisma.usuario.deleteMany({ where: { empresaId: { in: empresas } } });
        await prisma.empresa.deleteMany({ where: { id: { in: empresas } } });
      }
      if (administradorId) await prisma.administradorPlataforma.delete({ where: { id: administradorId } });
    } finally { await app?.close(); }
  });

  function login() {
    return request(app!.getHttpServer()).post('/auth/login').send({ empresaId: empresas[0], email: emailCliente, senha });
  }
  function alterar(modalidade: 'TRIAL' | 'DEFINITIVO', versaoAcesso: number, token = tokenAdmin) {
    return request(app!.getHttpServer()).patch(`/empresas/${empresas[0]}/trial`)
      .set('Authorization', `Bearer ${token}`).send({ modalidade, versaoAcesso, justificativa: 'Operacao controlada do teste E2E' });
  }
  async function empresa() { return prisma.empresa.findUniqueOrThrow({ where: { id: empresas[0] } }); }

  it('preserva empresas existentes como definitivas e inicia 30 dias individualmente', async () => {
    const original = await empresa();
    expect(original.modalidadeAcesso).toBe('DEFINITIVO');
    const resposta = await alterar('TRIAL', original.versaoAcesso).expect(200);
    expect(resposta.body.modalidadeAcesso).toBe('TRIAL');
    expect(Date.parse(resposta.body.trialTerminaEm) - Date.parse(resposta.body.trialIniciadoEm)).toBe(30 * 86400000);
    const outra = await prisma.empresa.findUniqueOrThrow({ where: { id: empresas[1] } });
    expect(outra.modalidadeAcesso).toBe('DEFINITIVO');
  });
  it('informa prazo para aviso usando a sessao atual', async () => {
    await prisma.empresa.update({ where: { id: empresas[0] }, data: { trialIniciadoEm: new Date(Date.now() - 86400000), trialTerminaEm: new Date(Date.now() + 7.5 * 86400000) } });
    const resposta = await request(app!.getHttpServer()).get('/usuarios/me').set('Authorization', `Bearer ${tokenCliente}`).expect(200);
    expect(resposta.body.trial.diasRestantes).toBe(8);
  });
  it('bloqueia login e token emitido antes do vencimento', async () => {
    await prisma.empresa.update({ where: { id: empresas[0] }, data: { trialIniciadoEm: new Date(Date.now() - 31 * 86400000), trialTerminaEm: new Date(Date.now() - 1000) } });
    expect((await login().expect(401)).body.codigo).toBe('TRIAL_EXPIRADO');
    const resposta = await request(app!.getHttpServer()).get('/usuarios/me').set('Authorization', `Bearer ${tokenCliente}`).expect(401);
    expect(resposta.body.codigo).toBe('TRIAL_EXPIRADO');
  });
  it('cliente empresarial nao remove o proprio trial e versao antiga gera conflito', async () => {
    const atual = await empresa();
    const negada = await alterar('DEFINITIVO', atual.versaoAcesso, tokenCliente);
    expect([401, 403]).toContain(negada.status);
    await alterar('DEFINITIVO', atual.versaoAcesso + 1).expect(409);
    expect((await empresa()).modalidadeAcesso).toBe('TRIAL');
  });
  it('falha na auditoria reverte a liberacao', async () => {
    const anterior = await empresa();
    const auditoria = app!.get(AuditoriaService);
    const original = auditoria.registrar.bind(auditoria);
    const spy = vi.spyOn(auditoria, 'registrar').mockImplementation(async (...args) => {
      if (args[0].acao === 'REMOVER_TRIAL' && args[0].resultado === ResultadoAuditoria.SUCESSO) throw new Error('Falha controlada E2E trial');
      return original(...args);
    });
    try { await alterar('DEFINITIVO', anterior.versaoAcesso).expect(500); }
    finally { spy.mockRestore(); }
    expect((await empresa()).versaoAcesso).toBe(anterior.versaoAcesso);
    expect((await empresa()).modalidadeAcesso).toBe('TRIAL');
  });
  it('pagamento permite remover trial vencido e recuperar acesso com dados preservados', async () => {
    const anterior = await empresa();
    await alterar('DEFINITIVO', anterior.versaoAcesso).expect(200);
    const resposta = await login().expect(200);
    expect(resposta.body.accessToken).toEqual(expect.any(String));
    const me = await request(app!.getHttpServer()).get('/usuarios/me').set('Authorization', `Bearer ${resposta.body.accessToken}`).expect(200);
    expect(me.body).not.toHaveProperty('trial');
    expect((await empresa()).nome).toBe(anterior.nome);
    const evento = await prisma.eventoAuditoria.findFirst({ where: { entidadeId: empresas[0], atorId: administradorId, acao: 'REMOVER_TRIAL', resultado: 'SUCESSO' } });
    expect(evento).not.toBeNull();
  });
  it('reiniciar trial nao reativa empresa desativada administrativamente', async () => {
    await prisma.empresa.update({ where: { id: empresas[0] }, data: { ativo: false } });
    await alterar('TRIAL', (await empresa()).versaoAcesso).expect(200);
    expect((await empresa()).ativo).toBe(false);
    await login().expect(401);
  });
});
