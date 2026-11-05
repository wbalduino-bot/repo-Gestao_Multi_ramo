
/**
 * Identificador utilizado pelo NestJS para injetar
 * a conexão compartilhada do Redis nos serviços.
 *
 * Utilizamos um Symbol para evitar conflitos de nomes
 * com outros providers da aplicação.
 */
export const REDIS_CLIENT = Symbol('REDIS_CLIENT');
