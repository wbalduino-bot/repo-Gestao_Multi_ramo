
import { Module } from '@nestjs/common';
import { createObserveModule } from '@nestjs/observe';

import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { EmpresasModule } from './empresas/empresas.module.js';
import { AuthModule } from './auth/auth.module.js';
import { AdminPlataformaModule } from './admin-plataforma/admin-plataforma.module.js';
import { UsuariosModule } from './usuarios/usuarios.module.js';
import { ProdutosModule } from './produtos/produtos.module.js';
import { VendasModule } from './vendas/vendas.module.js';

// Inicializa a integração de observabilidade da aplicação.
// Disponibiliza o módulo e o instrumento de observação para uso no projeto.
export const { ObserveModule, ObserveInstrument } = createObserveModule();

@Module({
  imports: [
    // Observabilidade:
    // disponibiliza recursos de rastreamento, métricas e monitoramento.
    // As credenciais são lidas das variáveis de ambiente, quando configuradas.
    ObserveModule.forRoot({
      appKey: process.env.OBSERVE_APP_KEY ?? 'YOUR_APP_KEY',
      appSecret: process.env.OBSERVE_APP_SECRET ?? 'YOUR_APP_SECRET',
      serviceId: 'apps-api',
    }),

    // Acesso ao banco de dados PostgreSQL por meio do Prisma.
    PrismaModule,

    // Gerenciamento das empresas cadastradas na plataforma.
    // A autorização exclusiva da plataforma será aplicada nas rotas
    // desse módulo em uma etapa específica de segurança.
    EmpresasModule,

    // Autenticação dos usuários vinculados às empresas.
    AuthModule,

    // Autenticação independente do administrador global da plataforma.
    // Esse módulo não substitui nem altera o login dos usuários das empresas.
    AdminPlataformaModule,

    // Operações e consultas relacionadas aos usuários das empresas.
    UsuariosModule,

    // Gerenciamento dos produtos de cada empresa.
    // Operações de produtos protegidas por autenticação JWT.
    ProdutosModule,
    
    // Registro das vendas, com validação de produtos e integração
    // transacional com o controle de estoque.
    VendasModule,
  ],

  // Controller e serviço principais da aplicação.
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
