
import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

// Carrega a fonte principal da aplicação.
const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

// Carrega a fonte monoespaçada, útil para trechos técnicos e código.
const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Define o título e a descrição exibidos nas abas e nos mecanismos de busca.
export const metadata: Metadata = {
  title: "Gestão Comercial | Acesso ao Sistema",
  description:
    "Plataforma de gestão comercial para acompanhar e organizar seu negócio.",
};

// Layout raiz compartilhado pelas páginas da aplicação.
export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // Define o idioma principal da interface.
    <html
      lang="pt-BR"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      {/* Importa os estilos globais e permite que o conteúdo ocupe a tela. */}
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
