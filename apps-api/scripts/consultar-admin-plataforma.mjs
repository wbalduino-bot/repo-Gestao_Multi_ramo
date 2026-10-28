import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

try {
  // Consulta o administrador já cadastrado, sem alterar o banco.
  const administrador = await prisma.administradorPlataforma.findUnique({
    where: {
      id: '71a675ea-07c8-44e8-851a-7115cfc00993',
    },
    select: {
      id: true,
      nome: true,
      email: true,
      ativo: true,
      criadoEm: true,
    },
  });

  if (!administrador) {
    console.log('Administrador não encontrado.');
  } else {
    console.log(
      JSON.stringify(
        {
          ...administrador,
          criadoEm: administrador.criadoEm.toISOString(),
        },
        null,
        2,
      ),
    );
  }
} catch (erro) {
  console.error('Erro ao consultar administrador:', erro.message);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
