import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { CriarEmpresaDto } from './dto/criar-empresa.dto.js';
import { AtualizarEmpresaDto } from './dto/atualizar-empresa.dto.js';
import { ListarEmpresasDto } from './dto/listar-empresas.dto.js';

function normalizarCnpj(cnpj: string): string {
  return cnpj.replace(/[./-]/g, '').toUpperCase();
}

function cnpjValido(cnpjInformado: string): boolean {
  const cnpj = normalizarCnpj(cnpjInformado);

  if (!/^[A-Z0-9]{12}\d{2}$/.test(cnpj)) return false;
  if (/^(\w)\1+$/.test(cnpj)) return false;

  const calcularDigito = (base: string): number => {
    const pesos =
      base.length === 12
        ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
        : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];

    const soma = [...base].reduce(
      (total, caractere, indice) =>
        total + (caractere.charCodeAt(0) - 48) * pesos[indice],
      0,
    );

    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
  };

  const base = cnpj.slice(0, 12);
  const primeiro = calcularDigito(base);
  const segundo = calcularDigito(base + primeiro);

  return cnpj.endsWith(`${primeiro}${segundo}`);
}

@Injectable()
export class EmpresasService {
  constructor(private readonly prisma: PrismaService) {}

  async criar(dto: CriarEmpresaDto) {
    const cnpj = normalizarCnpj(dto.cnpj);

    if (!cnpjValido(cnpj)) {
      throw new BadRequestException('CNPJ inválido.');
    }

    try {
      return await this.prisma.empresa.create({
        data: { nome: dto.nome.trim(), cnpj },
      });
    } catch (erro) {
      this.tratarErroPrisma(erro);
    }
  }

  async listar(filtros: ListarEmpresasDto) {
    const pagina = filtros.pagina ?? 1;
    const limite = filtros.limite ?? 20;

    const where: Prisma.EmpresaWhereInput = {};

    if (filtros.ativo !== undefined) {
      where.ativo = filtros.ativo;
    }

    const [dados, total] = await this.prisma.$transaction([
      this.prisma.empresa.findMany({
        where,
        orderBy: { criadoEm: 'desc' },
        skip: (pagina - 1) * limite,
        take: limite,
      }),
      this.prisma.empresa.count({ where }),
    ]);

    return {
      dados,
      total,
      pagina,
      limite,
      totalPaginas: Math.ceil(total / limite),
    };
  }

  async buscarPorId(id: string) {
    const empresa = await this.prisma.empresa.findUnique({
      where: { id },
    });

    if (!empresa) {
      throw new NotFoundException('Empresa não encontrada.');
    }

    return empresa;
  }

  async atualizar(id: string, dto: AtualizarEmpresaDto) {
    const data: Prisma.EmpresaUpdateInput = {};

    if (dto.nome !== undefined) {
      data.nome = dto.nome.trim();
    }

    if (dto.cnpj !== undefined) {
      const cnpj = normalizarCnpj(dto.cnpj);

      if (!cnpjValido(cnpj)) {
        throw new BadRequestException('CNPJ inválido.');
      }

      data.cnpj = cnpj;
    }

    if (dto.ativo !== undefined) {
      data.ativo = dto.ativo;
    }

    try {
      return await this.prisma.empresa.update({
        where: { id },
        data,
      });
    } catch (erro) {
      this.tratarErroPrisma(erro);
    }
  }

  async alterarAtivacao(id: string, ativo: boolean) {
    try {
      return await this.prisma.empresa.update({
        where: { id },
        data: { ativo },
      });
    } catch (erro) {
      this.tratarErroPrisma(erro);
    }
  }

  private tratarErroPrisma(erro: unknown): never {
    if (
      erro instanceof Prisma.PrismaClientKnownRequestError &&
      erro.code === 'P2002'
    ) {
      throw new ConflictException(
        'Já existe uma empresa cadastrada com este CNPJ.',
      );
    }

    if (
      erro instanceof Prisma.PrismaClientKnownRequestError &&
      erro.code === 'P2025'
    ) {
      throw new NotFoundException('Empresa não encontrada.');
    }

    throw erro;
  }
}
