
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

// Cria uma interface para solicitar informações no terminal.
const terminal = createInterface({
  input: stdin,
  output: stdout,
});

// Endereços locais da API.
const URL_LOGIN = 'http://localhost:5433/admin-plataforma/login';
const URL_EMPRESAS = 'http://localhost:5433/empresas';

/**
 * Solicita uma senha sem mostrar os caracteres digitados.
 *
 * A entrada oculta funciona em terminais interativos do Git Bash.
 * A senha não é exibida nem gravada em arquivos pelo script.
 */
async function perguntarSenha(mensagem) {
  if (!stdin.isTTY || typeof stdin.setRawMode !== 'function') {
    throw new Error(
      'Entrada oculta indisponível. Execute pelo Git Bash interativo.',
    );
  }

  stdout.write(mensagem);

  let senha = '';

  return new Promise((resolve, reject) => {
    // Ativa a leitura caractere a caractere, sem exibir a senha.
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
        reject(new Error('Teste cancelado pelo usuário.'));
        return;
      }

      // Enter finaliza a digitação da senha.
      if (caractere === '\r' || caractere === '\n') {
        restaurarTerminal();
        resolve(senha);
        return;
      }

      // Backspace remove o último caractere digitado.
      if (caractere === '\u0008' || caractere === '\u007f') {
        senha = senha.slice(0, -1);
        return;
      }

      // Armazena os caracteres imprimíveis sem exibi-los.
      if (caractere >= ' ') {
        senha += caractere;
      }
    }

    stdin.on('data', aoDigitar);
  });
}

/**
 * Envia uma requisição HTTP e reúne a resposta.
 *
 * Retorna o código HTTP e o corpo recebido.
 * Não imprime credenciais nem tokens.
 */
async function realizarRequisicao(urlDestino, opcoes, corpo = '') {
  const http = await import('node:http');
  const url = new URL(urlDestino);

  return new Promise((resolve, reject) => {
    const requisicao = http.request(
      url,
      {
        ...opcoes,
        headers: {
          ...opcoes.headers,
          ...(corpo
            ? { 'Content-Length': Buffer.byteLength(corpo) }
            : {}),
        },
      },
      (resposta) => {
        let dados = '';

        // Reúne os trechos recebidos da API.
        resposta.setEncoding('utf8');
        resposta.on('data', (trecho) => {
          dados += trecho;
        });

        resposta.on('end', () => {
          let resultado = null;

          // Tenta interpretar o corpo como JSON.
          try {
            resultado = dados ? JSON.parse(dados) : null;
          } catch {
            resultado = null;
          }

          resolve({
            status: resposta.statusCode,
            resultado,
          });
        });
      },
    );

    // Trata falhas de conexão com a API.
    requisicao.on('error', reject);

    // Envia o corpo quando houver e encerra a requisição.
    if (corpo) {
      requisicao.write(corpo);
    }

    requisicao.end();
  });
}

/**
 * Realiza o login do administrador da plataforma.
 */
async function realizarLogin(email, senha) {
  // Envia as credenciais no corpo JSON de uma requisição POST.
  return realizarRequisicao(
    URL_LOGIN,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
    },
    JSON.stringify({ email, senha }),
  );
}

/**
 * Testa a rota de empresas utilizando o token recebido no login.
 *
 * O token é enviado somente no cabeçalho Authorization.
 * Seu conteúdo nunca é exibido no terminal.
 */
async function testarAcessoEmpresas(accessToken) {
  return realizarRequisicao(URL_EMPRESAS, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
}

/**
 * Executa o login e, caso seja bem-sucedido, testa a autorização.
 */
async function main() {
  console.log(
    '\n=== Teste de login do administrador da plataforma ===\n',
  );

  // Solicita o e-mail e normaliza espaços e letras maiúsculas.
  const email = (
    await terminal.question('E-mail do administrador: ')
  )
    .trim()
    .toLowerCase();

  // Solicita a senha sem exibi-la.
  const senha = await perguntarSenha('Senha do administrador: ');

  // Realiza o login na API.
  const resposta = await realizarLogin(email, senha);

  console.log(`\nStatus HTTP do login: ${resposta.status}`);

  // Confirma que a autenticação foi bem-sucedida e que existe um token.
  if (
    resposta.status === 200 &&
    resposta.resultado &&
    typeof resposta.resultado.accessToken === 'string'
  ) {
    // Não imprime o accessToken, pois ele é uma credencial.
    console.log('Login realizado com sucesso!');
    console.log('Token recebido: sim (conteúdo ocultado).');
    console.log('Tipo de token:', resposta.resultado.tokenType);
    console.log('Validade em segundos:', resposta.resultado.expiresIn);
    console.log('Administrador:', resposta.resultado.administrador);

    // Testa se o token autoriza o acesso à rota administrativa.
    console.log('\n=== Teste de autorização da plataforma ===');

    const respostaEmpresas = await testarAcessoEmpresas(
      resposta.resultado.accessToken,
    );

    console.log(
      'Status HTTP da rota GET /empresas:',
      respostaEmpresas.status,
    );

    // Interpreta o resultado sem exibir dados desnecessários.
    if (respostaEmpresas.status === 200) {
      console.log(
        'SUCESSO: o token foi aceito pela rota de empresas.',
      );
    } else if (respostaEmpresas.status === 401) {
      console.log(
        'FALHA: a API não aceitou o token de acesso.',
      );
    } else if (respostaEmpresas.status === 403) {
      console.log(
        'FALHA: o token não possui autorização para essa rota.',
      );
    } else {
      console.log(
        'Resultado inesperado. Precisamos investigar a resposta da API.',
      );
    }
  } else {
    // Não imprime a resposta completa nem dados desnecessários.
    console.log(
      'Login não realizado. Verifique as credenciais e a API.',
    );

    console.log(
      'Mensagem:',
      resposta.resultado?.message ?? 'Sem detalhes.',
    );
  }
}

// Executa o teste e garante o encerramento da interface do terminal.
main()
  .catch((erro) => {
    console.error('\nErro durante o teste:', erro.message);
  })
  .finally(() => {
    terminal.close();
  });
