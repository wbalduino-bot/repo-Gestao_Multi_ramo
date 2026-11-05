"use client";

/**
 * Menu lateral compartilhado do Gestão Comercial Multi-Ramo.
 *
 * Centraliza a navegação, a identificação da empresa e o botão de saída,
 * evitando que Dashboard, Produtos e Vendas mantenham menus diferentes.
 * A proteção das páginas continua sendo responsabilidade de cada tela.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BotaoSair } from "./botao-sair";
import styles from "./menu-lateral.module.css";

type MenuLateralProps = {
  /** Nome obtido da sessão já carregada pela página atual. */
  nomeEmpresa?: string;
};

type ItemMenu = {
  rotulo: string;
  icone: string;
  href?: string;
};

// Os módulos futuros permanecem visíveis, mas não são apresentados como links.
const itensPrincipais: ItemMenu[] = [
  { rotulo: "Visão geral", icone: "▦", href: "/dashboard" },
  { rotulo: "Produtos e estoque", icone: "▤", href: "/produtos" },
  { rotulo: "Vendas", icone: "↗", href: "/vendas" },
  { rotulo: "Caixa", icone: "▣" },
  { rotulo: "Clientes", icone: "♧" },
];

const itensGestao: ItemMenu[] = [
  { rotulo: "Relatórios", icone: "▥" },
  { rotulo: "Usuários", icone: "♙", href: "/usuarios" },
  { rotulo: "Categorias e unidades", icone: "▤", href: "/cadastros-produtos" },
  { rotulo: "Auditoria", icone: "▧", href: "/auditoria" },
  { rotulo: "Configurações", icone: "⚙" },
];

export function MenuLateral({
  nomeEmpresa = "Empresa autenticada",
}: MenuLateralProps) {
  const pathname = usePathname();
  const [podeGerenciarUsuarios, setPodeGerenciarUsuarios] = useState(false);

  /**
   * O link de gestão só aparece após validar o perfil no backend.
   * A API continua sendo responsável por impedir acessos indevidos.
   */
  useEffect(() => {
    let ativo = true;
    const token = sessionStorage.getItem("gestao.accessToken");
    if (!token) {
      setPodeGerenciarUsuarios(false);
      return;
    }

    const apiUrl = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5433").replace(/\/$/, "");
    fetch(`${apiUrl}/usuarios/me`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    })
      .then(async (resposta) => {
        if (!resposta.ok) return null;
        return resposta.json() as Promise<{ perfil?: string }>;
      })
      .then((usuario) => {
        if (!ativo) return;
        setPodeGerenciarUsuarios(
          usuario?.perfil === "ADMINISTRADOR" || usuario?.perfil === "GERENTE",
        );
      })
      .catch(() => {
        if (ativo) setPodeGerenciarUsuarios(false);
      });

    return () => { ativo = false; };
  }, [pathname]);

  const empresa = nomeEmpresa.trim() || "Empresa autenticada";
  const inicialEmpresa = empresa.charAt(0).toUpperCase() || "G";

  /**
   * Renderiza os links ativos e os módulos futuros de forma consistente.
   * A rota é comparada com o caminho atual fornecido pelo Next.js.
   */
  function renderizarItem(item: ItemMenu) {
    if (item.href) {
      const ativo = pathname === item.href;

      return (
        <Link
          key={item.rotulo}
          href={item.href}
          className={`${styles.itemMenu} ${
            ativo ? styles.itemAtivo : ""
          }`}
          aria-current={ativo ? "page" : undefined}
        >
          <span className={styles.iconeItem} aria-hidden="true">
            {item.icone}
          </span>
          <span className={styles.textoItem}>{item.rotulo}</span>
        </Link>
      );
    }

    return (
      <span
        key={item.rotulo}
        className={`${styles.itemMenu} ${styles.itemDesabilitado}`}
        aria-disabled="true"
      >
        <span className={styles.iconeItem} aria-hidden="true">
          {item.icone}
        </span>
        <span className={styles.textoItem}>{item.rotulo}</span>
        <small className={styles.emBreve}>Em breve</small>
      </span>
    );
  }

  return (
    <aside className={styles.menuLateral} aria-label="Navegação lateral">
      <Link href="/dashboard" className={styles.marca}>
        <span className={styles.iconeMarca} aria-hidden="true">
          GC
        </span>

        <span className={styles.textoMarca}>
          <strong>GESTÃO</strong>
          <span>COMERCIAL</span>
        </span>
      </Link>

      <div className={styles.empresa}>
        <span className={styles.iconeEmpresa} aria-hidden="true">
          {inicialEmpresa}
        </span>

        <span className={styles.dadosEmpresa}>
          <strong title={empresa}>{empresa}</strong>
          <small>Empresa autenticada</small>
        </span>
      </div>

      <nav className={styles.navegacao} aria-label="Menu principal">
        <span className={styles.tituloSecao}>PRINCIPAL</span>

        {itensPrincipais.map(renderizarItem)}

        <span className={styles.tituloSecao}>GESTÃO</span>

        {itensGestao
          .filter((item) => !["/usuarios", "/auditoria", "/cadastros-produtos"].includes(item.href ?? "") || podeGerenciarUsuarios)
          .map(renderizarItem)}
      </nav>

      <footer className={styles.rodape}>
        <div className={styles.ambiente}>
          <span className={styles.pontoOnline} aria-hidden="true" />
          <span>Ambiente de desenvolvimento</span>
        </div>

        {/* Reutiliza o encerramento de sessão já existente. */}
        <BotaoSair className={styles.botaoSair}>
          Sair da conta ↗
        </BotaoSair>
      </footer>
    </aside>
  );
}
