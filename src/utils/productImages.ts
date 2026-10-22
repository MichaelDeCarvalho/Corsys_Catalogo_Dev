/**
 * Utilitário central de tratamento de imagens de produtos.
 * 
 * DIRETRIZES DE INTEGRIDADE (ETAPA 2.5):
 * - Imagens devem representar estritamente o produto comercializado real.
 * - É terminantemente proibido o uso de fotos genéricas de bancos de imagens (Unsplash, etc.),
 *   fotos de categorias aproximadas ou imagens inventadas/geradas por IA como substitutos.
 * - Para produtos cujas imagens originais estejam temporariamente inacessíveis
 *   (ex: bucket Supabase V1 pausado), a interface apresenta exclusivamente um
 *   PLACEHOLDER NEUTRO ("Imagem não disponível"), preservando a referência original
 *   intacta nos dados para a futura migração para o Supabase Storage V2.
 * - Falhas de carregamento em runtime NUNCA alteram ou sobrescrevem o registro original do produto.
 */
import type React from 'react';

/**
 * Placeholder neutro em SVG Data URI.
 * Comunica visualmente com sobriedade a ausência ou indisponibilidade da foto oficial,
 * sem qualquer semelhança com uma fotografia de produto.
 */
export const NEUTRAL_PRODUCT_PLACEHOLDER = `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400" fill="none"><rect width="400" height="400" fill="%23F8FAFC"/><rect x="40" y="40" width="320" height="320" rx="16" fill="%23FFFFFF" stroke="%23E2E8F0" stroke-width="2"/><circle cx="200" cy="170" r="36" fill="%23F1F5F9" stroke="%23CBD5E1" stroke-width="2"/><path d="M188 170h24M200 158v24" stroke="%2394A3B8" stroke-width="2" stroke-linecap="round"/><path d="M120 250l50-40 40 30 50-45 40 35H120z" fill="%23E2E8F0" stroke="%23CBD5E1" stroke-width="1.5"/><text x="200" y="300" text-anchor="middle" fill="%2364748B" font-family="system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="14" font-weight="600" letter-spacing="-0.01em">Imagem não disponível</text><text x="200" y="320" text-anchor="middle" fill="%2394A3B8" font-family="system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="11" font-weight="400">Sem foto cadastrada</text></svg>`;

/**
 * Domínio do Supabase V1 legado (atualmente pausado/inativo).
 * Mantido como referência para preservar os caminhos oficiais até a migração V2.
 */
export const LEGACY_SUPABASE_V1_HOST = 'oysznehftuovxchrfmfx.supabase.co';

/**
 * Verifica se a URL aponta para o storage antigo inativo.
 */
export function isLegacyV1Url(url?: string | null): boolean {
  if (!url) return false;
  return url.includes(LEGACY_SUPABASE_V1_HOST);
}

/**
 * Retorna a URL de exibição para a interface:
 * - Se a URL estiver ausente, vazia ou for do storage V1 pausado, retorna o placeholder neutro.
 * - Se for uma URL válida (ex: após upload no Storage V2 ou externa oficial), utiliza a URL real.
 * - Sob nenhuma circunstância injeta fotografias genéricas ou falsas.
 */
export function getSafeProductImage(imgUrl?: string | null, _category?: string): string {
  if (!imgUrl || typeof imgUrl !== 'string' || imgUrl.trim() === '') {
    return NEUTRAL_PRODUCT_PLACEHOLDER;
  }

  // O storage V1 da Supabase encontra-se pausado/inacessível.
  // Preservamos o link no banco, mas para a UI exibimos o placeholder neutro diretamente,
  // evitando falhas de rede lentas (timeout/DNS lookup falho) no navegador do usuário.
  if (isLegacyV1Url(imgUrl)) {
    return NEUTRAL_PRODUCT_PLACEHOLDER;
  }

  // Remove referências residuais de bancos de fotos aleatórios (ex: unsplash)
  if (imgUrl.includes('unsplash.com')) {
    return NEUTRAL_PRODUCT_PLACEHOLDER;
  }

  return imgUrl;
}

/**
 * Handler para o evento onError das tags <img>.
 * Se uma imagem real falhar no carregamento de rede (ex: 404, CORS, offline),
 * a interface substitui visualmente o elemento pelo placeholder neutro.
 * 
 * IMPORTANTE:
 * Este fallback é puramente de exibição em DOM e NÃO sobrescreve nem altera
 * os dados originais do produto na memória ou no banco.
 */
export function handleProductImageError(
  event: React.SyntheticEvent<HTMLImageElement, Event>,
  _category?: string
): void {
  const imgElement = event.currentTarget;
  if (!imgElement.dataset.fallbackApplied) {
    imgElement.dataset.fallbackApplied = 'true';
    imgElement.src = NEUTRAL_PRODUCT_PLACEHOLDER;
  }
}

