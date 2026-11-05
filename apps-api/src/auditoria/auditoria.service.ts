
import { BadRequestException, Injectable } from '@nestjs/common';
import {
  Prisma,
  ResultadoAuditoria,
  TipoAtorAuditoria,
} from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service.js';

/**
 * CONTRATO DE ENTRADA DA AUDITORIA
 *
 * Define quais informações podem ser fornecidas ao serviço para
 * registrar um evento na tabela central de auditoria.
 *
 * Os campos obrigatórios identificam o tipo de ator, o módulo,
 * a ação executada e o resultado da operação.
 *
 * Os demais campos são opcionais porque nem todo evento possui
 * uma empresa, um usuário ou informações adicionais associadas.
 *
 * IMPORTANTE:
 * empresaId e atorId devem ser obtidos de fontes confiáveis do backend,
 * como o usuário autenticado e o contexto da requisição.
 *
 * Nunca confie nesses identificadores quando forem enviados diretamente
 * pelo frontend.
 */
export interface RegistrarEventoAuditoriaInput {
  empresaId?: string;
  atorId?: string;
  tipoAtor: TipoAtorAuditoria;

  modulo: string;
  acao: string;
  entidade?: string;
  entidadeId?: string;

  /**
   * Identificador de uma tentativa de operação.
   *
   * Deve receber um identificador previamente pseudonimizado.
   * Não enviar e-mail, CPF ou outro dado pessoal em texto puro.
   */
  identificadorTentativa?: string;

  resultado: ResultadoAuditoria;
  motivo?: string;
  justificativa?: string;

  // Informações técnicas utilizadas para rastrear uma requisição.
  requestId?: string;
  ipOrigem?: string;
  userAgent?: string;

  /**
   * Informações opcionais sobre o estado da entidade.
   *
   * dadosAnteriores: situação antes da operação.
   * dadosPosteriores: situação depois da operação.
   * metadados: informações adicionais relevantes para auditoria.
   *
   * O tipo unknown permite receber diferentes estruturas de dados.
   * Antes de persistir, esses valores passam pela sanitização.
   */
  dadosAnteriores?: unknown;
  dadosPosteriores?: unknown;
  metadados?: unknown;
}

/**
 * CLIENTE PRISMA COMPATÍVEL COM A AUDITORIA TRANSACIONAL
 *
 * Permite que o serviço receba tanto o PrismaService normal quanto
 * um cliente de transação do Prisma.
 *
 * Dessa maneira, uma operação comercial pode registrar sua auditoria
 * dentro da mesma transação que altera os dados de negócio.
 *
 * Exemplo:
 * - Criar uma venda.
 * - Atualizar o estoque.
 * - Registrar o evento de auditoria.
 *
 * Se tudo estiver dentro da mesma transação, uma falha poderá
 * provocar o rollback de todas essas operações.
 */
type ClienteAuditoria = Pick<
  Prisma.TransactionClient,
  | 'eventoAuditoria'
  | 'usuario'
  | 'empresa'
  | 'administradorPlataforma'
>;

/**
 * IDENTIFICAÇÃO DE CAMPOS SENSÍVEIS
 *
 * Detecta nomes de propriedades que podem armazenar senhas,
 * tokens, chaves privadas, credenciais ou informações semelhantes.
 *
 * A expressão é aplicada depois da normalização do nome da propriedade,
 * permitindo identificar variações como:
 *
 * password
 * accessToken
 * session_token
 * api-key
 * privateKey
 * authorization
 *
 * O conteúdo dessas propriedades será substituído por [REDACTED].
 */
const CAMPOS_SENSIVEIS =
  /senha|password|token|secret|segredo|authorization|cookie|credential|credencial|apikey|privatekey|accesskey|refreshkey/i;

/**
 * IDENTIFICAÇÃO DE TOKENS BEARER EM TEXTOS LIVRES
 *
 * Procura tokens informados acidentalmente em textos como motivo
 * ou justificativa.
 *
 * Exemplo:
 * Bearer abc.def.ghi
 *
 * O token encontrado será substituído por:
 * Bearer [REDACTED]
 */
const TOKEN_BEARER_REGEX = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;

/**
 * IDENTIFICAÇÃO DE CREDENCIAIS EM TEXTOS LIVRES
 *
 * Detecta credenciais que aparecem em formatos comuns de configuração,
 * logs e mensagens de erro.
 *
 * Exemplos:
 * password=valor
 * senha: valor
 * access_token=valor
 * authorization: valor
 * api-key=valor
 *
 * O nome do campo e o separador são preservados.
 * Somente o valor da credencial é substituído por [REDACTED].
 */
const CREDENCIAIS_TEXTO_REGEX =
  /\b(password|passwd|senha|token|secret|segredo|api[_-]?key|client[_-]?secret|authorization|cookie|credential|credencial|refresh[_-]?token|access[_-]?token)\b(["']?\s*[:=]\s*)("[^"]*"|'[^']*'|[^,;&\r\n}\]]+)/gi;

/**
 * IDENTIFICAÇÃO DE TOKENS JWT EM TEXTOS LIVRES
 *
 * Impede que tokens JWT completos sejam mantidos quando aparecem
 * acidentalmente em descrições, metadados ou mensagens de auditoria.
 */
const TOKEN_JWT_REGEX =
  /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\b/g;

/**
 * IDENTIFICAÇÃO DE SENHAS EM URLS DE CONEXÃO
 *
 * Protege credenciais em URLs de bancos e serviços de armazenamento.
 * Também aceita conexões Redis sem nome de usuário.
 */
const SENHA_URL_REGEX =
  /\b(postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis(?:s)?):\/\/([^:\s/@]*):([^@\s/]+)@/gi;

/**
 * SANITIZAÇÃO CENTRAL DE TEXTOS
 *
 * Todas as strings da auditoria passam pelas mesmas proteções,
 * independentemente de estarem em campos livres, objetos ou arrays.
 *
 * A ordem evita que tokens e credenciais permaneçam expostos
 * em diferentes formatos de representação.
 */
function sanitizarTextoSeguro(valor: string): string {
  return valor
    .replace(TOKEN_BEARER_REGEX, 'Bearer [REDACTED]')
    .replace(TOKEN_JWT_REGEX, '[REDACTED_JWT]')
    .replace(SENHA_URL_REGEX, '$1://$2:[REDACTED]@')
    .replace(CREDENCIAIS_TEXTO_REGEX, '$1$2[REDACTED]');
}

/**
 * VALIDAÇÃO DE IDENTIFICADORES UUID
 *
 * Aceita identificadores no formato UUID com versão e variante válidas.
 *
 * É utilizado para validar empresaId e atorId antes de encaminhar
 * os dados ao Prisma.
 */
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * CONTROLE DO ORÇAMENTO DE SANITIZAÇÃO
 *
 * Mantém os limites disponíveis durante a preparação dos dados JSON.
 *
 * nosRestantes:
 * Quantidade de nós que ainda podem ser processados.
 *
 * caracteresRestantes:
 * Quantidade de caracteres disponíveis para a representação JSON.
 *
 * O mesmo orçamento é compartilhado entre dadosAnteriores,
 * dadosPosteriores e metadados.
 *
 * Isso evita que cada campo utilize individualmente o limite máximo
 * e provoque um volume total superior ao permitido.
 */
interface OrcamentoSanitizacao {
  nosRestantes: number;
  caracteresRestantes: number;
}

/**
 * MARCADOR INTERNO PARA CAMPOS QUE NÃO PODEM SER REPRESENTADOS
 *
 * O Symbol é utilizado internamente para indicar que determinado
 * valor não conseguiu ser sanitizado dentro do orçamento disponível.
 *
 * Ele não deve ser enviado ao banco de dados.
 *
 * Quando esse resultado aparece, a propriedade ou o campo correspondente
 * pode ser omitido da estrutura final.
 */
const OMITIR_JSON = Symbol('OMITIR_JSON');

/**
 * TIPO DO RESULTADO DA SANITIZAÇÃO
 *
 * Representa um valor JSON compatível com o Prisma ou o marcador
 * interno utilizado para indicar que o conteúdo deve ser omitido.
 */
type ResultadoSanitizacao =
  | Prisma.InputJsonValue
  | typeof OMITIR_JSON;

/**
 * LIMITES DE SEGURANÇA E VOLUME
 *
 * LIMITE_NOS_SANITIZACAO:
 * Quantidade máxima de valores processados durante a sanitização.
 *
 * LIMITE_CARACTERES_SANITIZACAO:
 * Tamanho máximo reservado para a representação JSON dos três campos.
 *
 * LIMITE_PROPRIEDADES:
 * Quantidade máxima de propriedades processadas por objeto.
 *
 * LIMITE_ITENS_ARRAY:
 * Quantidade máxima de itens processados em um array.
 *
 * LIMITE_TEXTO:
 * Tamanho máximo de texto processado antes da aplicação do truncamento.
 */
const LIMITE_NOS_SANITIZACAO = 1000;
const LIMITE_CARACTERES_SANITIZACAO = 100_000;
const LIMITE_PROPRIEDADES = 100;
const LIMITE_ITENS_ARRAY = 100;
const LIMITE_TEXTO = 2000;

/**
 * RESERVA DA ESTRUTURA EXTERNA DOS CAMPOS JSON
 *
 * Calcula o espaço ocupado pelos nomes das três propriedades,
 * pelas aspas, pelos dois-pontos, pelas vírgulas e pelos delimitadores
 * do objeto que agrupa os campos JSON.
 *
 * O cálculo parte de um objeto com os três campos definidos como null
 * e desconta o espaço ocupado pelos três valores null.
 *
 * Dessa forma, reserva somente a estrutura externa compartilhada,
 * permitindo que os campos não informados sejam omitidos.
 */
const ESTRUTURA_CAMPOS_JSON = JSON.stringify({
  dadosAnteriores: null,
  dadosPosteriores: null,
  metadados: null,
}).length - JSON.stringify(null).length * 3;

/**
 * ORÇAMENTO DISPONÍVEL PARA O CONTEÚDO JSON
 *
 * Subtrai a estrutura externa reservada do limite total.
 * O resultado será compartilhado pelos três campos JSON.
 */
const ORCAMENTO_CAMPOS_JSON =
  LIMITE_CARACTERES_SANITIZACAO - ESTRUTURA_CAMPOS_JSON;

/**
 * SERVIÇO CENTRAL DE AUDITORIA
 *
 * Responsável por validar, sanitizar e persistir eventos de auditoria.
 *
 * O serviço centraliza os cuidados necessários para evitar que dados
 * inválidos, credenciais ou estruturas excessivamente grandes sejam
 * gravados diretamente no histórico.
 */
@Injectable()
export class AuditoriaService {
  /**
   * Recebe o serviço Prisma utilizado para persistir os eventos.
   */
  constructor(private readonly prisma: PrismaService) {}

  /**
   * REGISTRO DE UM EVENTO DE AUDITORIA
   *
   * Fluxo principal:
   *
   * 1. Valida os campos obrigatórios e os identificadores.
   * 2. Escolhe o cliente Prisma normal ou o cliente transacional.
   * 3. Cria um orçamento compartilhado para os campos JSON.
   * 4. Normaliza e prepara os dados do evento.
   * 5. Sanitiza os conteúdos JSON.
   * 6. Persiste o evento na tabela de auditoria.
   *
   * O parâmetro transacao é opcional.
   *
   * Quando fornecido, permite que a auditoria participe da mesma
   * transação da operação comercial que está sendo executada.
   */
  async registrar(
    entrada: RegistrarEventoAuditoriaInput,
    transacao?: ClienteAuditoria,
  ) {
    /**
     * Seleciona o cliente responsável pela validação e pela gravação.
     *
     * Se uma transação foi fornecida, utiliza essa transação.
     * Caso contrário, utiliza a conexão Prisma principal.
     */
    const cliente = transacao ?? this.prisma;

    // A identidade do ator também é consultada no mesmo cliente escolhido
    // para a gravação, preservando a atomicidade quando houver transação.
    await this.validarEntrada(entrada, cliente);

    /**
     * ORÇAMENTO COMPARTILHADO
     *
     * Inicializa os limites de processamento para este evento.
     *
     * Os três campos JSON utilizarão o mesmo controle.
     * Assim, o limite de caracteres e a quantidade de nós não serão
     * reiniciados a cada propriedade.
     */
    const orcamento: OrcamentoSanitizacao = {
      nosRestantes: LIMITE_NOS_SANITIZACAO,
      caracteresRestantes: ORCAMENTO_CAMPOS_JSON,
    };

    /**
     * MONTA O OBJETO DE PERSISTÊNCIA
     *
     * Prepara os dados no formato esperado pelo Prisma.
     *
     * Os campos obrigatórios são incluídos diretamente.
     * Os campos opcionais são adicionados somente quando informados.
     *
     * Campos textuais passam por normalização e, quando necessário,
     * pela remoção de credenciais.
     *
     * Campos JSON passam pelo processo de sanitização, utilizando
     * o orçamento compartilhado definido anteriormente.
     */
    const dados: Prisma.EventoAuditoriaUncheckedCreateInput = {
      // Identificação e classificação do evento.
      tipoAtor: entrada.tipoAtor,
      modulo: this.normalizarTexto(entrada.modulo, 80, 'modulo'),
      acao: this.normalizarTexto(entrada.acao, 100, 'acao'),
      resultado: entrada.resultado,

      // Identificação opcional da empresa relacionada ao evento.
      ...(entrada.empresaId !== undefined && {
        empresaId: entrada.empresaId,
      }),

      // Identificação opcional do usuário ou administrador responsável.
      ...(entrada.atorId !== undefined && {
        atorId: entrada.atorId,
      }),

      // Nome da entidade de negócio afetada pela operação.
      ...(entrada.entidade !== undefined && {
        entidade: this.normalizarTexto(entrada.entidade, 100, 'entidade'),
      }),

      // Identificador do registro afetado.
      ...(entrada.entidadeId !== undefined && {
        entidadeId: this.normalizarTexto(
          entrada.entidadeId,
          100,
          'entidadeId',
        ),
      }),

      // Identificador pseudonimizado de uma tentativa ou operação.
      ...(entrada.identificadorTentativa !== undefined && {
        identificadorTentativa: this.normalizarTexto(
          entrada.identificadorTentativa,
          255,
          'identificadorTentativa',
        ),
      }),

      // Descrição do motivo do evento, com proteção contra credenciais.
      ...(entrada.motivo !== undefined && {
        motivo: this.sanitizarTextoLivre(
          entrada.motivo,
          500,
          'motivo',
        ),
      }),

      // Justificativa complementar, também protegida contra credenciais.
      ...(entrada.justificativa !== undefined && {
        justificativa: this.sanitizarTextoLivre(
          entrada.justificativa,
          1000,
          'justificativa',
        ),
      }),

      // Identificador técnico para rastreamento da requisição.
      ...(entrada.requestId !== undefined && {
        requestId: this.normalizarTexto(entrada.requestId, 100, 'requestId'),
      }),

      // Endereço IP de origem, quando disponível.
      ...(entrada.ipOrigem !== undefined && {
        ipOrigem: this.normalizarTexto(entrada.ipOrigem, 45, 'ipOrigem'),
      }),

      // Informações do navegador ou cliente que originou a requisição.
      ...(entrada.userAgent !== undefined && {
        userAgent: this.normalizarTexto(
          entrada.userAgent,
          500,
          'userAgent',
        ),
      }),

      // Estado anterior da entidade, sanitizado antes da persistência.
      ...this.prepararCampoJson(
        'dadosAnteriores',
        entrada.dadosAnteriores,
        orcamento,
      ),

      // Estado posterior da entidade, sanitizado antes da persistência.
      ...this.prepararCampoJson(
        'dadosPosteriores',
        entrada.dadosPosteriores,
        orcamento,
      ),

      // Informações complementares do evento, também sanitizadas.
      ...this.prepararCampoJson(
        'metadados',
        entrada.metadados,
        orcamento,
      ),
    };

    // Persiste o evento utilizando o cliente selecionado anteriormente.
    return cliente.eventoAuditoria.create({ data: dados });
  }

  /**
   * VALIDAÇÃO INICIAL DA ENTRADA
   *
   * Verifica se os dados recebidos possuem a estrutura mínima necessária
   * para registrar um evento.
   *
   * Também valida os enums de ator e resultado, além dos identificadores
   * opcionais de empresa e ator.
   *
   * Essa validação acontece antes de qualquer gravação no banco.
   */
  private async validarEntrada(
    entrada: RegistrarEventoAuditoriaInput,
    cliente: ClienteAuditoria,
  ): Promise<void> {
    // Impede o processamento de uma entrada inexistente ou inválida.
    if (!entrada || typeof entrada !== 'object') {
      throw new BadRequestException(
        'Os dados do evento de auditoria são obrigatórios.',
      );
    }

    // Confirma que o tipo de ator pertence ao enum definido no Prisma.
    if (!Object.values(TipoAtorAuditoria).includes(entrada.tipoAtor)) {
      throw new BadRequestException('Tipo de ator inválido.');
    }

    // Confirma que o resultado pertence ao enum definido no Prisma.
    if (!Object.values(ResultadoAuditoria).includes(entrada.resultado)) {
      throw new BadRequestException('Resultado de auditoria inválido.');
    }

    // Módulo e ação são campos obrigatórios e precisam conter texto válido.
    this.normalizarTexto(entrada.modulo, 80, 'modulo');
    this.normalizarTexto(entrada.acao, 100, 'acao');

    // Valida o formato dos UUIDs antes de executar qualquer consulta.
    this.validarUuidOpcional(entrada.empresaId, 'empresa');
    this.validarUuidOpcional(entrada.atorId, 'ator');

    /**
     * REGRAS DE IDENTIDADE POR TIPO DE ATOR
     *
     * USUARIO_EMPRESA:
     * - exige atorId e empresaId;
     * - exige empresa ativa;
     * - exige usuário ativo vinculado à empresa informada.
     *
     * ADMIN_PLATAFORMA:
     * - exige atorId;
     * - não admite empresaId;
     * - exige administrador da plataforma ativo.
     *
     * SISTEMA e ANONIMO:
     * - não admitem atorId;
     * - aceitam empresaId opcional como referência histórica;
     * - não consultam a existência/atividade da empresa.
     */
    switch (entrada.tipoAtor) {
      case TipoAtorAuditoria.USUARIO_EMPRESA: {
        if (!entrada.empresaId || !entrada.atorId) {
          throw new BadRequestException(
            'A identidade do usuário empresarial e da empresa é obrigatória.',
          );
        }

        const empresa = await cliente.empresa.findFirst({
          where: {
            id: entrada.empresaId,
            ativo: true,
          },
          select: { id: true },
        });

        if (!empresa) {
          throw new BadRequestException(
            'O contexto do ator empresarial é inválido.',
          );
        }

        // Falhas podem ser registradas para um ator desativado durante a
        // própria operação (ex.: disputa concorrente). Sucessos continuam
        // exigindo ator ativo. Empresa ativa e vínculo seguem obrigatórios.
        const exigirAtorAtivo =
          entrada.resultado !== ResultadoAuditoria.FALHA;

        const usuario = await cliente.usuario.findFirst({
          where: {
            id: entrada.atorId,
            empresaId: entrada.empresaId,
            ...(exigirAtorAtivo ? { ativo: true } : {}),
          },
          select: { id: true },
        });

        if (!usuario) {
          throw new BadRequestException(
            'O contexto do ator empresarial é inválido.',
          );
        }

        return;
      }

      case TipoAtorAuditoria.ADMIN_PLATAFORMA: {
        if (!entrada.atorId) {
          throw new BadRequestException(
            'A identidade do administrador da plataforma é obrigatória.',
          );
        }

        if (entrada.empresaId !== undefined) {
          throw new BadRequestException(
            'Administrador da plataforma não pode estar vinculado a uma empresa neste evento.',
          );
        }

        const administrador =
          await cliente.administradorPlataforma.findFirst({
            where: {
              id: entrada.atorId,
              ativo: true,
            },
            select: { id: true },
          });

        if (!administrador) {
          throw new BadRequestException(
            'A identidade do administrador da plataforma é inválida.',
          );
        }

        return;
      }

      case TipoAtorAuditoria.SISTEMA:
      case TipoAtorAuditoria.ANONIMO: {
        if (entrada.atorId !== undefined) {
          throw new BadRequestException(
            'Este tipo de ator não pode possuir identificador de usuário.',
          );
        }

        // empresaId pode representar uma referência histórica. Não consultar
        // a tabela Empresa evita invalidar eventos após exclusões/inativações.
        return;
      }

      default:
        throw new BadRequestException('Tipo de ator inválido.');
    }
  }

  /**
   * VALIDAÇÃO DE UUID OPCIONAL
   *
   * Verifica se um identificador segue o formato UUID esperado.
   *
   * Quando o valor é undefined, significa que o identificador não foi
   * informado e a validação é dispensada.
   *
   * Qualquer outro valor que não seja uma string UUID válida provoca
   * uma exceção de requisição inválida.
   */
  private validarUuidOpcional(
    valor: unknown,
    campo: string,
  ): void {
    if (valor === undefined) {
      return;
    }

    if (typeof valor !== 'string' || !UUID_REGEX.test(valor)) {
      throw new BadRequestException(
        `Identificador de ${campo} inválido.`,
      );
    }
  }

  /**
   * NORMALIZAÇÃO DE TEXTOS
   *
   * Centraliza a validação de campos textuais.
   *
   * Responsabilidades:
   * - Confirmar que o valor é uma string.
   * - Rejeitar valores vazios ou compostos somente por espaços.
   * - Remover espaços no início e no final.
   * - Impedir que o tamanho ultrapasse o limite definido.
   *
   * O método devolve o texto normalizado para ser utilizado
   * na montagem do registro de auditoria.
   */
  private normalizarTexto(
    valor: string,
    tamanhoMaximo: number,
    campo: string,
  ): string {
    // Rejeita valores ausentes, não textuais ou sem conteúdo útil.
    if (typeof valor !== 'string' || !valor.trim()) {
      throw new BadRequestException(
        `O campo ${campo} é obrigatório e deve ser um texto válido.`,
      );
    }

    // Remove espaços externos sem alterar o conteúdo interno.
    const texto = valor.trim();

    // Impede que o campo ultrapasse o tamanho previsto no schema.
    if (texto.length > tamanhoMaximo) {
      throw new BadRequestException(
        `O campo ${campo} excede o limite de ${tamanhoMaximo} caracteres.`,
      );
    }

    return texto;
  }

  /**
   * SANITIZAÇÃO DE TEXTOS LIVRES
   *
   * Utilizada nos campos motivo e justificativa.
   *
   * Primeiro normaliza e valida o texto.
   * Depois procura padrões conhecidos de credenciais.
   *
   * A substituição evita que senhas, tokens e segredos sejam armazenados
   * acidentalmente em mensagens de auditoria.
   *
   * IMPORTANTE:
   * Essa proteção é complementar.
   * Os sistemas que chamarem o serviço devem evitar enviar credenciais
   * nesses campos desde a origem.
   */
  private sanitizarTextoLivre(
    valor: string,
    tamanhoMaximo: number,
    campo: string,
  ): string {
    // Valida o conteúdo e remove espaços externos.
    const texto = this.normalizarTexto(valor, tamanhoMaximo, campo);

    // Substitui tokens Bearer e credenciais identificadas por marcadores.
    return sanitizarTextoSeguro(texto);
  }

  /**
   * PREPARAÇÃO DE UM CAMPO JSON
   *
   * Responsável por preparar dadosAnteriores, dadosPosteriores
   * ou metadados para serem incluídos no objeto enviado ao Prisma.
   *
   * Se o valor não foi informado ou é null, o campo não será incluído.
   *
   * Se houver conteúdo, ele será encaminhado ao sanitizador.
   * Caso o sanitizador indique que não é possível representar o valor
   * dentro do orçamento, o campo será omitido.
   */
  private prepararCampoJson(
    campo: 'dadosAnteriores' | 'dadosPosteriores' | 'metadados',
    valor: unknown,
    orcamento: OrcamentoSanitizacao,
  ): Pick<
    Prisma.EventoAuditoriaUncheckedCreateInput,
    'dadosAnteriores' | 'dadosPosteriores' | 'metadados'
  > {
    // Campos ausentes ou nulos não precisam ser persistidos.
    if (valor === undefined || valor === null) {
      return {};
    }

    // Inicia a sanitização utilizando um controle de referências próprio
    // para este campo e o orçamento compartilhado do evento.
    const sanitizado = this.sanitizarJson(
      valor,
      0,
      new WeakSet<object>(),
      orcamento,
    );

    // Se não houver espaço nem para uma representação válida,
    // o campo será omitido em vez de ultrapassar o limite.
    if (sanitizado === OMITIR_JSON) {
      return {};
    }

    // Devolve somente a propriedade correspondente ao campo processado.
    return {
      [campo]: sanitizado,
    };
  }

  /**
   * NORMALIZAÇÃO DE NOMES DE PROPRIEDADES
   *
   * Remove caracteres especiais e converte o nome para letras minúsculas.
   *
   * Essa etapa facilita a identificação de campos sensíveis mesmo
   * quando utilizam diferentes padrões de nomenclatura.
   *
   * Exemplos:
   * accessToken -> accesstoken
   * session_token -> sessiontoken
   * api-key -> apikey
   */
  private normalizarNomePropriedade(chave: string): string {
    return chave.replace(/[^a-z0-9]/gi, '').toLowerCase();
  }

  /**
   * CONTABILIZAÇÃO DE STRINGS NO JSON
   *
   * Calcula o tamanho que uma string ocupará na representação JSON.
   *
   * Utiliza JSON.stringify para contabilizar corretamente:
   * - Aspas de abertura e fechamento.
   * - Barras invertidas.
   * - Caracteres que precisam ser escapados.
   *
   * Se o texto couber no orçamento, o consumo é descontado.
   * Caso contrário, o orçamento permanece inalterado.
   */
  private consumirString(
    texto: string,
    orcamento: OrcamentoSanitizacao,
  ): boolean {
    const tamanho = JSON.stringify(texto).length;

    // Não permite consumir mais caracteres do que os disponíveis.
    if (tamanho > orcamento.caracteresRestantes) {
      return false;
    }

    // Desconta o espaço ocupado pela string serializada.
    orcamento.caracteresRestantes -= tamanho;
    return true;
  }

  /**
   * CONTABILIZAÇÃO DA ESTRUTURA JSON
   *
   * Desconta caracteres utilizados por elementos estruturais,
   * como chaves, colchetes, vírgulas e dois-pontos.
   *
   * É utilizado em conjunto com consumirString para controlar
   * o tamanho total da representação JSON.
   */
  private consumirEstrutura(
    quantidade: number,
    orcamento: OrcamentoSanitizacao,
  ): boolean {
    // Impede que a estrutura ultrapasse o orçamento disponível.
    if (quantidade > orcamento.caracteresRestantes) {
      return false;
    }

    // Desconta a quantidade de caracteres estruturais solicitada.
    orcamento.caracteresRestantes -= quantidade;
    return true;
  }

  /**
   * CRIAÇÃO DE MARCADORES DE SANITIZAÇÃO
   *
   * Produz um texto explicativo para substituir valores removidos,
   * inválidos ou não suportados.
   *
   * O tamanho do marcador também é contabilizado no orçamento.
   *
   * Se nem o marcador couber, retorna OMITIR_JSON para sinalizar
   * que o conteúdo não pode ser representado.
   */
  private marcador(
    texto: string,
    orcamento: OrcamentoSanitizacao,
  ): ResultadoSanitizacao {
    return this.consumirString(texto, orcamento)
      ? texto
      : OMITIR_JSON;
  }

  /**
   * SANITIZAÇÃO DE STRINGS
   *
   * Trata valores textuais encontrados dentro de objetos e arrays.
   *
   * Se a string estiver dentro do limite de texto, tenta armazená-la
   * integralmente.
   *
   * Se ultrapassar o limite ou não couber no orçamento global,
   * aplica um marcador de limite.
   *
   * Para textos maiores que LIMITE_TEXTO, procura por busca binária
   * o maior trecho que pode ser mantido junto com o marcador
   * [TEXTO_TRUNCADO].
   *
   * A busca binária evita testar todos os tamanhos possíveis
   * individualmente.
   */
  private sanitizarString(
    valor: string,
    orcamento: OrcamentoSanitizacao,
  ): ResultadoSanitizacao {
    // Remove credenciais antes de aplicar os limites de texto e orçamento.
    valor = sanitizarTextoSeguro(valor);

    // Strings dentro do limite podem ser armazenadas integralmente.
    if (valor.length <= LIMITE_TEXTO) {
      if (this.consumirString(valor, orcamento)) {
        return valor;
      }

      // O texto não cabe no orçamento global.
      return this.marcador('[LIMITE_DE_CONTEUDO]', orcamento);
    }

    // Limita o trecho original utilizado na tentativa de truncamento.
    const texto = valor.slice(0, LIMITE_TEXTO);
    const marcadorTruncamento = '[TEXTO_TRUNCADO]';

    /**
     * LIMITES DA BUSCA BINÁRIA
     *
     * inicio: menor quantidade de caracteres que será testada.
     * fim: maior quantidade de caracteres que será testada.
     * melhorResultado: maior texto que conseguiu caber no orçamento.
     */
    let inicio = 0;
    let fim = texto.length;
    let melhorResultado: string | undefined;

    // Procura o maior prefixo que cabe junto com o marcador.
    while (inicio <= fim) {
      const meio = Math.floor((inicio + fim) / 2);
      const candidato =
        `${texto.slice(0, meio)}${marcadorTruncamento}`;

      // Mede o tamanho da string no formato JSON.
      const tamanho = JSON.stringify(candidato).length;

      if (tamanho <= orcamento.caracteresRestantes) {
        // O candidato cabe: guarda o resultado e tenta aumentar o trecho.
        melhorResultado = candidato;
        inicio = meio + 1;
      } else {
        // O candidato não cabe: tenta um trecho menor.
        fim = meio - 1;
      }
    }

    // Se encontrou um texto válido, consome seu espaço e retorna.
    if (melhorResultado !== undefined) {
      this.consumirString(melhorResultado, orcamento);
      return melhorResultado;
    }

    // Se nem o texto truncado couber, tenta utilizar um marcador menor.
    return this.marcador('[LIMITE_DE_CONTEUDO]', orcamento);
  }

  /**
   * SANITIZADOR PRINCIPAL DE VALORES JSON
   *
   * Processa recursivamente os valores recebidos antes da persistência.
   *
   * Tipos tratados:
   * - null.
   * - strings.
   * - booleanos.
   * - números finitos.
   * - datas.
   * - arrays.
   * - objetos simples.
   *
   * Também protege contra:
   * - referências circulares.
   * - estruturas muito profundas.
   * - excesso de nós.
   * - objetos não suportados.
   * - propriedades que poderiam executar getters.
   *
   * A função é recursiva porque objetos podem conter outros objetos
   * e arrays com estruturas aninhadas.
   */
  private sanitizarJson(
    valor: unknown,
    profundidade = 0,
    referencias = new WeakSet<object>(),
    orcamento: OrcamentoSanitizacao = {
      nosRestantes: LIMITE_NOS_SANITIZACAO,
      caracteresRestantes: ORCAMENTO_CAMPOS_JSON,
    },
  ): ResultadoSanitizacao {
    // Guarda o orçamento atual para possibilitar reversão em caso de erro.
    const caracteresAntes = orcamento.caracteresRestantes;

    // Armazena a referência adicionada nesta chamada, se houver.
    let referenciaAdicionada: object | undefined;

    try {
      /**
       * CONTROLE DE QUANTIDADE DE NÓS
       *
       * Cada valor processado consome uma unidade.
       * Quando o limite acaba, o conteúdo é substituído por um marcador.
       */
      if (orcamento.nosRestantes <= 0) {
        return this.marcador('[LIMITE_DE_CONTEUDO]', orcamento);
      }

      // Consome uma unidade para o valor que será processado.
      orcamento.nosRestantes--;

      /**
       * TRATAMENTO DE VALORES NULOS
       *
       * O valor null é representado por um marcador textual.
       */
      if (valor === null) {
        return this.marcador('[VALOR_NULO]', orcamento);
      }

      // Strings são encaminhadas para o sanitizador específico de textos.
      if (typeof valor === 'string') {
        return this.sanitizarString(valor, orcamento);
      }

      /**
       * TRATAMENTO DE BOOLEANOS E NÚMEROS FINITOS
       *
       * Esses tipos são compatíveis com JSON e podem ser mantidos
       * sem conversão para texto.
       */
      if (
        typeof valor === 'boolean' ||
        (typeof valor === 'number' && Number.isFinite(valor))
      ) {
        const tamanho = JSON.stringify(valor).length;

        // Contabiliza o tamanho do valor primitivo.
        if (this.consumirEstrutura(tamanho, orcamento)) {
          return valor;
        }

        // Se não couber, utiliza um marcador de limite.
        return this.marcador('[LIMITE_DE_CONTEUDO]', orcamento);
      }

      /**
       * TRATAMENTO DE NÚMEROS NÃO FINITOS
       *
       * NaN, Infinity e -Infinity não são valores JSON válidos.
       * Por isso, são convertidos em marcadores textuais.
       */
      if (typeof valor === 'number') {
        return this.marcador(String(valor), orcamento);
      }

      /**
       * TRATAMENTO DE TIPOS NÃO SUPORTADOS
       *
       * undefined, funções, símbolos e outros tipos que não podem
       * ser representados diretamente são substituídos por marcador.
       */
      if (typeof valor !== 'object') {
        return this.marcador('[VALOR_NAO_SUPORTADO]', orcamento);
      }

      /**
       * TRATAMENTO DE DATAS
       *
       * Datas válidas são convertidas para o padrão ISO 8601.
       * Datas inválidas são substituídas por um marcador.
       */
      if (valor instanceof Date) {
        return Number.isNaN(valor.getTime())
          ? this.marcador('[DATA_INVALIDA]', orcamento)
          : this.sanitizarString(valor.toISOString(), orcamento);
      }

      /**
       * LIMITE DE PROFUNDIDADE
       *
       * Impede o processamento de estruturas excessivamente aninhadas.
       *
       * A profundidade é incrementada a cada entrada em um objeto
       * ou array filho.
       */
      if (profundidade >= 6) {
        return this.marcador('[LIMITE_DE_PROFUNDIDADE]', orcamento);
      }

      /**
       * DETECÇÃO DE REFERÊNCIAS CIRCULARES
       *
       * Verifica se o objeto atual já está sendo processado na cadeia
       * de chamadas.
       *
       * Isso evita recursão infinita em estruturas que apontam
       * novamente para um objeto que já está em processamento.
       */
      if (referencias.has(valor)) {
        return this.marcador('[REFERENCIA_CIRCULAR]', orcamento);
      }

      // Marca o objeto como parte da cadeia de processamento atual.
      referencias.add(valor);
      referenciaAdicionada = valor;

      /**
       * IDENTIFICAÇÃO DE ARRAYS
       *
       * Arrays possuem uma estrutura própria e precisam ser tratados
       * separadamente dos objetos comuns.
       */
      if (Array.isArray(valor)) {
        return this.sanitizarArray(
          valor,
          profundidade,
          referencias,
          orcamento,
        );
      }

      /**
       * VALIDAÇÃO DO PROTÓTIPO DO OBJETO
       *
       * Aceita somente objetos simples ou objetos sem protótipo.
       *
       * Classes, instâncias especiais e outros objetos complexos
       * são considerados não suportados.
       *
       * Essa restrição reduz riscos de executar comportamentos
       * personalizados durante a inspeção dos dados.
       */
      const prototipo = Object.getPrototypeOf(valor);

      if (prototipo !== Object.prototype && prototipo !== null) {
        return this.marcador('[OBJETO_NAO_SUPORTADO]', orcamento);
      }

      /**
       * LEITURA DOS DESCRITORES DAS PROPRIEDADES
       *
       * Obtém informações sobre as propriedades sem acessar diretamente
       * seus valores por meio de getters.
       *
       * Isso é importante porque um getter pode executar código
       * durante a leitura de uma propriedade.
       */
      const propriedades = Object.getOwnPropertyDescriptors(
        valor,
      ) as Record<string, PropertyDescriptor>;

      /**
       * RESERVA DA ESTRUTURA DO OBJETO
       *
       * Reserva dois caracteres para as chaves de abertura e fechamento:
       * { e }.
       *
       * Sem essa reserva, o objeto poderia consumir todo o orçamento
       * com propriedades e não possuir espaço para uma estrutura JSON válida.
       */
      if (!this.consumirEstrutura(2, orcamento)) {
        return OMITIR_JSON;
      }

      /**
       * OBJETO DE RESULTADO
       *
       * Cria um objeto sem protótipo para armazenar as propriedades
       * já sanitizadas.
       *
       * Isso evita herdar propriedades do protótipo padrão.
       */
      const resultado: Record<string, Prisma.InputJsonValue> =
        Object.create(null);

      // Conta quantas propriedades válidas foram incluídas no resultado.
      let quantidade = 0;

      /**
       * PROCESSAMENTO DAS PROPRIEDADES
       *
       * Percorre os descritores obtidos anteriormente.
       *
       * Cada propriedade passa por:
       * - Verificação de enumerabilidade.
       * - Controle da quantidade máxima.
       * - Contabilização do nome e dos separadores.
       * - Identificação de campos sensíveis.
       * - Sanitização do valor.
       */
      for (const [chave, descritor] of Object.entries(propriedades)) {
        // Ignora propriedades que não seriam enumeradas normalmente.
        if (!descritor.enumerable) {
          continue;
        }

        // Interrompe quando o limite de propriedades for alcançado.
        if (quantidade >= LIMITE_PROPRIEDADES) {
          break;
        }

        // Guarda o orçamento antes de iniciar o processamento da propriedade.
        const caracteresAntesPropriedade =
          orcamento.caracteresRestantes;

        /**
         * CUSTO DA PROPRIEDADE
         *
         * Calcula o espaço necessário para:
         * - A vírgula, quando não for a primeira propriedade.
         * - O nome da propriedade serializado.
         * - O caractere de dois-pontos.
         */
        const custoSeparador = quantidade > 0 ? 1 : 0;
        const custoChave = JSON.stringify(chave).length + 1;

        // Se o nome da propriedade não couber, interrompe o processamento.
        if (
          !this.consumirEstrutura(
            custoSeparador + custoChave,
            orcamento,
          )
        ) {
          break;
        }

        // Normaliza o nome para facilitar a identificação de credenciais.
        const nomeNormalizado = this.normalizarNomePropriedade(chave);

        // Armazenará o resultado sanitizado da propriedade atual.
        let valorSanitizado: ResultadoSanitizacao;

        /**
         * PROTEÇÃO DE CAMPOS SENSÍVEIS
         *
         * Se o nome da propriedade indicar uma credencial,
         * seu conteúdo original não será processado.
         */
        if (CAMPOS_SENSIVEIS.test(nomeNormalizado)) {
          valorSanitizado = this.marcador('[REDACTED]', orcamento);
        } else if (
          /**
           * PROTEÇÃO CONTRA GETTERS E SETTERS
           *
           * Se o descritor não possuir a propriedade value,
           * significa que se trata de uma propriedade acessora.
           *
           * O conteúdo não será acessado para evitar a execução
           * de código personalizado.
           */
          !Object.prototype.hasOwnProperty.call(descritor, 'value')
        ) {
          // Não executa getters nem setters.
          valorSanitizado = this.marcador(
            '[PROPRIEDADE_ACESSORA_IGNORADA]',
            orcamento,
          );
        } else {
          /**
           * SANITIZAÇÃO RECURSIVA
           *
           * Processa o valor da propriedade.
           * A profundidade aumenta em uma unidade porque estamos
           * entrando em um novo nível da estrutura.
           */
          valorSanitizado = this.sanitizarJson(
            descritor.value,
            profundidade + 1,
            referencias,
            orcamento,
          );
        }

        /**
         * REVERSÃO DE ORÇAMENTO
         *
         * Se o valor não puder ser representado, o custo da propriedade
         * atual será revertido.
         *
         * Dessa forma, o processamento não deixa caracteres reservados
         * para uma propriedade que não será incluída no resultado.
         */
        if (valorSanitizado === OMITIR_JSON) {
          orcamento.caracteresRestantes =
            caracteresAntesPropriedade;
          break;
        }

        // Inclui no resultado somente o valor que foi sanitizado.
        resultado[chave] = valorSanitizado;

        // Atualiza a quantidade de propriedades efetivamente incluídas.
        quantidade++;
      }

      // Devolve o objeto com suas propriedades já sanitizadas.
      return resultado as Prisma.InputJsonObject;
    } catch {
      /**
       * TRATAMENTO DE ERROS DURANTE A INSPEÇÃO
       *
       * Caso ocorra uma falha ao inspecionar ou processar o objeto,
       * o consumo de caracteres desta chamada é revertido.
       *
       * Em seguida, tenta registrar um marcador genérico.
       *
       * Isso evita que uma estrutura problemática interrompa
       * automaticamente o fluxo de registro do evento.
       */
      orcamento.caracteresRestantes = caracteresAntes;

      return this.marcador('[OBJETO_NAO_SUPORTADO]', orcamento);
    } finally {
      /**
       * LIMPEZA DO CONTROLE DE REFERÊNCIAS
       *
       * Remove o objeto da lista de referências em processamento.
       *
       * Essa remoção permite que o mesmo objeto seja utilizado
       * em outro ponto da estrutura sem ser confundido com uma
       * referência circular.
       */
      if (referenciaAdicionada !== undefined) {
        referencias.delete(referenciaAdicionada);
      }
    }
  }

  /**
   * SANITIZAÇÃO DE ARRAYS
   *
   * Processa os elementos de arrays sem acessar diretamente
   * os índices por operações que poderiam executar getters.
   *
   * Utiliza os descritores das propriedades para inspecionar
   * cada posição com mais controle.
   *
   * Também aplica:
   * - Limite máximo de itens.
   * - Contabilização de vírgulas e colchetes.
   * - Proteção contra getters.
   * - Sanitização recursiva dos elementos.
   */
  private sanitizarArray(
    valor: unknown[],
    profundidade: number,
    referencias: WeakSet<object>,
    orcamento: OrcamentoSanitizacao,
  ): ResultadoSanitizacao {
    /**
     * OBTENÇÃO DOS DESCRITORES
     *
     * Recupera os descritores das posições do array e de suas
     * propriedades sem executar getters.
     */
    const descritores = Object.getOwnPropertyDescriptors(
      valor,
    ) as Record<string, PropertyDescriptor>;

    /**
     * OBTENÇÃO DO COMPRIMENTO
     *
     * O tamanho do array é obtido pelo descritor da propriedade length.
     * O resultado é convertido para número inteiro não negativo.
     */
    const comprimento = Math.max(
      0,
      Math.floor(Number(descritores.length?.value ?? 0)),
    );

    // Indica se o array original ultrapassou a quantidade permitida.
    const excedeuLimite = comprimento > LIMITE_ITENS_ARRAY;

    /**
     * DEFINIÇÃO DA QUANTIDADE DE ELEMENTOS
     *
     * Quando o limite é ultrapassado, reserva uma posição para
     * o marcador [LIMITE_DE_ITENS].
     *
     * Quando não ultrapassa, processa a quantidade permitida,
     * respeitando o limite máximo configurado.
     */
    const quantidade = excedeuLimite
      ? LIMITE_ITENS_ARRAY - 1
      : Math.min(comprimento, LIMITE_ITENS_ARRAY);

    // Reserva os dois caracteres estruturais: [ e ].
    if (!this.consumirEstrutura(2, orcamento)) {
      return OMITIR_JSON;
    }

    // Armazena os elementos depois da sanitização.
    const resultado: Prisma.InputJsonValue[] = [];

    /**
     * PROCESSAMENTO DOS ITENS
     *
     * Percorre somente a quantidade de posições permitida.
     *
     * Cada posição é analisada pelo descritor correspondente.
     */
    for (let indice = 0; indice < quantidade; indice++) {
      // Guarda o orçamento antes do processamento do item atual.
      const caracteresAntesItem = orcamento.caracteresRestantes;

      /**
       * CONTABILIZAÇÃO DO SEPARADOR
       *
       * A primeira posição não possui vírgula antes dela.
       * Os elementos seguintes precisam consumir um caractere adicional.
       */
      if (!this.consumirEstrutura(resultado.length > 0 ? 1 : 0, orcamento)) {
        break;
      }

      // Recupera o descritor da posição atual sem acessar diretamente o índice.
      const descritor = descritores[String(indice)];

      // Armazenará o conteúdo sanitizado do elemento atual.
      let valorSanitizado: ResultadoSanitizacao;

      /**
       * TRATAMENTO DE POSIÇÕES AUSENTES
       *
       * Arrays podem possuir posições vazias.
       * Quando não existe descritor para uma posição, utiliza um marcador.
       */
      if (!descritor) {
        valorSanitizado = this.marcador('[ITEM_AUSENTE]', orcamento);
      } else if (
        /**
         * PROTEÇÃO CONTRA GETTERS EM ARRAYS
         *
         * Quando o descritor não possui value, significa que a posição
         * utiliza uma propriedade acessora.
         *
         * O getter não será executado.
         */
        !Object.prototype.hasOwnProperty.call(descritor, 'value')
      ) {
        valorSanitizado = this.marcador(
          '[PROPRIEDADE_ACESSORA_IGNORADA]',
          orcamento,
        );
      } else {
        /**
         * SANITIZAÇÃO RECURSIVA DO ELEMENTO
         *
         * O valor da posição passa pelo mesmo sanitizador utilizado
         * para objetos e demais valores JSON.
         */
        valorSanitizado = this.sanitizarJson(
          descritor.value,
          profundidade + 1,
          referencias,
          orcamento,
        );
      }

      /**
       * DESCARTE DO ITEM
       *
       * Se o elemento não puder ser representado, o consumo realizado
       * durante seu processamento será revertido.
       *
       * O array permanece válido e o processamento dos itens é encerrado.
       */
      if (valorSanitizado === OMITIR_JSON) {
        orcamento.caracteresRestantes = caracteresAntesItem;
        break;
      }

      // Inclui o elemento sanitizado na lista final.
      resultado.push(valorSanitizado);
    }

    /**
     * MARCADOR DE EXCESSO DE ITENS
     *
     * Quando o array original ultrapassa o limite configurado,
     * tenta incluir um marcador para indicar que parte do conteúdo
     * não foi registrada.
     */
    if (excedeuLimite) {
      // Guarda o orçamento antes de tentar acrescentar o marcador.
      const caracteresAntesMarcador = orcamento.caracteresRestantes;

      /**
       * A vírgula somente será necessária quando já houver elementos
       * no array sanitizado.
       */
      const separador = resultado.length > 0 ? 1 : 0;

      if (this.consumirEstrutura(separador, orcamento)) {
        // Tenta reservar espaço para o marcador de limite.
        const marcadorLimite = this.marcador(
          '[LIMITE_DE_ITENS]',
          orcamento,
        );

        if (marcadorLimite !== OMITIR_JSON) {
          // Inclui o marcador no final do array.
          resultado.push(marcadorLimite);
        } else {
          // Reverte o consumo caso o marcador não caiba.
          orcamento.caracteresRestantes = caracteresAntesMarcador;
        }
      }
    }

    // Retorna o array final, contendo somente os elementos sanitizados.
    return resultado;
  }
}
