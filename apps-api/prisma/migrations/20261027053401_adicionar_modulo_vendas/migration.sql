-- CreateEnum
CREATE TYPE "FormaPagamento" AS ENUM ('DINHEIRO', 'PIX', 'CARTAO_DEBITO', 'CARTAO_CREDITO', 'OUTRO');

-- CreateTable
CREATE TABLE "Venda" (
    "id" UUID NOT NULL,
    "empresaId" UUID NOT NULL,
    "usuarioId" UUID NOT NULL,
    "formaPagamento" "FormaPagamento" NOT NULL,
    "total" DECIMAL(14,2) NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Venda_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ItemVenda" (
    "id" UUID NOT NULL,
    "vendaId" UUID NOT NULL,
    "produtoId" UUID NOT NULL,
    "quantidade" DECIMAL(14,3) NOT NULL,
    "precoUnitario" DECIMAL(12,2) NOT NULL,
    "subtotal" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "ItemVenda_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Venda_empresaId_criadoEm_idx" ON "Venda"("empresaId", "criadoEm");

-- CreateIndex
CREATE INDEX "Venda_usuarioId_criadoEm_idx" ON "Venda"("usuarioId", "criadoEm");

-- CreateIndex
CREATE INDEX "ItemVenda_produtoId_idx" ON "ItemVenda"("produtoId");

-- CreateIndex
CREATE UNIQUE INDEX "ItemVenda_vendaId_produtoId_key" ON "ItemVenda"("vendaId", "produtoId");

-- AddForeignKey
ALTER TABLE "Venda" ADD CONSTRAINT "Venda_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Venda" ADD CONSTRAINT "Venda_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemVenda" ADD CONSTRAINT "ItemVenda_vendaId_fkey" FOREIGN KEY ("vendaId") REFERENCES "Venda"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemVenda" ADD CONSTRAINT "ItemVenda_produtoId_fkey" FOREIGN KEY ("produtoId") REFERENCES "Produto"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
