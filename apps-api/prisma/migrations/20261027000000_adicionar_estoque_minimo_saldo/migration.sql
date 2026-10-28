-- Adiciona o estoque mínimo ao saldo de cada produto.
-- O valor padrão zero mantém os registros existentes compatíveis.
ALTER TABLE "SaldoEstoque"
ADD COLUMN "estoqueMinimo" DECIMAL(14,3) NOT NULL DEFAULT 0;
