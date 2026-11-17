CREATE TABLE "VinculoProdutoFornecedorCompra" (
    "id" UUID NOT NULL,
    "empresaId" UUID NOT NULL,
    "fornecedorCnpj" TEXT NOT NULL,
    "codigoFornecedor" TEXT NOT NULL,
    "produtoId" UUID NOT NULL,
    CONSTRAINT "VinculoProdutoFornecedorCompra_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "VinculoProdutoFornecedorCompra_produto_fkey"
      FOREIGN KEY ("empresaId", "produtoId") REFERENCES "Produto"("empresaId", "id")
      ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "VinculoProdutoFornecedorCompra_identidade_key"
  ON "VinculoProdutoFornecedorCompra"("empresaId", "fornecedorCnpj", "codigoFornecedor");

CREATE INDEX "VinculoProdutoFornecedorCompra_produto_idx"
  ON "VinculoProdutoFornecedorCompra"("empresaId", "produtoId");
