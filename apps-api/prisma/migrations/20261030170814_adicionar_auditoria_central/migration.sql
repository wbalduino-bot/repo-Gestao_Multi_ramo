-- CreateEnum
CREATE TYPE "TipoAtorAuditoria" AS ENUM ('USUARIO_EMPRESA', 'ADMIN_PLATAFORMA', 'SISTEMA', 'ANONIMO');

-- CreateEnum
CREATE TYPE "ResultadoAuditoria" AS ENUM ('SUCESSO', 'FALHA', 'BLOQUEADO');

-- CreateTable
CREATE TABLE "EventoAuditoria" (
    "id" UUID NOT NULL,
    "empresaId" UUID,
    "atorId" UUID,
    "tipoAtor" "TipoAtorAuditoria" NOT NULL,
    "modulo" VARCHAR(80) NOT NULL,
    "acao" VARCHAR(100) NOT NULL,
    "entidade" VARCHAR(100),
    "entidadeId" VARCHAR(100),
    "identificadorTentativa" VARCHAR(255),
    "resultado" "ResultadoAuditoria" NOT NULL,
    "motivo" VARCHAR(500),
    "justificativa" VARCHAR(1000),
    "requestId" VARCHAR(100),
    "ipOrigem" VARCHAR(45),
    "userAgent" VARCHAR(500),
    "dadosAnteriores" JSONB,
    "dadosPosteriores" JSONB,
    "metadados" JSONB,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventoAuditoria_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EventoAuditoria_empresaId_criadoEm_idx" ON "EventoAuditoria"("empresaId", "criadoEm");

-- CreateIndex
CREATE INDEX "EventoAuditoria_atorId_criadoEm_idx" ON "EventoAuditoria"("atorId", "criadoEm");

-- CreateIndex
CREATE INDEX "EventoAuditoria_modulo_acao_criadoEm_idx" ON "EventoAuditoria"("modulo", "acao", "criadoEm");

-- CreateIndex
CREATE INDEX "EventoAuditoria_resultado_criadoEm_idx" ON "EventoAuditoria"("resultado", "criadoEm");

-- CreateIndex
CREATE INDEX "EventoAuditoria_requestId_idx" ON "EventoAuditoria"("requestId");

-- CreateIndex
CREATE INDEX "EventoAuditoria_tipoAtor_criadoEm_idx" ON "EventoAuditoria"("tipoAtor", "criadoEm");
