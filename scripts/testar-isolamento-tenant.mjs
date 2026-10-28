
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

const terminal = createInterface({ input: stdin, output: stdout });

// API local do Gestão Comercial.
const URL_LOGIN = 'http://localhost:5433/auth/login';
const URL_EMPRESAS = 'http://localhost:5433/empresas';

// Empresa de teste já cadastrada.
const EMPRESA_ID = 'c806010b-76da-4290-9758-2c8be739b7b6';

/**
 * Solicita a senha sem exibir os caracteres digitados.
 */
async function perguntarSenha() {
  if (!stdin.isTTY || typeof stdin.setRawMode !== 'function') {
    throw new Error('Execute o script em um terminal interativo do Git Bash.');
  }

  stdout.write('Senha do administrador da empresa: ');
  let senha = '';

  return new Promise((resolve, reject) => {
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');

    function restaurarTerminal() {
      stdin.removeListener('data', aoDigitar);
      stdin.setRawMode(false);
      stdout.write('\n');
    }

    function aoDigitar(caractere) {
      if (caractere === '\u0003') {
        restaurarTerminal();
        reject(new Error('Teste cancelado.'));
        return;
      }

      if (caractere === '\r' || caractere === '\n') {
        restaurarTerminal();
        resolve(senha);
        return;
      }

      if (caractere === '\u0008' || caractere === '\u007f') {
        senha = senha.slice(0, -1);
        return;
      }

      if (caractere >= ' ') {
        senha += caractere;
      }
    }

    stdin.on('data', aoDigitar);
  });
}

/**
 * Executa uma requisição HTTP e interpreta a resposta JSON.
 */
async function requisitar(urlDestino, metodo, corpo, token) {
  const http = await import('node:http');
  const url = new URL(urlDestino);
  const dados = corpo ? JSON.stringify(corpo) : '';

  return new Promise((resolve, reject) => {
    const requisicao = http.request(url, {
      method: metodo,
      headers: {
        ...(dados ? { 'Content-Type': 'application/json' } : {}),
        ...(dados
          ? { 'Content-Length': Buffer.byteLength(dados) }
          : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    }, (resposta) => {
      let texto = '';

      resposta.setEncoding('utf8');
      resposta.on('data', (parte) => {
        texto += parte;
      });

      resposta.on('end', () => {
        let resultado = null;

        try {
          resultado = texto ? JSON.parse(texto) : null;
        } catch {
          // Não precisamos exibir o corpo bruto da resposta.
        }

        resolve({
          status: resposta.statusCode,
          resultado,
        });
      });
    });

    requisicao.on('error', reject);

    if (dados) {
      requisicao.write(dados);
    }

    requisicao.end();
  });
}

/**
 * Faz login com uma conta comum de uma empresa cliente
 * e testa se o token dela é recusado pela rota da plataforma.
 */
async function main() {
  console.log('\n=== Teste de isolamento entre empresa e plataforma ===\n');

  const email = (
    await terminal.question('E-mail do administrador da empresa: ')
  ).trim().toLowerCase();

  const senha = await perguntarSenha();

  // A autenticação de empresa exige empresaId, e-mail e senha.
  const login = await requisitar(URL_LOGIN, 'POST', {
    empresaId: EMPRESA_ID,
    email,
    senha,
  });

  console.log('\nStatus HTTP do login da empresa:', login.status);

  if (login.status !== 200 || !login.resultado?.accessToken) {
    console.log('Não foi possível autenticar o administrador da empresa.');
    console.log(
      'Mensagem:',
      login.resultado?.message ?? 'Sem detalhes.',
    );
    return;
  }

  console.log('Login da empresa realizado com sucesso.');
  console.log('Token recebido: sim (conteúdo ocultado).');

  // Usa o token da empresa na rota exclusiva da plataforma.
  const acesso = await requisitar(
    URL_EMPRESAS,
    'GET',
    null,
    login.resultado.accessToken,
  );

  console.log('\n=== Resultado do teste de autorização ===');
  console.log('Status HTTP de GET /empresas:', acesso.status);

  if (acesso.status === 403) {
    console.log(
      'SUCESSO: o token da empresa foi recusado pela rota da plataforma.',
    );
  } else if (acesso.status === 200) {
    console.log(
      'ATENÇÃO: a rota aceitou o token da empresa. Precisamos investigar.',
    );
  } else if (acesso.status === 401) {
    console.log(
      'A API recusou o token, mas precisamos investigar se foi por autenticação ou autorização.',
    );
  } else {
    console.log(
      'Resultado inesperado. Precisamos analisar a proteção da rota.',
    );
  }
}

main()
  .catch((erro) => {
    console.error('\nErro durante o teste:', erro.message);
  })
  .finally(() => {
    terminal.close();
  });
