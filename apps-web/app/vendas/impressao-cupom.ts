/**
 * Impressão não fiscal isolada do layout do PDV.
 * O iframe contém SOMENTE o cupom da venda selecionada: nunca imprime a
 * página de vendas, histórico, outros pedidos, custos ou botões.
 */
export type LarguraCupom = 58 | 80;

export type ClassesCupom = Readonly<{
  cabecalho: string;
  marca: string;
  meta: string;
  linha: string;
  identificador: string;
  itens: string;
  item: string;
  pagamento: string;
  total: string;
  rodape: string;
}>;

/** Converte altura real do conteúdo em altura do papel, com folga para corte. */
export function alturaPapelMm(alturaPx: number): number {
  if (!Number.isFinite(alturaPx) || alturaPx < 0) {
    throw new Error("Altura de comprovante inválida.");
  }
  return Math.max(60, Math.ceil((alturaPx * 25.4) / 96) + 6);
}

/** Folha única, dentro dos limites do navegador/driver da impressora. */
export function cssCupomIsolado(larguraMm: LarguraCupom, c: ClassesCupom): string {
  if (larguraMm !== 58 && larguraMm !== 80) {
    throw new Error("Largura de papel não suportada.");
  }
  const seletor = (nome: string) => `[class~="${nome}"]`;
  const tamanhoTexto = larguraMm === 58 ? "9px" : "10px";
  return `
    *, *::before, *::after { box-sizing: border-box !important; }
    html, body { width: ${larguraMm}mm !important; margin: 0 !important; padding: 0 !important;
      background: #fff !important; color: #000 !important; overflow: visible !important; }
    #cupom-impressao { display: block !important; position: static !important;
      width: ${larguraMm}mm !important; max-width: none !important; min-width: 0 !important;
      margin: 0 !important; padding: 3mm 2mm 4mm !important;
      border: 0 !important; border-radius: 0 !important; box-shadow: none !important;
      background: #fff !important; color: #000 !important;
      font: ${tamanhoTexto}/1.35 Arial, Helvetica, sans-serif !important;
      overflow: visible !important; overflow-wrap: anywhere !important; }
    #cupom-impressao * { color: #000 !important; background: transparent !important;
      max-width: 100% !important; overflow-wrap: anywhere !important;
      box-shadow: none !important; text-shadow: none !important; }
    #cupom-impressao strong { font-weight: 700 !important; }
    #cupom-impressao small { display: block; font-size: 8px; line-height: 1.35; }
    ${seletor(c.cabecalho)} { display: block !important; text-align: center !important;
      padding: 0 0 3mm !important; margin: 0 0 3mm !important; border-bottom: 1px dashed #444 !important; }
    ${seletor(c.cabecalho)} > * { display: block !important; margin: 1mm 0 !important; }
    ${seletor(c.cabecalho)} h4 { font-size: 12px !important; font-weight: 700 !important; }
    ${seletor(c.marca)} { font-size: 14px !important; font-weight: 700 !important; }
    ${seletor(c.meta)} { margin: 0 0 3mm !important; padding: 0 0 3mm !important;
      border-bottom: 1px dashed #777 !important; }
    ${seletor(c.identificador)} { font-size: 7px !important; margin-top: 2mm !important; }
    ${seletor(c.linha)} { display: flex !important; justify-content: space-between !important;
      align-items: flex-start !important; gap: 2mm !important; margin: 1mm 0 !important;
      width: 100% !important; }
    ${seletor(c.linha)} > :first-child { flex: 1 1 auto !important; min-width: 0 !important; }
    ${seletor(c.linha)} > :last-child { flex: 0 1 auto !important; max-width: 52% !important;
      text-align: right !important; }
    ${seletor(c.itens)} { display: block !important; margin: 0 0 3mm !important; }
    ${seletor(c.itens)} h5 { font-size: 9px !important; margin: 0 0 2mm !important; }
    ${seletor(c.item)} { display: block !important; margin: 0 !important; padding: 2mm 0 !important;
      border-bottom: 1px dotted #aaa !important; break-inside: avoid !important; }
    ${seletor(c.item)} > strong { display: block !important; margin-bottom: 1mm !important; }
    ${seletor(c.pagamento)} { display: block !important; padding: 2mm 0 !important;
      margin: 0 0 2mm !important; border-bottom: 1px dashed #777 !important; }
    ${seletor(c.total)} { display: flex !important; align-items: baseline !important;
      justify-content: space-between !important; gap: 2mm !important;
      font-weight: 700 !important; border-top: 1px solid #111 !important;
      margin: 2mm 0 !important; padding: 2mm 0 !important; }
    ${seletor(c.total)} > :first-child { max-width: 60% !important; }
    ${seletor(c.total)} > strong { font-size: 13px !important; text-align: right !important; }
    ${seletor(c.rodape)} { display: block !important; text-align: center !important;
      border-top: 1px dashed #777 !important; margin: 3mm 0 0 !important; padding: 3mm 0 0 !important; }
    ${seletor(c.rodape)} > * { display: block !important; margin: 1mm 0 !important; }
    @media print { html, body { print-color-adjust: exact; } }
  `;
}

export function imprimirCupomIsolado(
  elementoCupom: HTMLElement,
  larguraMm: LarguraCupom,
  classes: ClassesCupom,
): void {
  // Nunca chamar window.print() no documento principal do PDV.
  if (elementoCupom.id !== "cupom-impressao") {
    throw new Error("Selecione um comprovante de venda válido.");
  }

  const frame = document.createElement("iframe");
  frame.title = "Impressão isolada do comprovante não fiscal";
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText = `position: fixed; left: -10000px; top: 0; width: ${larguraMm}mm; height: 1px; border: 0;`;
  document.body.appendChild(frame);

  const janela = frame.contentWindow;
  const pagina = frame.contentDocument;
  if (!janela || !pagina) {
    frame.remove();
    throw new Error("Não foi possível preparar a impressão do cupom.");
  }

  let removido = false;
  const remover = () => {
    if (removido) return;
    removido = true;
    frame.remove();
  };
  pagina.open();
  pagina.write('<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Comprovante não fiscal</title></head><body></body></html>');
  pagina.close();

  const estilo = pagina.createElement("style");
  estilo.textContent = cssCupomIsolado(larguraMm, classes);
  pagina.head.appendChild(estilo);

  // A cópia contém SOMENTE o comprovante visível da venda selecionada.
  // importNode não interpreta dados de produtos como HTML não confiável.
  const copia = pagina.importNode(elementoCupom, true) as HTMLElement;
  pagina.body.appendChild(copia);

  // Abertura do documento redefine eventos; escutar após montar o iframe.
  janela.addEventListener("afterprint", remover, { once: true });
  // Fallback para navegadores que não disparam afterprint em iframes.
  window.setTimeout(remover, 300_000);

  // Medir depois de aplicar o CSS isolado: o tamanho varia com nomes e itens.
  const alturaPx = Math.ceil(copia.getBoundingClientRect().height);
  const alturaMm = alturaPapelMm(alturaPx);
  const papel = pagina.createElement("style");
  papel.textContent = `@page { size: ${larguraMm}mm ${alturaMm}mm; margin: 0; }`;
  pagina.head.appendChild(papel);
  frame.style.height = `${Math.ceil(alturaPx) + 24}px`;

  // Esperar duas atualizações de layout evita impressão em branco no Chrome.
  window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
    if (removido) return;
    try {
      janela.focus();
      janela.print();
    } catch (erro) {
      remover();
      throw erro;
    }
  }));
}
