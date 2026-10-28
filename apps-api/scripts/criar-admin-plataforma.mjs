
import 'dotenv/config';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { PrismaClient } from '@prisma/client';
import argon2 from 'argon2';

// Inicializa o Prisma Client para acessar o banco PostgreSQL.
const prisma = new PrismaClient();

/**
 * Solicita uma informação pelo terminal.
 * Esta função é utilizada para dados que não são senhas.
 *
 * @param {string} mensagem - Pergunta exibida ao operador.
 * @returns {Promise<string>} Resposta digitada, sem espaços nas extremidades.
 */
async function perguntar(mensagem) {
  const terminal = createInterface({
    input: stdin,
    output: stdout,
  });

  try {
    return (await terminal.question(mensagem)).trim();
  } finally {
    // Fecha a interface de leitura após cada pergunta.
    terminal.close();
  }
}

/**
 * Solicita uma senha sem exibir os caracteres digitados.
 * Funciona em um terminal interativo que suporte modo de entrada direta.
 *
 * @param {string} mensagem - Mensagem exibida antes da digitação.
 * @returns {Promise<string>} Senha digitada.
 */
function perguntarSenha(mensagem) {
  return new Promise((resolve, reject) => {
    // Evita continuar se o terminal não suportar entrada oculta.
    if (!stdin.isTTY || typeof stdin.setRawMode !== 'function') {
      reject(
        new Error(
          'Entrada oculta indisponível. Execute pelo Git Bash interativo.',
        ),
      );
      return;
    }

    stdout.write(mensagem);

    let senha = '';
    let finalizado = false;

    // Ativa a leitura caractere a caractere para não exibir a senha.
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');

    // Restaura o terminal e remove o listener ao finalizar a leitura.
    function restaurarTerminal() {
      if (finalizado) return;

      finalizado = true;
      stdin.removeListener('data', aoDigitar);
      stdin.setRawMode(false);
      stdout.write('\n');
    }

    // Trata os caracteres digitados sem mostrá-los na tela.
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

      // Backspace ou Delete remove o último caractere.
      if (caractere === '\u0008' || caractere === '\u007f') {
        senha = senha.slice(0, -1);
        return;
      }

      // Ignora caracteres de controle que não fazem parte da senha.
      if (caractere >= ' ') {
        senha += caractere;
      }
    }

    stdin.on('data', aoDigitar);
  });
}

/**
 * Executa o cadastro inicial de um administrador da plataforma.
 *
 * Este administrador é global e não pertence a uma empresa específica.
 * Por isso, o cadastro utiliza AdministradorPlataforma, sem empresaId
 * e sem o enum PerfilAcesso utilizado pelos usuários das empresas.
 */
async function main() {
  console.log('\n=== Cadastro do administrador da plataforma ===\n');

  // Solicita os dados de identificação do administrador global.
  const nome = await perguntar('Nome do administrador: ');

  const email = (await perguntar('E-mail do administrador: '))
    .trim()
    .toLowerCase();

  // Valida os campos antes de consultar ou alterar o banco.
  const emailValido = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

  if (!nome || !emailValido) {
    throw new Error('Informe um nome e um e-mail válidos.');
  }

  // Verifica se o e-mail já está cadastrado na plataforma.
  const existente = await prisma.administradorPlataforma.findUnique({
    where: { email },
    select: { id: true },
  });

  if (existente) {
    throw new Error('Já existe um administrador com esse e-mail.');
  }

  // Solicita uma senha forte e a respectiva confirmação.
  const senha = await perguntarSenha(
    'Digite a senha (mínimo 12 caracteres): ',
  );

  if (senha.length < 12) {
    throw new Error('A senha precisa ter pelo menos 12 caracteres.');
  }

  const confirmacao = await perguntarSenha('Confirme a senha: ');

  if (senha !== confirmacao) {
    throw new Error('As senhas não coincidem.');
  }

  // Gera um hash Argon2 para armazenar no banco.
  // A senha original nunca é gravada na tabela nem exibida no terminal.
  const hashSenha = await argon2.hash(senha);

  // Cria o administrador global como ativo.
  // O select limita o retorno aos campos que podem ser exibidos.
  const administrador = await prisma.administradorPlataforma.create({
    data: {
      nome,
      email,
      hashSenha,
      ativo: true,
    },
    select: {
      id: true,
      nome: true,
      email: true,
      ativo: true,
      criadoEm: true,
    },
  });

  // Apresenta somente informações públicas do cadastro realizado.
  console.log('\nAdministrador da plataforma criado com sucesso!');
  console.table(administrador);
}

// Executa o processo e informa falhas sem expor a senha.
main()
  .catch((erro) => {
    console.error(
      '\nNão foi possível criar o administrador:',
      erro instanceof Error ? erro.message : 'Erro inesperado.',
    );

    process.exitCode = 1;
  })
  .finally(async () => {
    // Encerra a conexão com o banco mesmo quando ocorre uma falha.
    await prisma.$disconnect();
  });
