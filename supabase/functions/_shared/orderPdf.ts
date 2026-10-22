/**
 * Helper Server-Side para Geração de PDF Profissional de Pedidos.
 * Executado exclusivamente na Supabase Edge Function (Deno Runtime).
 * 
 * Princípios de Engenharia:
 * - Biblioteca leve e nativa (pdf-lib com versão explicitamente fixada).
 * - Autoridade server-side: consome exclusivamente orderResult/snapshots oficiais.
 * - Suporte a paginação dinâmica de até 200 itens com cabeçalho repetido e numeração de páginas.
 * - Resiliente a falhas de download de logo (graceful degradation sem quebrar o pedido).
 * - Sem dependência global no frontend.
 */

// Import com versão fixada estável compatível com Deno e Supabase Edge Functions
import { PDFDocument, rgb, StandardFonts, PDFPage, PDFFont } from "npm:pdf-lib@1.17.1";

export interface OrderPdfItem {
  productId: string;
  productName: string;
  productSku: string;
  unit: string;
  unitPrice: number;
  quantity: number;
  totalPrice: number;
  selectedVariant?: string | null;
}

export interface OrderPdfCustomer {
  name?: string;
  phone?: string;
  email?: string;
  document?: string;
  companyName?: string;
  type?: "PF" | "PJ" | string;
}

export interface OrderPdfShippingAddress {
  street?: string;
  number?: string;
  complement?: string;
  neighborhood?: string;
  city?: string;
  state?: string;
  zipCode?: string;
}

export interface OrderPdfData {
  id: string;
  order_number: string;
  shopping_mode: "retail" | "wholesale";
  status: string;
  payment_method: string;
  delivery_method: string;
  subtotal: number;
  discount: number;
  shipping_fee: number;
  total: number;
  created_at: string;
  customer: OrderPdfCustomer;
  shipping_address: OrderPdfShippingAddress;
  items: OrderPdfItem[];
  notes?: string | null;
  seller_code?: string | null;
}

export interface TenantBrandingSettings {
  public_name?: string | null;
  logo_url?: string | null;
  primary_color?: string | null;
  accent_color?: string | null;
}

/**
 * Normaliza e sanitiza texto para a codificação padrão WinAnsi/Latin-1 do pdf-lib.
 * Converte caracteres tipográficos especiais (como travessão e aspas curvas) para seus equivalentes ASCII.
 */
function sanitizePdfText(text: unknown): string {
  if (text === null || text === undefined) return "";
  const str = String(text);
  return str
    .replace(/[\u2014\u2013]/g, "-") // em-dash e en-dash
    .replace(/[\u2018\u2019]/g, "'") // aspas simples curvas
    .replace(/[\u201C\u201D]/g, '"') // aspas duplas curvas
    .replace(/[\u2022]/g, "*")       // bullet
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, ""); // mantém apenas ASCII e Latin-1
}

/**
 * Formata CPF ou CNPJ brasileiro para exibição legível no PDF.
 */
function formatDocumentForDisplay(doc: unknown, type?: string): string {
  if (!doc || typeof doc !== "string") return "Não informado";
  const clean = doc.replace(/\D/g, "");
  if (clean.length === 11) {
    return clean.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
  }
  if (clean.length === 14) {
    return clean.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
  }
  return clean || "Não informado";
}

/**
 * Formata valores numéricos para padrão monetário BRL (R$ 0,00).
 */
function formatCurrency(val: number): string {
  const safe = Number.isFinite(val) ? val : 0;
  return `R$ ${safe.toFixed(2).replace(".", ",")}`;
}

/**
 * Converte cor hex (#RRGGBB) para valores rgb do pdf-lib.
 */
function parseHexColor(hex?: string | null, fallback = rgb(0.06, 0.09, 0.16)) {
  if (!hex || typeof hex !== "string" || !/^#([0-9a-f]{6})$/i.test(hex.trim())) {
    return fallback;
  }
  const clean = hex.trim().replace("#", "");
  const r = parseInt(clean.substring(0, 2), 16) / 255;
  const g = parseInt(clean.substring(2, 4), 16) / 255;
  const b = parseInt(clean.substring(4, 6), 16) / 255;
  return rgb(r, g, b);
}

/**
 * Gera o documento PDF oficial server-side em conformidade com as diretrizes do Checkout V1.2.
 */
export async function generateOrderPdf(
  order: OrderPdfData,
  branding?: TenantBrandingSettings | null
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();

  // Fontes padrão Helvetica do PDF
  const fontRegular = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const fontMono = await doc.embedFont(StandardFonts.Courier);

  // Paleta visual profissional e sóbria
  const primaryColor = parseHexColor(branding?.primary_color, rgb(0.06, 0.09, 0.16)); // slate-900 padrão
  const textColor = rgb(0.12, 0.16, 0.23); // slate-800
  const mutedColor = rgb(0.39, 0.45, 0.55); // slate-500
  const borderColor = rgb(0.88, 0.91, 0.94); // slate-200
  const lightBgColor = rgb(0.97, 0.98, 0.99); // slate-50

  // Tentativa resiliente de carregar o logo da loja (timeout curto e limite de 2MB)
  let logoImage: any = null;
  if (branding?.logo_url && branding.logo_url.startsWith("https://")) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3500);
      const res = await fetch(branding.logo_url, { signal: controller.signal });
      clearTimeout(timeoutId);

      if (res.ok) {
        const logoBytes = new Uint8Array(await res.arrayBuffer());
        if (logoBytes.byteLength <= 2 * 1024 * 1024) {
          // Detecta formato por magic bytes
          if (logoBytes[0] === 0x89 && logoBytes[1] === 0x50) {
            logoImage = await doc.embedPng(logoBytes);
          } else if (logoBytes[0] === 0xff && logoBytes[1] === 0xd8) {
            logoImage = await doc.embedJpg(logoBytes);
          }
        }
      }
    } catch {
      // Falha de logo NUNCA aborta a geração do PDF
      logoImage = null;
    }
  }

  // Constantes de layout da página (A4: 595.28 x 841.89 pt)
  const pageWidth = 595.28;
  const pageHeight = 841.89;
  const margin = 36;
  const contentWidth = pageWidth - margin * 2; // 523.28 pt

  const pages: PDFPage[] = [];

  function addNewPage(): { page: PDFPage; startY: number } {
    const page = doc.addPage([pageWidth, pageHeight]);
    pages.push(page);
    return { page, startY: pageHeight - margin };
  }

  let { page: currentPage, startY: y } = addNewPage();

  // =========================================================================
  // 1. CABEÇALHO DO DOCUMENTO
  // =========================================================================
  const storeName = sanitizePdfText(branding?.public_name || "Corsys.Catálogo");
  const orderNumber = sanitizePdfText(order.order_number);
  const formattedDate = new Date(order.created_at || Date.now()).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  // Linha superior: Logo ou Nome da Loja
  if (logoImage) {
    try {
      const logoDims = logoImage.scaleToFit(140, 40);
      currentPage.drawImage(logoImage, {
        x: margin,
        y: y - logoDims.height,
        width: logoDims.width,
        height: logoDims.height,
      });
    } catch {
      // Fallback para texto caso scaleToFit falhe
      currentPage.drawText(storeName, {
        x: margin,
        y: y - 16,
        size: 16,
        font: fontBold,
        color: primaryColor,
      });
    }
  } else {
    currentPage.drawText(storeName, {
      x: margin,
      y: y - 16,
      size: 16,
      font: fontBold,
      color: primaryColor,
    });
  }

  // Título e Identificação do Pedido à Direita
  currentPage.drawText("ORÇAMENTO / PEDIDO PARA ANÁLISE", {
    x: pageWidth - margin - 230,
    y: y - 10,
    size: 11,
    font: fontBold,
    color: primaryColor,
  });

  currentPage.drawText(`Pedido: #${orderNumber}`, {
    x: pageWidth - margin - 230,
    y: y - 24,
    size: 11,
    font: fontMono,
    color: primaryColor,
  });

  currentPage.drawText(`Data: ${sanitizePdfText(formattedDate)}`, {
    x: pageWidth - margin - 230,
    y: y - 36,
    size: 8.5,
    font: fontRegular,
    color: mutedColor,
  });

  y -= 52;

  // Linha divisória do cabeçalho
  currentPage.drawLine({
    start: { x: margin, y },
    end: { x: pageWidth - margin, y },
    thickness: 1,
    color: borderColor,
  });

  y -= 14;

  // Status Badge
  currentPage.drawRectangle({
    x: margin,
    y: y - 16,
    width: contentWidth,
    height: 20,
    color: lightBgColor,
    borderColor: borderColor,
    borderWidth: 1,
  });

  currentPage.drawText("STATUS: AGUARDANDO CONFIRMAÇÃO DA LOJA (Pagamento ainda não realizado)", {
    x: margin + 10,
    y: y - 12,
    size: 8.5,
    font: fontBold,
    color: rgb(0.75, 0.45, 0.05), // tom ambar elegante
  });

  y -= 30;

  // =========================================================================
  // 2. DADOS DO CLIENTE & ENTREGA (2 COLUNAS)
  // =========================================================================
  const colWidth = (contentWidth - 16) / 2;
  const col2X = margin + colWidth + 16;
  const clientBoxY = y;

  // Coluna 1: Dados do Comprador
  currentPage.drawText("DADOS DO COMPRADOR", {
    x: margin,
    y: clientBoxY,
    size: 9,
    font: fontBold,
    color: primaryColor,
  });

  let clientY = clientBoxY - 14;
  const isWholesale = order.shopping_mode === "wholesale";
  const customerName = sanitizePdfText(order.customer.name || (isWholesale ? "Cliente Atacadista" : "Cliente"));
  const docFormatted = sanitizePdfText(formatDocumentForDisplay(order.customer.document, order.customer.type));
  const docLabel = order.customer.type === "PJ" || isWholesale ? "CNPJ" : "CPF";

  currentPage.drawText(`Nome/Razão: ${customerName}`, { x: margin, y: clientY, size: 8, font: fontRegular, color: textColor });
  clientY -= 11;

  if (order.customer.companyName && !isWholesale) {
    currentPage.drawText(`Empresa: ${sanitizePdfText(order.customer.companyName)}`, { x: margin, y: clientY, size: 8, font: fontRegular, color: textColor });
    clientY -= 11;
  }

  currentPage.drawText(`${docLabel}: ${docFormatted}`, { x: margin, y: clientY, size: 8, font: fontRegular, color: textColor });
  clientY -= 11;

  if (order.customer.phone) {
    currentPage.drawText(`Telefone/WhatsApp: ${sanitizePdfText(order.customer.phone)}`, { x: margin, y: clientY, size: 8, font: fontRegular, color: textColor });
    clientY -= 11;
  }

  if (order.customer.email) {
    currentPage.drawText(`E-mail: ${sanitizePdfText(order.customer.email)}`, { x: margin, y: clientY, size: 8, font: fontRegular, color: textColor });
    clientY -= 11;
  }

  // Coluna 2: Dados de Entrega
  currentPage.drawText("ENTREGA & LOGÍSTICA", {
    x: col2X,
    y: clientBoxY,
    size: 9,
    font: fontBold,
    color: primaryColor,
  });

  let shipY = clientBoxY - 14;
  const streetLine = [
    order.shipping_address.street,
    order.shipping_address.number ? `Nº ${order.shipping_address.number}` : "",
    order.shipping_address.complement ? `(${order.shipping_address.complement})` : "",
  ].filter(Boolean).join(", ");

  const cityLine = [
    order.shipping_address.neighborhood,
    order.shipping_address.city && order.shipping_address.state ? `${order.shipping_address.city}/${order.shipping_address.state}` : order.shipping_address.city,
    order.shipping_address.zipCode ? `CEP ${order.shipping_address.zipCode}` : "",
  ].filter(Boolean).join(" - ");

  currentPage.drawText(`Método: ${sanitizePdfText(order.delivery_method)}`, { x: col2X, y: shipY, size: 8, font: fontBold, color: textColor });
  shipY -= 11;

  if (streetLine) {
    currentPage.drawText(`Endereço: ${sanitizePdfText(streetLine)}`, { x: col2X, y: shipY, size: 8, font: fontRegular, color: textColor });
    shipY -= 11;
  }

  if (cityLine) {
    currentPage.drawText(sanitizePdfText(cityLine), { x: col2X, y: shipY, size: 8, font: fontRegular, color: textColor });
    shipY -= 11;
  }

  if (order.seller_code) {
    currentPage.drawText(`Código Vendedor: ${sanitizePdfText(order.seller_code)}`, { x: col2X, y: shipY, size: 8, font: fontRegular, color: textColor });
    shipY -= 11;
  }

  y = Math.min(clientY, shipY) - 16;

  // =========================================================================
  // 3. TABELA DE ITENS COM PAGINAÇÃO DINÂMICA
  // =========================================================================
  function drawTableHeader(targetPage: PDFPage, targetY: number): number {
    targetPage.drawRectangle({
      x: margin,
      y: targetY - 16,
      width: contentWidth,
      height: 18,
      color: lightBgColor,
      borderColor: borderColor,
      borderWidth: 1,
    });

    targetPage.drawText("SKU", { x: margin + 6, y: targetY - 12, size: 7.5, font: fontBold, color: primaryColor });
    targetPage.drawText("PRODUTO / VARIANTE", { x: margin + 70, y: targetY - 12, size: 7.5, font: fontBold, color: primaryColor });
    targetPage.drawText("QTD", { x: margin + 340, y: targetY - 12, size: 7.5, font: fontBold, color: primaryColor });
    targetPage.drawText("UN", { x: margin + 375, y: targetY - 12, size: 7.5, font: fontBold, color: primaryColor });
    targetPage.drawText("UNITÁRIO", { x: margin + 410, y: targetY - 12, size: 7.5, font: fontBold, color: primaryColor });
    targetPage.drawText("TOTAL", { x: margin + 475, y: targetY - 12, size: 7.5, font: fontBold, color: primaryColor });

    return targetY - 24;
  }

  y = drawTableHeader(currentPage, y);

  const items = Array.isArray(order.items) ? order.items : [];
  for (let idx = 0; idx < items.length; idx++) {
    const item = items[idx];
    const hasVariant = Boolean(item.selectedVariant && item.selectedVariant.trim());
    const rowHeight = hasVariant ? 22 : 16;

    // Se a linha estourar a margem inferior (deixando espaço para o resumo/rodapé), cria nova página
    if (y - rowHeight < margin + 110) {
      const newPageInfo = addNewPage();
      currentPage = newPageInfo.page;
      y = newPageInfo.startY - 20;

      // Cabeçalho da tabela repetido na página seguinte
      currentPage.drawText(`Continuação do Pedido #${orderNumber}`, {
        x: margin,
        y: y,
        size: 8,
        font: fontBold,
        color: mutedColor,
      });
      y -= 12;
      y = drawTableHeader(currentPage, y);
    }

    // Linha zebra opcional
    if (idx % 2 === 1) {
      currentPage.drawRectangle({
        x: margin,
        y: y - (hasVariant ? 17 : 11),
        width: contentWidth,
        height: rowHeight,
        color: rgb(0.985, 0.988, 0.992),
      });
    }

    // SKU
    currentPage.drawText(sanitizePdfText(item.productSku || "-"), {
      x: margin + 6,
      y: y - 8,
      size: 7.5,
      font: fontMono,
      color: textColor,
    });

    // Nome do Produto (truncado se muito longo)
    const rawProdName = sanitizePdfText(item.productName || "Produto");
    const safeProdName = rawProdName.length > 50 ? `${rawProdName.substring(0, 48)}...` : rawProdName;
    currentPage.drawText(safeProdName, {
      x: margin + 70,
      y: y - 8,
      size: 7.5,
      font: fontRegular,
      color: textColor,
    });

    // Variante se houver
    if (hasVariant) {
      const varText = `Variante: ${sanitizePdfText(item.selectedVariant)}`;
      currentPage.drawText(varText.length > 55 ? `${varText.substring(0, 53)}...` : varText, {
        x: margin + 70,
        y: y - 17,
        size: 6.5,
        font: fontRegular,
        color: mutedColor,
      });
    }

    // Quantidade
    currentPage.drawText(String(item.quantity || 1), {
      x: margin + 342,
      y: y - 8,
      size: 7.5,
      font: fontBold,
      color: textColor,
    });

    // Unidade
    currentPage.drawText(sanitizePdfText(item.unit || "un"), {
      x: margin + 377,
      y: y - 8,
      size: 7.5,
      font: fontRegular,
      color: textColor,
    });

    // Preço Unitário
    currentPage.drawText(sanitizePdfText(formatCurrency(item.unitPrice)), {
      x: margin + 410,
      y: y - 8,
      size: 7.5,
      font: fontRegular,
      color: textColor,
    });

    // Preço Total
    currentPage.drawText(sanitizePdfText(formatCurrency(item.totalPrice)), {
      x: margin + 475,
      y: y - 8,
      size: 7.5,
      font: fontBold,
      color: textColor,
    });

    y -= rowHeight;
  }

  // =========================================================================
  // 4. RESUMO FINANCEIRO & FORMA DE PAGAMENTO
  // =========================================================================
  // Se não houver espaço suficiente para o fechamento, cria nova página
  if (y < margin + 140) {
    const newPageInfo = addNewPage();
    currentPage = newPageInfo.page;
    y = newPageInfo.startY - 30;
  } else {
    y -= 10;
  }

  // Linha divisória antes do fechamento financeiro
  currentPage.drawLine({
    start: { x: margin, y },
    end: { x: pageWidth - margin, y },
    thickness: 1,
    color: borderColor,
  });

  y -= 14;

  const summaryColX = margin + contentWidth - 210;

  // Box Financeiro
  currentPage.drawText("Subtotal dos Produtos:", { x: summaryColX, y, size: 8, font: fontRegular, color: textColor });
  currentPage.drawText(sanitizePdfText(formatCurrency(order.subtotal)), { x: summaryColX + 130, y, size: 8, font: fontRegular, color: textColor });
  y -= 11;

  if (order.discount > 0) {
    currentPage.drawText("Desconto Aplicado:", { x: summaryColX, y, size: 8, font: fontRegular, color: rgb(0.1, 0.6, 0.2) });
    currentPage.drawText(`- ${sanitizePdfText(formatCurrency(order.discount))}`, { x: summaryColX + 130, y, size: 8, font: fontRegular, color: rgb(0.1, 0.6, 0.2) });
    y -= 11;
  }

  const shippingText = order.shipping_fee === 0 ? "A combinar / Loja" : formatCurrency(order.shipping_fee);
  currentPage.drawText("Frete Estimado:", { x: summaryColX, y, size: 8, font: fontRegular, color: textColor });
  currentPage.drawText(sanitizePdfText(shippingText), { x: summaryColX + 130, y, size: 8, font: fontRegular, color: textColor });
  y -= 14;

  currentPage.drawText("TOTAL VALIDADO:", { x: summaryColX, y, size: 10, font: fontBold, color: primaryColor });
  currentPage.drawText(sanitizePdfText(formatCurrency(order.total)), { x: summaryColX + 130, y, size: 10, font: fontBold, color: primaryColor });

  // Forma de Pagamento Pretendida (lado esquerdo)
  let paymentExplanation = "";
  const paymentMethodLower = (order.payment_method || "").toLowerCase();
  if (paymentMethodLower === "pix") {
    paymentExplanation = "PIX - Pagamento ainda não realizado. Aguarde as instruções ou link de pagamento enviados pela loja via WhatsApp.";
  } else if (paymentMethodLower === "boleto") {
    paymentExplanation = "Boleto bancário - Pagamento ainda não realizado. Aguarde o boleto ou link enviado pela loja via WhatsApp.";
  } else if (paymentMethodLower === "credit_card") {
    paymentExplanation = "Cartão de crédito - Pagamento ainda não realizado. Aguarde o link seguro de pagamento enviado pela loja.";
  } else {
    paymentExplanation = "Pagamento na entrega/retirada, sujeito à confirmação presencial da loja.";
  }

  const paymentBoxY = y + 25;
  currentPage.drawText("FORMA DE PAGAMENTO PRETENDIDA", {
    x: margin,
    y: paymentBoxY,
    size: 8,
    font: fontBold,
    color: primaryColor,
  });

  currentPage.drawText(sanitizePdfText(paymentExplanation), {
    x: margin,
    y: paymentBoxY - 11,
    size: 7,
    font: fontRegular,
    color: mutedColor,
    maxWidth: contentWidth - 230,
  });

  if (order.notes) {
    currentPage.drawText(`Observações: ${sanitizePdfText(order.notes)}`, {
      x: margin,
      y: paymentBoxY - 25,
      size: 7,
      font: fontRegular,
      color: textColor,
      maxWidth: contentWidth - 230,
    });
  }

  // =========================================================================
  // 5. RODAPÉ FIXO EM TODAS AS PÁGINAS (DISCLAIMER LEGAL & PAGINAÇÃO)
  // =========================================================================
  const totalPages = pages.length;
  pages.forEach((p, pageIdx) => {
    // Linha divisória de rodapé
    p.drawLine({
      start: { x: margin, y: margin + 18 },
      end: { x: pageWidth - margin, y: margin + 18 },
      thickness: 0.5,
      color: borderColor,
    });

    p.drawText(
      "Este documento registra uma solicitação de pedido. Não é comprovante de pagamento, nota fiscal ou confirmação de disponibilidade.",
      {
        x: margin,
        y: margin + 8,
        size: 6.5,
        font: fontRegular,
        color: mutedColor,
      }
    );

    const pageText = `Pedido #${orderNumber} | Página ${pageIdx + 1} de ${totalPages}`;
    p.drawText(sanitizePdfText(pageText), {
      x: pageWidth - margin - 140,
      y: margin + 8,
      size: 6.5,
      font: fontMono,
      color: mutedColor,
    });
  });

  return await doc.save();
}
