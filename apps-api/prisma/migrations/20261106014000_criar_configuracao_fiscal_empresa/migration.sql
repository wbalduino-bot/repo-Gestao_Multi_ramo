-- CreateTable
CREATE TABLE "ConfiguracaoFiscalEmpresa" (
    "id" UUID NOT NULL,
    "empresaId" UUID NOT NULL,
    "razaoSocial" VARCHAR(150),
    "nomeFantasia" VARCHAR(150),
    "inscricaoEstadual" VARCHAR(20),
    "codigoCRT" VARCHAR(2),
    "logradouro" VARCHAR(150),
    "numero" VARCHAR(20),
    "complemento" VARCHAR(100),
    "bairro" VARCHAR(100),
    "codigoMunicipio" VARCHAR(7),
    "nomeMunicipio" VARCHAR(100),
    "uf" VARCHAR(2),
    "cep" VARCHAR(8),
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConfiguracaoFiscalEmpresa_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ConfiguracaoFiscalEmpresa_empresaId_key" ON "ConfiguracaoFiscalEmpresa"("empresaId");

-- AddForeignKey
ALTER TABLE "ConfiguracaoFiscalEmpresa" ADD CONSTRAINT "ConfiguracaoFiscalEmpresa_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
