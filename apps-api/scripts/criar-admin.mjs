import { PrismaClient, PerfilAcesso } from '@prisma/client';
import * as argon2 from 'argon2';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

const prisma = new PrismaClient();
const rl = createInterface({ input: stdin, output: stdout });

try {
  const empresaId = await rl.question('ID da empresa: ');
  const nome = (await rl.question('Nome do administrador: ')).trim();
  const email = (await rl.question('E-mail de acesso: ')).trim().toLowerCase();
  const senha = process.env.ADMIN_PASSWORD;

  if (!senha || senha.length < 8) {
    throw new Error('A senha deve ter pelo menos 8 caracteres.');
  }

  const empresa = await prisma.empresa.findUnique({
    where: { id: empresaId },
    select: { id: true, ativo: true },
  });

  if (!empresa || !empresa.ativo) {
    throw new Error('Empresa não encontrada ou inativa.');
  }

  const existente = await prisma.usuario.findUnique({
    where: { empresaId_email: { empresaId, email } },
  });

  if (existente) {
    throw new Error('Já existe um usuário com esse e-mail nesta empresa.');
  }

  const hashSenha = await argon2.hash(senha);

  const usuario = await prisma.usuario.create({
    data: {
      empresaId,
      nome,
      email,
      hashSenha,
      perfil: PerfilAcesso.ADMINISTRADOR,
    },
    select: {
      id: true,
      empresaId: true,
      nome: true,
      email: true,
      perfil: true,
    },
  });

  console.log('\nAdministrador criado com sucesso:');
  console.log(JSON.stringify(usuario, null, 2));
} finally {
  rl.close();
  await prisma.$disconnect();
}
