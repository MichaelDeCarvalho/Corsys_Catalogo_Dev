// Production receipts require HTTPS. Local HTTP is limited to the configured
// loopback Supabase Storage origin and only enabled in Vite development builds.
export function isAllowedOrderDocumentUrl(value: unknown, development = false, supabaseUrl?: string): value is string {
  if (typeof value !== 'string' || value.length > 2048) return false;
  try {
    const document = new URL(value);
    if (document.username || document.password) return false;
    if (document.protocol === 'https:') return true;
    if (!development || !supabaseUrl) return false;
    const api = new URL(supabaseUrl);
    return api.protocol === 'http:' && api.hostname === '127.0.0.1'
      && document.origin === api.origin
      && document.pathname.startsWith('/storage/v1/object/sign/order-documents/');
  } catch { return false; }
}
