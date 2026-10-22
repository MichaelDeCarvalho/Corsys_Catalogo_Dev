/**
 * Configuração centralizada de multi-tenancy público para o storefront.
 * 
 * Permite configurar o tenant via variável de ambiente (VITE_PUBLIC_TENANT_SLUG),
 * mantendo 'corsys-catalogo-demo' como valor padrão auditado.
 */
export const PUBLIC_TENANT_SLUG = 
  (typeof import.meta !== 'undefined' && import.meta.env?.VITE_PUBLIC_TENANT_SLUG) ||
  (typeof process !== 'undefined' && process.env?.VITE_PUBLIC_TENANT_SLUG) ||
  'corsys-catalogo-demo';
