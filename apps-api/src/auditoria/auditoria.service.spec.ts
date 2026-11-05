
// Exceção utilizada para verificar se o serviço rejeita entradas inválidas.
import { BadRequestException } from '@nestjs/common';

// Enums gerados pelo Prisma para representar os tipos de ator
// e os resultados possíveis de um evento de auditoria.
import {
  ResultadoAuditoria,
  TipoAtorAuditoria,
} from '@prisma/client';

// Ferramentas do Vitest para organizar testes, executar verificações,
// preparar o ambiente antes de cada teste e criar funções simuladas.
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Serviço do Prisma utilizado pelo AuditoriaService.
// Nos testes, ele será substituído por uma implementação simulada.
import { PrismaService } from '../prisma/prisma.service.js';

// Serviço que estamos testando: responsável por registrar
// e sanitizar os eventos de auditoria.
import { AuditoriaService } from './auditoria.service.js';

// Agrupa todos os testes relacionados ao serviço central de auditoria.
describe('AuditoriaService', () => {
  // Instância do serviço que será criada antes de cada teste.
  let service: AuditoriaService;

  /**
   * Simula o PrismaService real.
   *
   * eventoAuditoria.create representa a gravação de um evento.
   * empresa.findFirst verifica a existência e a situação da empresa.
   * usuario.findFirst verifica a identidade e o vínculo empresarial.
   * administradorPlataforma.findFirst verifica o administrador da plataforma.
   *
   * Nenhum desses testes precisa acessar o banco de dados real.
   */
  const prisma = {
    eventoAuditoria: {
      create: vi.fn(),
    },
    empresa: {
      findFirst: vi.fn(),
    },
    usuario: {
      findFirst: vi.fn(),
    },
    administradorPlataforma: {
      findFirst: vi.fn(),
    },
  };

  /**
   * Simula um cliente transacional do Prisma.
   *
   * Além da gravação do evento, disponibiliza as consultas necessárias
   * para validar a identidade do ator dentro da mesma transação.
   *
   * Isso permite verificar se a validação e a gravação utilizam
   * o mesmo cliente transacional.
   */
  const transacao = {
    eventoAuditoria: {
      create: vi.fn(),
    },
    empresa: {
      findFirst: vi.fn(),
    },
    usuario: {
      findFirst: vi.fn(),
    },
    administradorPlataforma: {
      findFirst: vi.fn(),
    },
  };

  // UUIDs fictícios utilizados nos testes que exigem uma empresa
  // e um usuário identificados por UUID válido.
  const empresaId = '11111111-1111-4111-8111-111111111111';
  const atorId = '22222222-2222-4222-8222-222222222222';

  /**
   * Executado antes de cada teste.
   *
   * Limpa o histórico das funções simuladas, configura os resultados
   * esperados das consultas e gravações e cria uma nova instância do serviço.
   */
  beforeEach(() => {
    // Evita que chamadas e resultados de um teste interfiram em outro.
    vi.resetAllMocks();

    // Simula uma gravação bem-sucedida pelo Prisma principal.
    prisma.eventoAuditoria.create.mockResolvedValue({
      id: 'evento-1',
    });

    // Simula uma gravação bem-sucedida dentro de uma transação.
    transacao.eventoAuditoria.create.mockResolvedValue({
      id: 'evento-transacional-1',
    });

    /**
     * CONFIGURAÇÃO PADRÃO DAS IDENTIDADES
     *
     * Nos cenários válidos, os registros consultados existem e estão ativos.
     *
     * Os testes que precisam simular registros inexistentes ou inativos
     * sobrescrevem esses resultados individualmente.
     */
    prisma.empresa.findFirst.mockResolvedValue({
      id: empresaId,
    });

    prisma.usuario.findFirst.mockResolvedValue({
      id: atorId,
    });

    prisma.administradorPlataforma.findFirst.mockResolvedValue({
      id: atorId,
    });

    // Configura também as consultas do cliente transacional.
    transacao.empresa.findFirst.mockResolvedValue({
      id: empresaId,
    });

    transacao.usuario.findFirst.mockResolvedValue({
      id: atorId,
    });

    transacao.administradorPlataforma.findFirst.mockResolvedValue({
      id: atorId,
    });

    // Cria o serviço utilizando o Prisma simulado.
    // A conversão de tipo permite fornecer somente a parte do Prisma
    // necessária para os testes, sem instanciar o banco real.
    service = new AuditoriaService(
      prisma as unknown as PrismaService,
    );
  });

  /**
   * Verifica o fluxo básico de registro de um evento.
   *
   * Confirma que os dados recebidos são encaminhados corretamente
   * para a operação de criação do registro de auditoria.
   *
   * Também verifica se a empresa e o usuário são consultados
   * antes da gravação.
   */
  it('deve registrar um evento de auditoria', async () => {
    // Executa o registro e verifica o retorno da operação simulada.
    await expect(
      service.registrar({
        empresaId,
        atorId,
        tipoAtor: TipoAtorAuditoria.USUARIO_EMPRESA,
        modulo: 'PRODUTOS',
        acao: 'CRIAR',
        entidade: 'Produto',
        entidadeId: 'produto-1',
        resultado: ResultadoAuditoria.SUCESSO,
      }),
    ).resolves.toEqual({
      id: 'evento-1',
    });

    // Confirma que a empresa foi consultada e está ativa.
    expect(prisma.empresa.findFirst).toHaveBeenCalledWith({
      where: {
        id: empresaId,
        ativo: true,
      },
      select: {
        id: true,
      },
    });

    // Confirma que o usuário pertence à empresa informada e está ativo.
    expect(prisma.usuario.findFirst).toHaveBeenCalledWith({
      where: {
        id: atorId,
        empresaId,
        ativo: true,
      },
      select: {
        id: true,
      },
    });

    // Confirma que o Prisma recebeu os dados esperados.
    // objectContaining permite verificar os campos importantes
    // sem exigir que o objeto contenha exclusivamente essas propriedades.
    expect(prisma.eventoAuditoria.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        empresaId,
        atorId,
        tipoAtor: TipoAtorAuditoria.USUARIO_EMPRESA,
        modulo: 'PRODUTOS',
        acao: 'CRIAR',
        entidade: 'Produto',
        entidadeId: 'produto-1',
        resultado: ResultadoAuditoria.SUCESSO,
      }),
    });
  });

  /**
   * Verifica o registro de eventos administrativos da plataforma.
   *
   * Administradores da plataforma não precisam estar vinculados
   * a uma empresa específica. Por isso, empresaId deve ser omitido.
   *
   * A identidade do administrador precisa ser consultada e validada.
   */
  it('deve registrar eventos sem empresa para administradores da plataforma', async () => {
    await service.registrar({
      atorId,
      tipoAtor: TipoAtorAuditoria.ADMIN_PLATAFORMA,
      modulo: 'ADMIN_PLATAFORMA',
      acao: 'LOGIN',
      resultado: ResultadoAuditoria.SUCESSO,
    });

    // Recupera os argumentos utilizados na primeira chamada ao Prisma.
    const chamada = prisma.eventoAuditoria.create.mock.calls[0][0];

    // Confirma que empresaId não foi enviado ao banco.
    expect(chamada.data).not.toHaveProperty('empresaId');

    // Confirma que o evento foi identificado como ação de administrador
    // da plataforma, e não como ação de um usuário empresarial.
    expect(chamada.data.tipoAtor).toBe(
      TipoAtorAuditoria.ADMIN_PLATAFORMA,
    );

    // Confirma que a identidade do administrador foi validada.
    expect(
      prisma.administradorPlataforma.findFirst,
    ).toHaveBeenCalledWith({
      where: {
        id: atorId,
        ativo: true,
      },
      select: {
        id: true,
      },
    });
  });

  /**
   * Verifica a normalização dos campos textuais obrigatórios.
   *
   * Espaços antes e depois do nome do módulo e da ação devem ser
   * removidos antes de os dados serem persistidos.
   */
  it('deve remover espaços externos dos campos textuais', async () => {
    await service.registrar({
      tipoAtor: TipoAtorAuditoria.SISTEMA,
      modulo: '  VENDAS  ',
      acao: '  CRIAR  ',
      resultado: ResultadoAuditoria.SUCESSO,
    });

    // Confirma que os textos foram armazenados sem espaços externos.
    expect(prisma.eventoAuditoria.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        modulo: 'VENDAS',
        acao: 'CRIAR',
      }),
    });

    // O ator SISTEMA não deve provocar consultas de identidade.
    expect(prisma.empresa.findFirst).not.toHaveBeenCalled();
    expect(prisma.usuario.findFirst).not.toHaveBeenCalled();
    expect(
      prisma.administradorPlataforma.findFirst,
    ).not.toHaveBeenCalled();
  });

  /**
   * Verifica se identificadores de empresa inválidos são rejeitados.
   *
   * O serviço não deve permitir que valores que não correspondam
   * ao formato UUID sejam utilizados como identificadores.
   */
  it('deve rejeitar identificador de empresa inválido', async () => {
    await expect(
      service.registrar({
        empresaId: 'empresa-invalida',
        tipoAtor: TipoAtorAuditoria.USUARIO_EMPRESA,
        modulo: 'PRODUTOS',
        acao: 'CRIAR',
        resultado: ResultadoAuditoria.SUCESSO,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    // A validação deve acontecer antes de qualquer consulta ou gravação.
    expect(prisma.empresa.findFirst).not.toHaveBeenCalled();
    expect(prisma.usuario.findFirst).not.toHaveBeenCalled();
    expect(prisma.eventoAuditoria.create).not.toHaveBeenCalled();
  });

  /**
   * Verifica se o serviço rejeita campos obrigatórios vazios.
   *
   * Uma sequência contendo somente espaços não deve ser considerada
   * um nome de módulo válido.
   */
  it('deve rejeitar módulo vazio', async () => {
    await expect(
      service.registrar({
        tipoAtor: TipoAtorAuditoria.SISTEMA,
        modulo: '   ',
        acao: 'CRIAR',
        resultado: ResultadoAuditoria.SUCESSO,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    // Nenhum evento deve ser gravado quando a validação falhar.
    expect(prisma.eventoAuditoria.create).not.toHaveBeenCalled();
  });

  /**
   * Verifica os limites máximos dos campos textuais.
   *
   * O módulo aceita até 80 caracteres. Valores acima desse limite
   * devem gerar uma exceção de validação.
   */
  it('deve rejeitar textos acima do limite permitido', async () => {
    await expect(
      service.registrar({
        tipoAtor: TipoAtorAuditoria.SISTEMA,
        modulo: 'A'.repeat(81),
        acao: 'CRIAR',
        resultado: ResultadoAuditoria.SUCESSO,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    // Confirma que um dado inválido não chegou à camada de persistência.
    expect(prisma.eventoAuditoria.create).not.toHaveBeenCalled();
  });

  /**
   * Verifica a proteção de informações sensíveis nos metadados.
   *
   * Senhas, tokens e segredos não podem ser armazenados em texto puro,
   * inclusive quando aparecem dentro de objetos aninhados.
   */
  it('deve ocultar campos sensíveis dos metadados', async () => {
    await service.registrar({
      tipoAtor: TipoAtorAuditoria.SISTEMA,
      modulo: 'AUTH',
      acao: 'LOGIN',
      resultado: ResultadoAuditoria.SUCESSO,
      metadados: {
        origem: 'formulario',
        password: 'senha-secreta',
        accessToken: 'token-secreto',
        usuario: {
          nome: 'Usuário de teste',
          segredo: 'valor-secreto',
        },
      },
    });

    const chamada = prisma.eventoAuditoria.create.mock.calls[0][0];

    // Os campos comuns devem ser preservados.
    // Os campos identificados como sensíveis devem receber [REDACTED].
    expect(chamada.data.metadados).toEqual({
      origem: 'formulario',
      password: '[REDACTED]',
      accessToken: '[REDACTED]',
      usuario: {
        nome: 'Usuário de teste',
        segredo: '[REDACTED]',
      },
    });
  });

  /**
   * Verifica se o serviço respeita o cliente transacional recebido.
   *
   * Esse comportamento permite registrar uma operação comercial
   * e seu evento de auditoria dentro da mesma transação do Prisma.
   *
   * A validação da identidade também precisa utilizar essa transação.
   */
  it('deve registrar dentro do cliente transacional fornecido', async () => {
    await service.registrar(
      {
        empresaId,
        atorId,
        tipoAtor: TipoAtorAuditoria.USUARIO_EMPRESA,
        modulo: 'VENDAS',
        acao: 'CRIAR',
        resultado: ResultadoAuditoria.SUCESSO,
      },
      // Simula o cliente transacional que seria fornecido pelo Prisma.
      transacao as never,
    );

    // A empresa e o usuário devem ser validados dentro da transação.
    expect(transacao.empresa.findFirst).toHaveBeenCalledWith({
      where: {
        id: empresaId,
        ativo: true,
      },
      select: {
        id: true,
      },
    });

    expect(transacao.usuario.findFirst).toHaveBeenCalledWith({
      where: {
        id: atorId,
        empresaId,
        ativo: true,
      },
      select: {
        id: true,
      },
    });

    // A gravação deve utilizar o cliente transacional recebido.
    expect(transacao.eventoAuditoria.create).toHaveBeenCalledOnce();

    // O cliente principal não deve ser utilizado nesse cenário.
    expect(prisma.empresa.findFirst).not.toHaveBeenCalled();
    expect(prisma.usuario.findFirst).not.toHaveBeenCalled();
    expect(prisma.eventoAuditoria.create).not.toHaveBeenCalled();
  });

  /**
   * Verifica o armazenamento dos estados anterior e posterior
   * de uma operação de alteração.
   *
   * Esses dados permitem identificar o que foi modificado em uma ação,
   * preservando a proteção contra credenciais nos dois estados.
   */
  it('deve registrar dados anteriores e posteriores sanitizados', async () => {
    await service.registrar({
      tipoAtor: TipoAtorAuditoria.SISTEMA,
      modulo: 'PRODUTOS',
      acao: 'ATUALIZAR',
      resultado: ResultadoAuditoria.SUCESSO,
      dadosAnteriores: {
        nome: 'Produto antigo',
        password: 'nao-gravar',
      },
      dadosPosteriores: {
        nome: 'Produto atualizado',
        preco: 29.9,
      },
    });

    const chamada = prisma.eventoAuditoria.create.mock.calls[0][0];

    // Confirma que o estado anterior foi preservado,
    // mas a senha foi substituída pelo marcador de proteção.
    expect(chamada.data.dadosAnteriores).toEqual({
      nome: 'Produto antigo',
      password: '[REDACTED]',
    });

    // Confirma que os dados posteriores foram registrados corretamente.
    expect(chamada.data.dadosPosteriores).toEqual({
      nome: 'Produto atualizado',
      preco: 29.9,
    });
  });

  /**
   * Verifica a identificação de referências circulares.
   *
   * Uma referência circular ocorre quando um objeto aponta para si mesmo,
   * direta ou indiretamente. Essa estrutura não pode ser serializada
   * normalmente em JSON e precisa ser substituída por um marcador.
   */
  it('deve identificar referências circulares sem interromper o registro', async () => {
    const dados: Record<string, unknown> = {
      nome: 'Produto de teste',
    };

    // Cria uma referência do próprio objeto para ele mesmo.
    dados.referencia = dados;

    await service.registrar({
      tipoAtor: TipoAtorAuditoria.SISTEMA,
      modulo: 'PRODUTOS',
      acao: 'ATUALIZAR',
      resultado: ResultadoAuditoria.SUCESSO,
      metadados: dados,
    });

    const chamada = prisma.eventoAuditoria.create.mock.calls[0][0];

    // O objeto deve ser registrado sem recursão infinita.
    expect(chamada.data.metadados).toEqual({
      nome: 'Produto de teste',
      referencia: '[REFERENCIA_CIRCULAR]',
    });
  });

  /**
   * Verifica a diferença entre referências circulares e objetos
   * compartilhados.
   *
   * Um mesmo objeto pode ser utilizado em duas propriedades diferentes
   * sem que isso represente uma referência circular.
   */
  it('não deve classificar objetos compartilhados como referências circulares', async () => {
    const compartilhado = {
      nome: 'Objeto compartilhado',
      password: 'senha-secreta',
    };

    await service.registrar({
      tipoAtor: TipoAtorAuditoria.SISTEMA,
      modulo: 'PRODUTOS',
      acao: 'ATUALIZAR',
      resultado: ResultadoAuditoria.SUCESSO,
      metadados: {
        primeiro: compartilhado,
        segundo: compartilhado,
      },
    });

    const chamada = prisma.eventoAuditoria.create.mock.calls[0][0];

    // As duas propriedades devem preservar o conteúdo do objeto,
    // sem serem classificadas incorretamente como referências circulares.
    // A senha deve continuar protegida nas duas ocorrências.
    expect(chamada.data.metadados).toEqual({
      primeiro: {
        nome: 'Objeto compartilhado',
        password: '[REDACTED]',
      },
      segundo: {
        nome: 'Objeto compartilhado',
        password: '[REDACTED]',
      },
    });
  });

  /**
   * Verifica a sanitização de credenciais em estruturas complexas.
   *
   * A proteção deve funcionar em arrays, objetos aninhados e diferentes
   * níveis de profundidade, sem depender da posição da propriedade.
   */
  it('deve ocultar credenciais dentro de arrays e objetos aninhados', async () => {
    await service.registrar({
      tipoAtor: TipoAtorAuditoria.SISTEMA,
      modulo: 'AUTH',
      acao: 'LOGIN',
      resultado: ResultadoAuditoria.SUCESSO,
      metadados: {
        tentativas: [
          {
            usuario: 'teste',
            refreshToken: 'token-privado',
          },
          {
            authorization: 'Bearer token-privado',
            dados: {
              apiKey: 'chave-privada',
            },
          },
        ],
      },
    });

    const chamada = prisma.eventoAuditoria.create.mock.calls[0][0];

    // Confirma que todos os campos sensíveis foram substituídos,
    // inclusive aqueles que estão dentro de objetos de um array.
    expect(chamada.data.metadados).toEqual({
      tentativas: [
        {
          usuario: 'teste',
          refreshToken: '[REDACTED]',
        },
        {
          authorization: '[REDACTED]',
          dados: {
            apiKey: '[REDACTED]',
          },
        },
      ],
    });
  });

  /**
   * Verifica se a sanitização evita executar getters.
   *
   * Getters podem executar código quando uma propriedade é acessada.
   * O serviço deve inspecionar descritores de propriedades sem executar
   * esse código durante a preparação dos dados de auditoria.
   */
  it('não deve executar getters durante a sanitização', async () => {
    let getterExecutado = false;

    const dados = {
      nome: 'Produto de teste',
    };

    // Define uma propriedade cujo valor somente seria obtido
    // pela execução de uma função getter.
    Object.defineProperty(dados, 'informacaoPrivada', {
      enumerable: true,
      get() {
        getterExecutado = true;
        return 'valor que não deve ser acessado';
      },
    });

    await service.registrar({
      tipoAtor: TipoAtorAuditoria.SISTEMA,
      modulo: 'PRODUTOS',
      acao: 'ATUALIZAR',
      resultado: ResultadoAuditoria.SUCESSO,
      metadados: dados,
    });

    const chamada = prisma.eventoAuditoria.create.mock.calls[0][0];

    // Confirma que o getter não foi executado.
    expect(getterExecutado).toBe(false);

    // A propriedade deve aparecer somente como um marcador,
    // sem que seu conteúdo interno seja acessado.
    expect(chamada.data.metadados).toEqual({
      nome: 'Produto de teste',
      informacaoPrivada: '[PROPRIEDADE_ACESSORA_IGNORADA]',
    });
  });

  /**
   * Verifica o limite máximo de profundidade da sanitização.
   *
   * Estruturas excessivamente profundas podem aumentar o custo
   * de processamento e causar problemas de recursão.
   * O conteúdo além do limite deve ser substituído por um marcador.
   */
  it('deve respeitar o limite de profundidade dos objetos', async () => {
    const dados = {
      nivel1: {
        nivel2: {
          nivel3: {
            nivel4: {
              nivel5: {
                nivel6: {
                  valor: 'conteudo profundo',
                },
              },
            },
          },
        },
      },
    };

    await service.registrar({
      tipoAtor: TipoAtorAuditoria.SISTEMA,
      modulo: 'PRODUTOS',
      acao: 'ATUALIZAR',
      resultado: ResultadoAuditoria.SUCESSO,
      metadados: dados,
    });

    const chamada = prisma.eventoAuditoria.create.mock.calls[0][0];

    // Confirma que a estrutura foi interrompida no nível configurado.
    expect(
      chamada.data.metadados.nivel1.nivel2.nivel3.nivel4.nivel5,
    ).toEqual({
      nivel6: '[LIMITE_DE_PROFUNDIDADE]',
    });
  });

  /**
   * Verifica o limite máximo de propriedades por objeto.
   *
   * O serviço deve limitar a quantidade de propriedades processadas
   * para evitar que objetos muito grandes consumam recursos excessivos.
   */
  it('deve limitar a quantidade de propriedades registradas', async () => {
    // Cria um objeto com 120 propriedades para ultrapassar o limite.
    const dados: Record<string, string> = {};

    for (let i = 0; i < 120; i++) {
      dados[`campo${i}`] = `valor${i}`;
    }

    await service.registrar({
      tipoAtor: TipoAtorAuditoria.SISTEMA,
      modulo: 'PRODUTOS',
      acao: 'ATUALIZAR',
      resultado: ResultadoAuditoria.SUCESSO,
      metadados: dados,
    });

    const chamada = prisma.eventoAuditoria.create.mock.calls[0][0];
    const metadados = chamada.data.metadados;

    // Somente as primeiras 100 propriedades devem ser registradas.
    expect(Object.keys(metadados)).toHaveLength(100);

    // Confirma que o início e o final do intervalo permitido foram mantidos.
    expect(metadados).toHaveProperty('campo0', 'valor0');
    expect(metadados).toHaveProperty('campo99', 'valor99');

    // Confirma que a propriedade seguinte ao limite foi descartada.
    expect(metadados).not.toHaveProperty('campo100');
  });

  /**
   * Verifica se a validação do UUID considera a string inteira.
   *
   * Um UUID válido seguido de caracteres adicionais não pode ser aceito
   * como identificador válido.
   */
  it('deve rejeitar UUID válido seguido de caracteres adicionais', async () => {
    await expect(
      service.registrar({
        empresaId: `${empresaId}-extra`,
        tipoAtor: TipoAtorAuditoria.USUARIO_EMPRESA,
        modulo: 'PRODUTOS',
        acao: 'CRIAR',
        resultado: ResultadoAuditoria.SUCESSO,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    // A gravação e as consultas não devem acontecer quando o UUID for inválido.
    expect(prisma.empresa.findFirst).not.toHaveBeenCalled();
    expect(prisma.usuario.findFirst).not.toHaveBeenCalled();
    expect(prisma.eventoAuditoria.create).not.toHaveBeenCalled();
  });

  /**
   * Verifica a identificação de diferentes convenções de nomes
   * utilizadas para representar credenciais.
   *
   * A sanitização deve reconhecer variações com letras maiúsculas,
   * minúsculas, sublinhados e hífens.
   */
  it('deve ocultar variações de nomes de propriedades sensíveis', async () => {
    await service.registrar({
      tipoAtor: TipoAtorAuditoria.SISTEMA,
      modulo: 'AUTH',
      acao: 'LOGIN',
      resultado: ResultadoAuditoria.SUCESSO,
      metadados: {
        clientSecret: 'segredo',
        session_token: 'token',
        'api-key': 'chave',
        privateKey: 'chave privada',
        refreshToken: 'token de renovação',
      },
    });

    const chamada = prisma.eventoAuditoria.create.mock.calls[0][0];

    // Confirma que todas as variações foram reconhecidas e protegidas.
    expect(chamada.data.metadados).toEqual({
      clientSecret: '[REDACTED]',
      session_token: '[REDACTED]',
      'api-key': '[REDACTED]',
      privateKey: '[REDACTED]',
      refreshToken: '[REDACTED]',
    });
  });

  /**
   * Verifica que propriedades personalizadas de arrays não sejam
   * persistidas como se fossem itens comuns.
   *
   * Arrays podem receber propriedades adicionais em JavaScript.
   * O serviço deve registrar somente os elementos do array.
   */
  it('não deve persistir propriedades personalizadas de arrays', async () => {
    const dados: unknown[] = ['produto A', 'produto B'];

    // Adiciona uma propriedade extra que não representa um índice do array.
    Object.defineProperty(dados, 'password', {
      enumerable: true,
      value: 'senha-privada',
    });

    await service.registrar({
      tipoAtor: TipoAtorAuditoria.SISTEMA,
      modulo: 'PRODUTOS',
      acao: 'ATUALIZAR',
      resultado: ResultadoAuditoria.SUCESSO,
      metadados: {
        produtos: dados,
      },
    });

    const chamada = prisma.eventoAuditoria.create.mock.calls[0][0];

    // Confirma que somente os itens originais foram registrados.
    expect(chamada.data.metadados).toEqual({
      produtos: ['produto A', 'produto B'],
    });
  });

  /**
   * Verifica que getters definidos nos índices de arrays também
   * não sejam executados durante a sanitização.
   *
   * Essa proteção complementa o teste de getters em objetos comuns.
   */
  it('não deve executar getters nos índices de arrays', async () => {
    let getterExecutado = false;
    const dados: unknown[] = [];

    // Cria um índice que utiliza getter em vez de armazenar um valor direto.
    Object.defineProperty(dados, '0', {
      enumerable: true,
      configurable: true,
      get() {
        getterExecutado = true;
        return 'conteúdo privado';
      },
    });

    // Define o comprimento do array para incluir o índice criado.
    dados.length = 1;

    await service.registrar({
      tipoAtor: TipoAtorAuditoria.SISTEMA,
      modulo: 'PRODUTOS',
      acao: 'ATUALIZAR',
      resultado: ResultadoAuditoria.SUCESSO,
      metadados: {
        produtos: dados,
      },
    });

    const chamada = prisma.eventoAuditoria.create.mock.calls[0][0];

    // Confirma que o getter não foi executado.
    expect(getterExecutado).toBe(false);

    // O índice deve ser substituído por um marcador de proteção.
    expect(chamada.data.metadados).toEqual({
      produtos: ['[PROPRIEDADE_ACESSORA_IGNORADA]'],
    });
  });

  /**
   * Verifica o limite global de caracteres da sanitização.
   *
   * O orçamento de caracteres é compartilhado entre dados anteriores,
   * dados posteriores e metadados.
   *
   * Isso evita que cada campo utilize individualmente o limite máximo,
   * ultrapassando o orçamento total previsto para o evento.
   */
  it('deve respeitar o orçamento global de caracteres da sanitização', async () => {
    // Cria um conjunto grande de dados para pressionar o limite global.
    const dados = {
      valores: Array.from(
        { length: 60 },
        (_, indice) => `${indice}-${'A'.repeat(2000)}`,
      ),
    };

    await service.registrar({
      tipoAtor: TipoAtorAuditoria.SISTEMA,
      modulo: 'PRODUTOS',
      acao: 'ATUALIZAR',
      resultado: ResultadoAuditoria.SUCESSO,
      dadosAnteriores: dados,
      dadosPosteriores: dados,
      metadados: dados,
    });

    const chamada = prisma.eventoAuditoria.create.mock.calls[0][0];

    /**
     * Monta somente os campos JSON efetivamente enviados ao banco.
     *
     * Campos omitidos pelo serviço não entram no cálculo.
     * A serialização inclui nomes das propriedades, aspas,
     * vírgulas, delimitadores e conteúdo dos valores.
     */
    const payloadAuditoria = {
      ...(chamada.data.dadosAnteriores !== undefined && {
        dadosAnteriores: chamada.data.dadosAnteriores,
      }),
      ...(chamada.data.dadosPosteriores !== undefined && {
        dadosPosteriores: chamada.data.dadosPosteriores,
      }),
      ...(chamada.data.metadados !== undefined && {
        metadados: chamada.data.metadados,
      }),
    };

    // Calcula o tamanho total da representação JSON do conjunto.
    const totalCaracteres = JSON.stringify(payloadAuditoria).length;

    // Confirma que o orçamento global não foi ultrapassado.
    expect(totalCaracteres).toBeLessThanOrEqual(100_000);
  });

  /**
   * Verifica a proteção de credenciais em campos textuais livres.
   *
   * Além dos objetos JSON, campos como motivo e justificativa
   * também podem receber acidentalmente tokens e senhas.
   */
  it('deve proteger credenciais em campos textuais livres', async () => {
    await service.registrar({
      tipoAtor: TipoAtorAuditoria.SISTEMA,
      modulo: 'AUTH',
      acao: 'FALHA_LOGIN',
      resultado: ResultadoAuditoria.FALHA,
      motivo: 'Falha na autenticação: Bearer abc.def.ghi',
      justificativa: 'Tentativa com password=senha-secreta',
    });

    const chamada = prisma.eventoAuditoria.create.mock.calls[0][0];

    // Confirma que o token Bearer não foi armazenado em texto puro.
    expect(chamada.data.motivo).not.toContain('abc.def.ghi');

    // Confirma que a senha não foi armazenada em texto puro.
    expect(chamada.data.justificativa).not.toContain('senha-secreta');
  });

  /**
   * Verifica a proteção de credenciais quando o conteúdo textual
   * possui uma estrutura semelhante à de um objeto JSON.
   *
   * O objetivo é impedir que uma credencial seja preservada
   * simplesmente porque foi enviada como texto, e não como objeto.
   */
  it('deve proteger credenciais em textos no formato JSON', async () => {
    await service.registrar({
      tipoAtor: TipoAtorAuditoria.SISTEMA,
      modulo: 'AUTH',
      acao: 'FALHA_LOGIN',
      resultado: ResultadoAuditoria.FALHA,
      motivo: '{"password":"senha-secreta"}',
      justificativa: '{"access_token":"token-privado"}',
    });

    const chamada = prisma.eventoAuditoria.create.mock.calls[0][0];

    // Confirma que as credenciais presentes nos textos JSON foram ocultadas.
    expect(chamada.data.motivo).not.toContain('senha-secreta');
    expect(chamada.data.justificativa).not.toContain('token-privado');
  });

  /**
   * Verifica a proteção de credenciais cujos valores possuem espaços.
   *
   * O teste cobre situações em que o valor de uma senha ou credencial
   * não termina imediatamente no primeiro espaço.
   */
  it('deve proteger credenciais com valores contendo espaços', async () => {
    await service.registrar({
      tipoAtor: TipoAtorAuditoria.SISTEMA,
      modulo: 'AUTH',
      acao: 'FALHA_LOGIN',
      resultado: ResultadoAuditoria.FALHA,
      motivo: 'password=senha muito secreta',
      justificativa: 'Authorization: credencial privada',
    });

    const chamada = prisma.eventoAuditoria.create.mock.calls[0][0];

    // Confirma que o valor completo das credenciais não foi preservado.
    expect(chamada.data.motivo).not.toContain('senha muito secreta');
    expect(chamada.data.justificativa).not.toContain('credencial privada');
  });

  /**
   * Verifica se a redação de credenciais respeita os limites
   * máximos dos campos motivo e justificativa.
   *
   * A substituição de uma credencial por um marcador pode aumentar
   * o tamanho do texto. Por isso, é importante validar também
   * o tamanho final depois da sanitização.
   */
  it('deve respeitar o limite de caracteres após sanitizar credenciais', async () => {
    await service.registrar({
      tipoAtor: TipoAtorAuditoria.SISTEMA,
      modulo: 'AUTH',
      acao: 'FALHA_LOGIN',
      resultado: ResultadoAuditoria.FALHA,
      motivo: `${'A'.repeat(480)} password=x`,
      justificativa: `${'B'.repeat(980)} token=x`,
    });

    const chamada = prisma.eventoAuditoria.create.mock.calls[0][0];

    // O campo motivo possui limite de 500 caracteres.
    expect(chamada.data.motivo.length).toBeLessThanOrEqual(500);

    // O campo justificativa possui limite de 1.000 caracteres.
    expect(chamada.data.justificativa.length).toBeLessThanOrEqual(1000);

    // Confirma que os valores originais das credenciais foram removidos.
    expect(chamada.data.motivo).not.toContain('password=x');
    expect(chamada.data.justificativa).not.toContain('token=x');
  });

  // ================================================================
  // TESTES ADICIONAIS — IDENTIDADE E COMPATIBILIDADE DO ATOR
  // ================================================================

  /**
   * USUARIO_EMPRESA exige os dois identificadores:
   * atorId e empresaId.
   *
   * Sem atorId, não é possível identificar o usuário responsável.
   */
  it('deve rejeitar usuário empresarial sem atorId', async () => {
    await expect(
      service.registrar({
        empresaId,
        tipoAtor: TipoAtorAuditoria.USUARIO_EMPRESA,
        modulo: 'PRODUTOS',
        acao: 'CRIAR',
        resultado: ResultadoAuditoria.SUCESSO,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    // A validação deve ocorrer antes de qualquer consulta ou gravação.
    expect(prisma.empresa.findFirst).not.toHaveBeenCalled();
    expect(prisma.usuario.findFirst).not.toHaveBeenCalled();
    expect(prisma.eventoAuditoria.create).not.toHaveBeenCalled();
  });

  /**
   * USUARIO_EMPRESA também exige empresaId.
   *
   * Sem empresaId, não é possível confirmar o vínculo empresarial
   * do usuário que está sendo atribuído ao evento.
   */
  it('deve rejeitar usuário empresarial sem empresaId', async () => {
    await expect(
      service.registrar({
        atorId,
        tipoAtor: TipoAtorAuditoria.USUARIO_EMPRESA,
        modulo: 'PRODUTOS',
        acao: 'CRIAR',
        resultado: ResultadoAuditoria.SUCESSO,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    // Não deve consultar usuários ou empresas sem os dois identificadores.
    expect(prisma.empresa.findFirst).not.toHaveBeenCalled();
    expect(prisma.usuario.findFirst).not.toHaveBeenCalled();
    expect(prisma.eventoAuditoria.create).not.toHaveBeenCalled();
  });

  /**
   * Verifica se uma empresa inexistente ou inativa é rejeitada.
   *
   * O serviço precisa consultar uma empresa ativa antes de validar
   * o usuário empresarial.
   */
  it('deve rejeitar empresa inexistente ou inativa para usuário empresarial', async () => {
    // Simula uma consulta sem empresa ativa correspondente.
    prisma.empresa.findFirst.mockResolvedValueOnce(null);

    await expect(
      service.registrar({
        empresaId,
        atorId,
        tipoAtor: TipoAtorAuditoria.USUARIO_EMPRESA,
        modulo: 'PRODUTOS',
        acao: 'CRIAR',
        resultado: ResultadoAuditoria.SUCESSO,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    // A consulta precisa exigir que a empresa esteja ativa.
    expect(prisma.empresa.findFirst).toHaveBeenCalledWith({
      where: {
        id: empresaId,
        ativo: true,
      },
      select: {
        id: true,
      },
    });

    // Sem empresa válida, a consulta do usuário não deve acontecer.
    expect(prisma.usuario.findFirst).not.toHaveBeenCalled();

    // Nenhum evento pode ser persistido.
    expect(prisma.eventoAuditoria.create).not.toHaveBeenCalled();
  });

  /**
   * Verifica se o usuário existe, está ativo e pertence à empresa informada.
   *
   * O serviço deve filtrar simultaneamente pelo identificador do usuário,
   * pelo identificador da empresa e pela situação ativa.
   *
   * Assim, um usuário inativo ou pertencente a outra empresa
   * não poderá ser atribuído ao evento.
   */
  it('deve rejeitar usuário inexistente, inativo ou vinculado a outra empresa', async () => {
    // Simula ausência de usuário que satisfaça todos os critérios.
    prisma.usuario.findFirst.mockResolvedValueOnce(null);

    await expect(
      service.registrar({
        empresaId,
        atorId,
        tipoAtor: TipoAtorAuditoria.USUARIO_EMPRESA,
        modulo: 'PRODUTOS',
        acao: 'CRIAR',
        resultado: ResultadoAuditoria.SUCESSO,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    // A consulta precisa exigir o usuário ativo e pertencente à empresa.
    expect(prisma.usuario.findFirst).toHaveBeenCalledWith({
      where: {
        id: atorId,
        empresaId,
        ativo: true,
      },
      select: {
        id: true,
      },
    });

    // O evento não pode ser persistido quando a identidade falha.
    expect(prisma.eventoAuditoria.create).not.toHaveBeenCalled();
  });

  /**
   * ADMIN_PLATAFORMA exige atorId.
   *
   * Sem esse identificador, o serviço não consegue verificar
   * se o administrador existe e continua ativo.
   */
  it('deve rejeitar administrador da plataforma sem atorId', async () => {
    await expect(
      service.registrar({
        tipoAtor: TipoAtorAuditoria.ADMIN_PLATAFORMA,
        modulo: 'ADMIN_PLATAFORMA',
        acao: 'LOGIN',
        resultado: ResultadoAuditoria.SUCESSO,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    // Não deve consultar administradores sem um identificador válido.
    expect(
      prisma.administradorPlataforma.findFirst,
    ).not.toHaveBeenCalled();

    expect(prisma.eventoAuditoria.create).not.toHaveBeenCalled();
  });

  /**
   * ADMIN_PLATAFORMA não pode receber empresaId.
   *
   * O administrador pertence ao contexto da plataforma e não deve
   * ser identificado como usuário vinculado a uma empresa cliente.
   */
  it('deve rejeitar empresaId para administrador da plataforma', async () => {
    await expect(
      service.registrar({
        empresaId,
        atorId,
        tipoAtor: TipoAtorAuditoria.ADMIN_PLATAFORMA,
        modulo: 'ADMIN_PLATAFORMA',
        acao: 'LOGIN',
        resultado: ResultadoAuditoria.SUCESSO,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    // A combinação inválida deve ser rejeitada antes da consulta do administrador.
    expect(
      prisma.administradorPlataforma.findFirst,
    ).not.toHaveBeenCalled();

    expect(prisma.eventoAuditoria.create).not.toHaveBeenCalled();
  });

  /**
   * Verifica se o administrador da plataforma existe e está ativo.
   *
   * Um administrador inexistente ou inativo não pode ser utilizado
   * como ator de um novo evento de auditoria.
   */
  it('deve rejeitar administrador inexistente ou inativo', async () => {
    // Simula ausência de administrador ativo com o identificador informado.
    prisma.administradorPlataforma.findFirst.mockResolvedValueOnce(null);

    await expect(
      service.registrar({
        atorId,
        tipoAtor: TipoAtorAuditoria.ADMIN_PLATAFORMA,
        modulo: 'ADMIN_PLATAFORMA',
        acao: 'LOGIN',
        resultado: ResultadoAuditoria.SUCESSO,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    // A consulta precisa exigir que o administrador esteja ativo.
    expect(
      prisma.administradorPlataforma.findFirst,
    ).toHaveBeenCalledWith({
      where: {
        id: atorId,
        ativo: true,
      },
      select: {
        id: true,
      },
    });

    // Nenhum evento pode ser criado para um administrador inválido.
    expect(prisma.eventoAuditoria.create).not.toHaveBeenCalled();
  });

  /**
   * SISTEMA e ANONIMO não representam usuários autenticados.
   *
   * Portanto, esses tipos de ator não podem receber atorId.
   *
   * O teste é executado separadamente para os dois tipos.
   */
  it.each([
    TipoAtorAuditoria.SISTEMA,
    TipoAtorAuditoria.ANONIMO,
  ])(
    'deve rejeitar atorId para o tipo %s',
    async (tipoAtor) => {
      await expect(
        service.registrar({
          atorId,
          tipoAtor,
          modulo: 'AUTH',
          acao: 'LOGIN',
          resultado: ResultadoAuditoria.SUCESSO,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);

      // Nenhum tipo de consulta de identidade deve acontecer.
      expect(prisma.empresa.findFirst).not.toHaveBeenCalled();
      expect(prisma.usuario.findFirst).not.toHaveBeenCalled();
      expect(
        prisma.administradorPlataforma.findFirst,
      ).not.toHaveBeenCalled();

      // O evento inválido não deve ser persistido.
      expect(prisma.eventoAuditoria.create).not.toHaveBeenCalled();
    },
  );

  /**
   * SISTEMA e ANONIMO podem receber empresaId opcional como referência
   * histórica do evento.
   *
   * Essa referência não deve provocar consulta à tabela Empresa.
   *
   * O comportamento preserva a capacidade de registrar eventos históricos
   * mesmo quando a empresa já não existe ou está inativa.
   */
  it.each([
    TipoAtorAuditoria.SISTEMA,
    TipoAtorAuditoria.ANONIMO,
  ])(
    'deve aceitar empresaId histórico sem consultar a empresa para %s',
    async (tipoAtor) => {
      await service.registrar({
        empresaId,
        tipoAtor,
        modulo: 'AUTH',
        acao: 'LOGIN',
        resultado: ResultadoAuditoria.SUCESSO,
      });

      // A referência histórica deve ser preservada no evento.
      expect(prisma.eventoAuditoria.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          empresaId,
          tipoAtor,
        }),
      });

      // Não deve haver consultas de existência ou atividade da empresa.
      expect(prisma.empresa.findFirst).not.toHaveBeenCalled();

      // Também não devem ocorrer consultas de usuários ou administradores.
      expect(prisma.usuario.findFirst).not.toHaveBeenCalled();
      expect(
        prisma.administradorPlataforma.findFirst,
      ).not.toHaveBeenCalled();

      // O evento histórico deve ser persistido normalmente.
      expect(prisma.eventoAuditoria.create).toHaveBeenCalledOnce();
    },
  );

  /**
   * Verifica a utilização do mesmo cliente transacional na validação
   * da identidade empresarial e na gravação do evento.
   *
   * A empresa e o usuário precisam ser consultados pela transação recebida.
   * A gravação também precisa ocorrer nessa mesma transação.
   *
   * O Prisma principal não deve participar desse fluxo.
   */
  it('deve validar o ator empresarial e gravar usando o mesmo cliente transacional', async () => {
    await service.registrar(
      {
        empresaId,
        atorId,
        tipoAtor: TipoAtorAuditoria.USUARIO_EMPRESA,
        modulo: 'VENDAS',
        acao: 'CRIAR',
        resultado: ResultadoAuditoria.SUCESSO,
      },
      transacao as never,
    );

    // Confirma que a consulta da empresa utilizou a transação.
    expect(transacao.empresa.findFirst).toHaveBeenCalledWith({
      where: {
        id: empresaId,
        ativo: true,
      },
      select: {
        id: true,
      },
    });

    // Confirma que a consulta do usuário utilizou a transação.
    expect(transacao.usuario.findFirst).toHaveBeenCalledWith({
      where: {
        id: atorId,
        empresaId,
        ativo: true,
      },
      select: {
        id: true,
      },
    });

    // Confirma que a gravação também utilizou a transação.
    expect(transacao.eventoAuditoria.create).toHaveBeenCalledOnce();

    // O Prisma principal não deve executar consultas nem gravações.
    expect(prisma.empresa.findFirst).not.toHaveBeenCalled();
    expect(prisma.usuario.findFirst).not.toHaveBeenCalled();
    expect(prisma.eventoAuditoria.create).not.toHaveBeenCalled();
  });
  /**
   * FALHA de ator desativado durante a própria operação.
   *
   * Uma operação concorrente pode desativar o ator antes de a falha
   * ser auditada. A falha precisa deixar trilha, então a consulta do
   * usuário NÃO deve exigir ativo: true. O vínculo com a empresa
   * continua obrigatório.
   */
  it('deve registrar FALHA de usuário empresarial sem exigir que ele esteja ativo', async () => {
    await service.registrar({
      empresaId,
      atorId,
      tipoAtor: TipoAtorAuditoria.USUARIO_EMPRESA,
      modulo: 'USUARIOS',
      acao: 'ALTERAR_ATIVACAO',
      resultado: ResultadoAuditoria.FALHA,
    });

    // O usuário é buscado pelo vínculo com a empresa, sem filtro de ativo.
    expect(prisma.usuario.findFirst).toHaveBeenCalledWith({
      where: {
        id: atorId,
        empresaId,
      },
      select: {
        id: true,
      },
    });

    // O evento de falha é persistido.
    expect(prisma.eventoAuditoria.create).toHaveBeenCalledOnce();
  });

  /**
   * SUCESSO continua exigindo ator ativo.
   */
  it('deve continuar exigindo usuário ativo para eventos de SUCESSO', async () => {
    await service.registrar({
      empresaId,
      atorId,
      tipoAtor: TipoAtorAuditoria.USUARIO_EMPRESA,
      modulo: 'USUARIOS',
      acao: 'CRIAR',
      resultado: ResultadoAuditoria.SUCESSO,
    });

    expect(prisma.usuario.findFirst).toHaveBeenCalledWith({
      where: {
        id: atorId,
        empresaId,
        ativo: true,
      },
      select: {
        id: true,
      },
    });
  });

  /**
   * FALHA com usuário inexistente ou de outra empresa continua recusada.
   */
  it('deve rejeitar FALHA de usuário inexistente ou vinculado a outra empresa', async () => {
    prisma.usuario.findFirst.mockResolvedValueOnce(null);

    await expect(
      service.registrar({
        empresaId,
        atorId,
        tipoAtor: TipoAtorAuditoria.USUARIO_EMPRESA,
        modulo: 'USUARIOS',
        acao: 'ALTERAR_ATIVACAO',
        resultado: ResultadoAuditoria.FALHA,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(prisma.eventoAuditoria.create).not.toHaveBeenCalled();
  });

  /**
   * FALHA com empresa inativa continua recusada.
   */
  it('deve rejeitar FALHA quando a empresa estiver inexistente ou inativa', async () => {
    prisma.empresa.findFirst.mockResolvedValueOnce(null);

    await expect(
      service.registrar({
        empresaId,
        atorId,
        tipoAtor: TipoAtorAuditoria.USUARIO_EMPRESA,
        modulo: 'USUARIOS',
        acao: 'ALTERAR_ATIVACAO',
        resultado: ResultadoAuditoria.FALHA,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(prisma.usuario.findFirst).not.toHaveBeenCalled();
    expect(prisma.eventoAuditoria.create).not.toHaveBeenCalled();
  });

  /**
   * TESTE DE REGRESSÃO — PROTEÇÃO DE CREDENCIAIS EM TEXTOS
   *
   * Verifica se a sanitização protege também os valores textuais
   * encontrados em objetos, arrays e campos de texto livre.
   *
   * Abrange:
   * - Senhas contendo espaços.
   * - Tokens Bearer.
   * - Tokens JWT.
   * - URLs com credenciais de banco de dados.
   * - Credenciais em objetos e arrays aninhados.
   */
  it('deve remover credenciais de textos livres e de valores JSON aninhados', async () => {
    const jwt =
      'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.assinaturaJWT12345';

    await service.registrar({
      tipoAtor: TipoAtorAuditoria.SISTEMA,
      modulo: 'AUDITORIA',
      acao: 'SANITIZAR',
      resultado: ResultadoAuditoria.SUCESSO,

      motivo:
        'Tentativa recusada: password=senha muito secreta; etapa=login',

      justificativa:
        'Falha na conexão: postgresql://gestao:senha-db-privada@localhost:5432/gestao',

      dadosPosteriores: {
        descricao:
          'Falha de autenticação: access_token=token privado da sessão; resultado=negado',

        tentativas: [
          'Autorização recebida: Bearer abc.def.ghi',
          `Token recebido: ${jwt}`,
          'URL externa: mysql://usuario:outra-senha@localhost:3306/gestao',
        ],
      },
    });

    const dados = prisma.eventoAuditoria.create.mock.calls[0][0].data;
    const conteudo = JSON.stringify(dados);

    // Nenhuma parte dos segredos utilizados no teste deve permanecer exposta.
    expect(conteudo).not.toContain('senha muito secreta');
    expect(conteudo).not.toContain('muito secreta');
    expect(conteudo).not.toContain('senha-db-privada');
    expect(conteudo).not.toContain('token privado da sessão');
    expect(conteudo).not.toContain('abc.def.ghi');
    expect(conteudo).not.toContain(jwt);
    expect(conteudo).not.toContain('outra-senha');

    // Conteúdos que não são credenciais devem permanecer disponíveis.
    expect(dados.motivo).toContain('etapa=login');
    expect(conteudo).toContain('resultado=negado');
  });

});
