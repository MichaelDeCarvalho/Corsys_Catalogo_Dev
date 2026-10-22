import { createClient, SupabaseClient } from '@supabase/supabase-js';

const getEnvVar = (key: string): string => {
  if (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env[key]) {
    return import.meta.env[key];
  }
  if (typeof process !== 'undefined' && process.env && process.env[key]) {
    return process.env[key] as string;
  }
  return '';
};

const supabaseUrl = getEnvVar('VITE_SUPABASE_URL');
const supabasePublishableKey = getEnvVar('VITE_SUPABASE_PUBLISHABLE_KEY');

export function isSupabaseConfigured(): boolean {
  return Boolean(
    supabaseUrl &&
    supabaseUrl.trim() !== '' &&
    supabaseUrl !== 'YOUR_SUPABASE_URL' &&
    supabasePublishableKey &&
    supabasePublishableKey.trim() !== '' &&
    supabasePublishableKey !== 'YOUR_SUPABASE_PUBLISHABLE_KEY'
  );
}

function initSupabaseClient(): SupabaseClient {
  if (!isSupabaseConfigured()) {
    // Retorna cliente seguro de fallback sem quebrar a renderização inicial do app
    return createClient('https://placeholder-project.supabase.co', 'placeholder-anon-key', {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });
  }

  return createClient(supabaseUrl, supabasePublishableKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
    },
  });
}

let clientInstance: SupabaseClient | null = null;
let publicCatalogClient: SupabaseClient | null = null;

// Public projection uses anon RLS regardless of the signed-in buyer's staff role.
// Never share or persist the authenticated client's session on this client.
export const getPublicCatalogClient = (): SupabaseClient => {
  if (!isSupabaseConfigured()) throw new Error('Supabase não configurado.');
  if (!publicCatalogClient) {
    publicCatalogClient = createClient(supabaseUrl, supabasePublishableKey, {
      auth: {
        storageKey: 'corsys-public-catalog-anon',
        persistSession: false, autoRefreshToken: false, detectSessionInUrl: false,
      },
    });
  }
  return publicCatalogClient;
};

export const getSupabaseClient = (): SupabaseClient => {
  if (!clientInstance) {
    clientInstance = initSupabaseClient();
  }
  return clientInstance;
};

export const supabase: SupabaseClient = new Proxy({} as SupabaseClient, {
  get(_target, prop, receiver) {
    const client = getSupabaseClient();
    const value = Reflect.get(client, prop, receiver);
    if (typeof value === 'function') {
      return value.bind(client);
    }
    return value;
  },
});
