
import 'dotenv/config';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { PrismaClient, PerfilAcesso } from '@prisma/client';
import argon2 from 'argon2';

// Cria a conexão com o banco de dados por meio do Prisma.
const prisma = new PrismaClient();

// Faz perguntas comuns no terminal, como nome e e-mail.
async function perguntar(mensagem) {
  const terminal = createInterface({ input: stdin, output: stdout });

  try {
    return (await terminal.question(mensagem)).trim();
  } finally {
    terminal.close();
  }
}

// Lê a senha sem exibir os caracteres digitados no terminal.
function perguntarSenha(mensagem) {
  return new Promise((resolve, reject) => {
    if (!stdin.isTTY || typeof stdin.setRawMode !== 'function') {
      reject(
        new Error(
          'O terminal não permite entrada oculta. Execute pelo Git Bash interativo.',
        ),
      );
      return;
    }

    stdout.write(mensagem);
    let senha = '';

    // Ativa o modo de entrada direta para ocultar a senha.
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');

    function restaurarTerminal() {
      stdin.removeListener('data', aoDigitar);
      stdin.setRawMode(false);
      stdout.write('\n');
    }

    function aoDigitar(caractere) {
      // Permite cancelar a operação com Ctrl+C.
      if (caractere === '\u0003') {
        restaurarTerminal();
        reject(new Error('Operação cancelada.'));
        return;
      }

      // Enter confirma a senha digitada.
      if (caractere === '\r' || caractere === '\n') {
        restaurarTerminal();
        resolve(senha);
        return;
      }

      // Backspace apaga o último caractere digitado.
      if (caractere === '\u0008' || caractere === '\u007f') {
        senha = senha.slice(0, -1);
        return;
      }

      // Ignora outros caracteres de controle.
      if (caractere >= ' ') {
        senha += caractere;
      }
    }

    stdin.on('data', aoDigitar);
  });
}

async function main() {
  console.log('\n=== Cadastro do administrador inicial ===\n');

  // Identifica a empresa à qual o administrador estará vinculado.
  const empresaId = await perguntar('ID da empresa: ');

  const empresa = await prisma.empresa.findUnique({
    where: { id: empresaId },
    select: { id: true, nome: true, ativo: true },
  });

  // Não permite cadastrar usuário para empresa inexistente ou inativa.
  if (!empresa || !empresa.ativo) {
    throw new Error('Empresa não encontrada ou está inativa.');
  }

  console.log(`Empresa selecionada: ${empresa.nome}\n`);

  const nome = await perguntar('Nome do administrador: ');
  const email = (await perguntar('E-mail do administrador: '))
    .toLowerCase()
    .trim();

  if (!nome || !email || !email.includes('@')) {
    throw new Error('Informe um nome e um e-mail válidos.');
  }

  // Confere se já existe um usuário com esse e-mail nessa empresa.
  const existente = await prisma.usuario.findUnique({
    where: {
      empresaId_email: {
        empresaId: empresa.id,
        email,
      },
    },
    select: { id: true },
  });

  if (existente) {
    throw new Error('Já existe um usuário com esse e-mail nessa empresa.');
  }

  const senha = await perguntarSenha('Digite a senha (mínimo 8 caracteres): ');

  if (senha.length < 8) {
    throw new Error('A senha precisa ter pelo menos 8 caracteres.');
  }

  const confirmacao = await perguntarSenha('Confirme a senha: ');

  if (senha !== confirmacao) {
    throw new Error('As senhas não coincidem.');
  }

  // Gera um hash seguro. A senha original não será armazenada no banco.
  const hashSenha = await argon2.hash(senha);

  // Cria o usuário ativo com o perfil de administrador.
  const usuario = await prisma.usuario.create({
    data: {
      empresaId: empresa.id,
      nome,
      email,
      hashSenha,
      perfil: PerfilAcesso.ADMINISTRADOR,
      ativo: true,
    },
    select: {
      id: true,
      nome: true,
      email: true,
      perfil: true,
      empresaId: true,
    },
  });

  // Exibe apenas os dados públicos do usuário criado.
  console.log('\nAdministrador criado com sucesso!');
  console.table(usuario);
}

main()
  .catch((erro) => {
    console.error('\nNão foi possível criar o administrador:', erro.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    // Encerra a conexão com o banco, mesmo se ocorrer um erro.
    await prisma.$disconnect();
  });
