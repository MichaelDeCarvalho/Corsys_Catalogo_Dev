/** Cryptographic signing shared by quote issuance and checkout. Never use a known fallback. */
export function getDeliveryQuoteSecret(readEnv: (name: string) => string | undefined): string {
  const secret = readEnv("DELIVERY_QUOTE_HMAC_SECRET") ?? "";
  if (secret.length < 32) throw new Error("DELIVERY_QUOTE_HMAC_SECRET_NOT_CONFIGURED");
  return secret;
}

async function quoteKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

export async function signDeliveryQuote(payload: string, secret: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.sign("HMAC", await quoteKey(secret), new TextEncoder().encode(payload)));
  return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
}

export async function verifyDeliveryQuote(payload: string, hex: string, secret: string): Promise<boolean> {
  if (!/^[a-f0-9]{64}$/.test(hex)) return false;
  const bytes = new Uint8Array((hex.match(/.{2}/g) ?? []).map(pair => parseInt(pair, 16)));
  return crypto.subtle.verify("HMAC", await quoteKey(secret), bytes, new TextEncoder().encode(payload));
}
