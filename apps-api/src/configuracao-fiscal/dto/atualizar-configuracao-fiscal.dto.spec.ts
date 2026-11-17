import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';

import { AtualizarConfiguracaoFiscalDto } from './atualizar-configuracao-fiscal.dto.js';

/**
 * Executa a transformação e a validação utilizadas pela API.
 *
 * As opções de whitelist reproduzem o comportamento da
 * ValidationPipe global configurada no projeto.
 */
async function validarDto(dados: Record<string, unknown>) {
  const dto = plainToInstance(
    AtualizarConfiguracaoFiscalDto,
    dados,
  );

  const erros = await validate(dto, {
    whitelist: true,
    forbidNonWhitelisted: true,
  });

  return { dto, erros };
}

describe('AtualizarConfiguracaoFiscalDto', () => {
  it('deve aceitar dados fiscais com formatos cadastrais válidos', async () => {
    const { erros } = await validarDto({
      razaoSocial: 'Empresa Exemplo Ltda',
      codigoCRT: '1',
      codigoMunicipio: '3550308',
      uf: 'SP',
      cep: '01001000',
    });

    expect(erros).toHaveLength(0);
  });

  it('deve rejeitar CRT com caracteres não numéricos', async () => {
    const { erros } = await validarDto({
      codigoCRT: 'AB',
    });

    expect(erros.some((erro) => erro.property === 'codigoCRT'))
      .toBe(true);
  });

  it('deve rejeitar CEP com quantidade incorreta de dígitos', async () => {
    const { erros } = await validarDto({
      cep: '1234567',
    });

    expect(erros.some((erro) => erro.property === 'cep'))
      .toBe(true);
  });

  it('deve rejeitar código municipal com formato inválido', async () => {
    const { erros } = await validarDto({
      codigoMunicipio: '123456',
    });

    expect(
      erros.some((erro) => erro.property === 'codigoMunicipio'),
    ).toBe(true);
  });

  it('deve normalizar UF minúscula e espaços externos', async () => {
    const { dto, erros } = await validarDto({
      uf: ' sp ',
    });

    expect(erros).toHaveLength(0);
    expect(dto.uf).toBe('SP');
  });

  it('deve rejeitar UF inexistente', async () => {
    const { erros } = await validarDto({
      uf: 'XX',
    });

    expect(erros.some((erro) => erro.property === 'uf'))
      .toBe(true);
  });

  it('deve permitir campos omitidos no cadastro parcial', async () => {
    const { erros } = await validarDto({
      razaoSocial: 'Empresa Exemplo',
    });

    expect(erros).toHaveLength(0);
  });

  it('deve permitir null para limpar um campo opcional', async () => {
    const { dto, erros } = await validarDto({
      complemento: null,
    });

    expect(erros).toHaveLength(0);
    expect(dto.complemento).toBeNull();
  });

  it('deve converter texto vazio em null', async () => {
    const { dto, erros } = await validarDto({
      nomeFantasia: '   ',
    });

    expect(erros).toHaveLength(0);
    expect(dto.nomeFantasia).toBeNull();
  });

  it('deve rejeitar empresaId enviado pelo cliente', async () => {
    const { erros } = await validarDto({
      razaoSocial: 'Empresa Exemplo',
      empresaId: 'empresa-de-outra-conta',
    });

    expect(
      erros.some((erro) => erro.property === 'empresaId'),
    ).toBe(true);
  });

  it('deve rejeitar valores numéricos em campos de texto', async () => {
    const { erros } = await validarDto({
      razaoSocial: 12345,
    });

    expect(
      erros.some((erro) => erro.property === 'razaoSocial'),
    ).toBe(true);
  });
});
