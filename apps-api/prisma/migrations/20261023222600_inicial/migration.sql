-- CreateEnum
CREATE TYPE "PerfilAcesso" AS ENUM ('ADMINISTRADOR', 'GERENTE', 'CAIXA', 'ATENDENTE', 'GARCOM');

-- CreateEnum
CREATE TYPE "TipoMovimentacao" AS ENUM ('ENTRADA', 'SAIDA', 'AJUSTE', 'RESERVA', 'LIBERACAO');

-- CreateTable
CREATE TABLE "Empresa" (
    "id" UUID NOT NULL,
    "nome" TEXT NOT NULL,
    "cnpj" TEXT NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Empresa_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Usuario" (
    "id" UUID NOT NULL,
    "empresaId" UUID NOT NULL,
    "nome" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "hashSenha" TEXT NOT NULL,
    "perfil" "PerfilAcesso" NOT NULL DEFAULT 'CAIXA',
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Usuario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Categoria" (
    "id" UUID NOT NULL,
    "empresaId" UUID NOT NULL,
    "nome" TEXT NOT NULL,
    "categoriaPaiId" UUID,

    CONSTRAINT "Categoria_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Unidade" (
    "id" UUID NOT NULL,
    "empresaId" UUID NOT NULL,
    "codigo" TEXT NOT NULL,
    "nome" TEXT NOT NULL,

    CONSTRAINT "Unidade_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Produto" (
    "id" UUID NOT NULL,
    "empresaId" UUID NOT NULL,
    "nome" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "descricao" TEXT,
    "categoriaId" UUID,
    "unidadeId" UUID,
    "codigoBarras" TEXT,
    "preco" DECIMAL(12,2) NOT NULL,
    "custo" DECIMAL(12,2) NOT NULL,
    "perecivel" BOOLEAN NOT NULL DEFAULT false,
    "peso" DECIMAL(12,3),
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Produto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SaldoEstoque" (
    "id" UUID NOT NULL,
    "empresaId" UUID NOT NULL,
    "produtoId" UUID NOT NULL,
    "quantidadeDisponivel" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "quantidadeReservada" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SaldoEstoque_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MovimentacaoEstoque" (
    "id" UUID NOT NULL,
    "empresaId" UUID NOT NULL,
    "produtoId" UUID NOT NULL,
    "tipo" "TipoMovimentacao" NOT NULL,
    "quantidade" DECIMAL(14,3) NOT NULL,
    "saldoApos" DECIMAL(14,3) NOT NULL,
    "motivo" TEXT NOT NULL,
    "referenciaId" TEXT,
    "usuarioId" UUID NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MovimentacaoEstoque_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Empresa_cnpj_key" ON "Empresa"("cnpj");

-- CreateIndex
CREATE INDEX "Usuario_empresaId_idx" ON "Usuario"("empresaId");

-- CreateIndex
CREATE UNIQUE INDEX "Usuario_empresaId_email_key" ON "Usuario"("empresaId", "email");

-- CreateIndex
CREATE INDEX "Categoria_empresaId_categoriaPaiId_idx" ON "Categoria"("empresaId", "categoriaPaiId");

-- CreateIndex
CREATE UNIQUE INDEX "Categoria_empresaId_id_key" ON "Categoria"("empresaId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Unidade_empresaId_codigo_key" ON "Unidade"("empresaId", "codigo");

-- CreateIndex
CREATE INDEX "Produto_empresaId_nome_idx" ON "Produto"("empresaId", "nome");

-- CreateIndex
CREATE INDEX "Produto_empresaId_codigoBarras_idx" ON "Produto"("empresaId", "codigoBarras");

-- CreateIndex
CREATE UNIQUE INDEX "Produto_empresaId_id_key" ON "Produto"("empresaId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Produto_empresaId_sku_key" ON "Produto"("empresaId", "sku");

-- CreateIndex
CREATE UNIQUE INDEX "SaldoEstoque_produtoId_key" ON "SaldoEstoque"("produtoId");

-- CreateIndex
CREATE INDEX "SaldoEstoque_empresaId_idx" ON "SaldoEstoque"("empresaId");

-- CreateIndex
CREATE INDEX "MovimentacaoEstoque_empresaId_produtoId_criadoEm_idx" ON "MovimentacaoEstoque"("empresaId", "produtoId", "criadoEm");

-- AddForeignKey
ALTER TABLE "Usuario" ADD CONSTRAINT "Usuario_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Categoria" ADD CONSTRAINT "Categoria_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Categoria" ADD CONSTRAINT "Categoria_categoriaPaiId_fkey" FOREIGN KEY ("categoriaPaiId") REFERENCES "Categoria"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Unidade" ADD CONSTRAINT "Unidade_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Produto" ADD CONSTRAINT "Produto_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaldoEstoque" ADD CONSTRAINT "SaldoEstoque_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaldoEstoque" ADD CONSTRAINT "SaldoEstoque_produtoId_fkey" FOREIGN KEY ("produtoId") REFERENCES "Produto"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MovimentacaoEstoque" ADD CONSTRAINT "MovimentacaoEstoque_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MovimentacaoEstoque" ADD CONSTRAINT "MovimentacaoEstoque_produtoId_fkey" FOREIGN KEY ("produtoId") REFERENCES "Produto"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
