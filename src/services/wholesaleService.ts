/**
 * Serviço oficial de acesso atacadista B2B (Wholesale Service).
 * 
 * DIRETRIZES:
 * 1. O catálogo de varejo não expõe preços de atacado.
 * 2. Preços atacadistas são obtidos EXCLUSIVAMENTE via Edge Function autenticada 'get-wholesale-catalog' (apenas clientes approved).
 * 3. Submissão de novas solicitações B2B é processada via Edge Function 'submit-wholesale-application'.
 * 4. Aprovação, rejeição e suspensão são processadas via Edge Function autenticada 'manage-wholesale-customer'.
 * 5. Não armazena secrets ou service_role no client-side.
 */

import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { WholesaleCustomer, WholesaleItemData, WholesaleCustomerStatus } from '../types';

export interface SubmitWholesaleApplicationPayload {
  tenantSlug: string;
  cnpj: string;
  legalName: string;
  tradeName?: string;
  contactName: string;
  email: string;
  phone: string;
  city?: string;
  state?: string;
  website?: string; // honeypot anti-spam
}

export interface WholesaleCustomerStatusResult {
  status: 'unauthenticated' | 'not_registered' | 'tenant_not_found' | WholesaleCustomerStatus;
  cnpj?: string;
  legalName?: string;
  tradeName?: string | null;
  contactName?: string;
  email?: string;
  phone?: string;
  createdAt?: string;
  approvedAt?: string | null;
}

/**
 * Validação dos dígitos verificadores de CNPJ no client (Módulo 11)
 */
export function validateCnpj(cnpjDigitsOrFormatted: string): { valid: boolean; error?: string } {
  const digits = cnpjDigitsOrFormatted.replace(/\D/g, '');
  if (digits.length !== 14) {
    return { valid: false, error: 'CNPJ deve conter exatamente 14 dígitos.' };
  }
  if (/^(\d)\1{13}$/.test(digits)) {
    return { valid: false, error: 'CNPJ inválido (dígitos repetidos).' };
  }

  const weightsFirst = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const weightsSecond = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];

  let sum = 0;
  for (let i = 0; i < 12; i++) {
    sum += parseInt(digits[i], 10) * weightsFirst[i];
  }
  let remainder = sum % 11;
  const digit1 = remainder < 2 ? 0 : 11 - remainder;
  if (parseInt(digits[12], 10) !== digit1) {
    return { valid: false, error: 'Dígitos verificadores do CNPJ são inválidos.' };
  }

  sum = 0;
  for (let i = 0; i < 13; i++) {
    sum += parseInt(digits[i], 10) * weightsSecond[i];
  }
  remainder = sum % 11;
  const digit2 = remainder < 2 ? 0 : 11 - remainder;
  if (parseInt(digits[13], 10) !== digit2) {
    return { valid: false, error: 'Dígitos verificadores do CNPJ são inválidos.' };
  }

  return { valid: true };
}

/**
 * Formata CNPJ para exibição visual: 00.000.000/0000-00
 */
export function formatCnpj(cnpj: string): string {
  const digits = cnpj.replace(/\D/g, '').slice(0, 14);
  if (digits.length <= 2) return digits;
  if (digits.length <= 5) return `${digits.slice(0, 2)}.${digits.slice(2)}`;
  if (digits.length <= 8) return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5)}`;
  if (digits.length <= 12) return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8)}`;
  return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-${digits.slice(12, 14)}`;
}

/**
 * Envia uma nova solicitação de cadastro atacadista B2B.
 * Utiliza a Edge Function pública 'submit-wholesale-application'.
 */
export async function submitWholesaleApplication(
  payload: SubmitWholesaleApplicationPayload
): Promise<{ success: boolean; message: string }> {
  if (!isSupabaseConfigured()) {
    throw new Error('Supabase não configurado no ambiente.');
  }

  const normalizedCnpj = payload.cnpj.replace(/\D/g, '');
  const cnpjCheck = validateCnpj(normalizedCnpj);
  if (!cnpjCheck.valid) {
    throw new Error(cnpjCheck.error || 'CNPJ inválido.');
  }

  try {
    const { data, error } = await supabase.functions.invoke('submit-wholesale-application', {
      body: {
        tenantSlug: payload.tenantSlug,
        cnpj: normalizedCnpj,
        legalName: payload.legalName.trim(),
        tradeName: payload.tradeName?.trim() || null,
        contactName: payload.contactName.trim(),
        email: payload.email.trim().toLowerCase(),
        phone: payload.phone.trim(),
        city: payload.city?.trim() || null,
        state: payload.state?.trim() || null,
        website: payload.website || ''
      }
    });

    if (error) {
      let errMsg = error.message || 'Falha ao enviar solicitação de cadastro.';
      // Trata erros retornados no payload da função
      if ((error as any).context) {
        try {
          const bodyJson = await (error as any).context.json();
          if (bodyJson?.error) errMsg = bodyJson.error;
        } catch {
          // Mantém mensagem padrão
        }
      }
      throw new Error(errMsg);
    }

    if (data && data.error) {
      throw new Error(data.error);
    }

    return {
      success: true,
      message: data?.message || 'Solicitação enviada com sucesso! Aguarde a aprovação da nossa equipe.'
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Falha na comunicação com o servidor.';
    // Verifica se a função ainda não foi implantada no ambiente Supabase do usuário
    if (msg.includes('404') || msg.includes('Failed to send a request to the Edge Function')) {
      throw new Error('A Edge Function de cadastro B2B (submit-wholesale-application) aguarda deploy na instância Supabase vinculada.');
    }
    throw new Error(msg);
  }
}

/**
 * Consulta o status B2B do usuário autenticado no tenant ativo via RPC segura get_my_wholesale_status.
 */
export async function fetchMyWholesaleStatus(tenantSlug: string): Promise<WholesaleCustomerStatusResult> {
  if (!isSupabaseConfigured()) {
    return { status: 'unauthenticated' };
  }

  try {
    const { data, error } = await supabase.rpc('get_my_wholesale_status', {
      p_tenant_slug: tenantSlug
    });

    if (error) {
      console.warn('[wholesaleService] Falha ao consultar status atacadista via RPC:', error.message);
      return { status: 'unauthenticated' };
    }

    if (!data) {
      return { status: 'unauthenticated' };
    }

    return {
      status: data.status || 'not_registered',
      cnpj: data.cnpj,
      legalName: data.legal_name,
      tradeName: data.trade_name,
      contactName: data.contact_name,
      email: data.email,
      phone: data.phone,
      createdAt: data.created_at,
      approvedAt: data.approved_at
    };
  } catch (err) {
    console.warn('[wholesaleService] Erro ao obter status atacadista:', err);
    return { status: 'unauthenticated' };
  }
}

/**
 * Consulta a lista sanitizada de preços atacadistas via Edge Function gateway 'get-wholesale-catalog'.
 * Somente executável por usuário autenticado com status 'approved' e allow_b2b_mode ativo.
 * Não invoca diretamente RPC privilegiada com SECURITY DEFINER no PostgreSQL a partir do browser.
 */
export async function fetchWholesaleCatalog(tenantSlug: string): Promise<WholesaleItemData[]> {
  if (!isSupabaseConfigured()) {
    throw new Error('Supabase não configurado.');
  }

  try {
    const { data, error } = await supabase.functions.invoke('get-wholesale-catalog', {
      body: { tenantSlug }
    });

    if (error) {
      let errMsg = error.message || 'Falha ao carregar catálogo atacadista autorizado.';
      if ((error as any).context) {
        try {
          const bodyJson = await (error as any).context.json();
          if (bodyJson?.error) errMsg = bodyJson.error;
        } catch {
          // Mantém mensagem padrão
        }
      }
      throw new Error(errMsg);
    }

    if (data && data.error) {
      throw new Error(data.error);
    }

    if (!data || typeof data !== 'object' || Array.isArray(data) || data.success !== true || !Array.isArray(data.items)) {
      throw new Error('Falha ao carregar catálogo atacadista autorizado.');
    }

    const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    const validatedItems: WholesaleItemData[] = [];

    for (const item of data.items) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        throw new Error('Falha ao carregar catálogo atacadista autorizado.');
      }

      if (typeof item.productId !== 'string' || !UUID_REGEX.test(item.productId.trim())) {
        throw new Error('Falha ao carregar catálogo atacadista autorizado.');
      }

      if (typeof item.sku !== 'string' || item.sku.trim().length === 0) {
        throw new Error('Falha ao carregar catálogo atacadista autorizado.');
      }

      if (typeof item.wholesalePrice !== 'number' || !Number.isFinite(item.wholesalePrice) || item.wholesalePrice <= 0) {
        throw new Error('Falha ao carregar catálogo atacadista autorizado.');
      }

      if (typeof item.wholesaleMinQuantity !== 'number' || !Number.isInteger(item.wholesaleMinQuantity) || item.wholesaleMinQuantity < 1) {
        throw new Error('Falha ao carregar catálogo atacadista autorizado.');
      }

      validatedItems.push({
        productId: item.productId.trim(),
        sku: item.sku.trim(),
        wholesalePrice: item.wholesalePrice,
        wholesaleMinQuantity: item.wholesaleMinQuantity
      });
    }

    return validatedItems;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Falha na comunicação com o servidor.';
    if (msg.includes('404') || msg.includes('Failed to send a request to the Edge Function')) {
      throw new Error('A Edge Function de catálogo B2B (get-wholesale-catalog) aguarda deploy na instância Supabase vinculada.');
    }
    throw new Error(msg);
  }
}

/**
 * Consulta administrativa: lista todas as solicitações e clientes atacadistas do tenant.
 * Protegido por RLS na tabela public.wholesale_customers (apenas tenant_admin da loja).
 */
export async function fetchAdminWholesaleCustomers(tenantId: string): Promise<WholesaleCustomer[]> {
  if (!isSupabaseConfigured()) {
    throw new Error('Supabase não configurado.');
  }

  const { data, error } = await supabase
    .from('wholesale_customers')
    .select('id, tenant_id, user_id, cnpj, legal_name, trade_name, contact_name, email, phone, city, state, status, approved_at, approved_by, created_at, updated_at')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false });

  if (error) {
    throw new Error(`Erro ao consultar clientes atacadistas no Supabase: ${error.message}`);
  }

  return (data || []).map((row: any) => ({
    id: row.id,
    tenantId: row.tenant_id,
    userId: row.user_id,
    cnpj: row.cnpj,
    legalName: row.legal_name,
    tradeName: row.trade_name,
    contactName: row.contact_name,
    email: row.email,
    phone: row.phone,
    city: row.city,
    state: row.state,
    status: row.status as WholesaleCustomerStatus,
    approvedAt: row.approved_at,
    approvedBy: row.approved_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }));
}

/**
 * Ação administrativa de gestão de cliente atacadista (approve, reject, suspend, reactivate).
 * Executa server-side via Edge Function 'manage-wholesale-customer'.
 */
export async function manageAdminWholesaleCustomer(
  customerId: string,
  action: 'approve' | 'reject' | 'suspend' | 'reactivate'
): Promise<{ success: boolean; message: string; status?: string }> {
  if (!isSupabaseConfigured()) {
    throw new Error('Supabase não configurado.');
  }

  try {
    const { data, error } = await supabase.functions.invoke('manage-wholesale-customer', {
      body: { customerId, action }
    });

    if (error) {
      let errMsg = error.message || 'Falha ao executar ação no cliente atacadista.';
      if ((error as any).context) {
        try {
          const bodyJson = await (error as any).context.json();
          if (bodyJson?.error) errMsg = bodyJson.error;
        } catch {
          // Mantém mensagem padrão
        }
      }
      throw new Error(errMsg);
    }

    if (data && data.error) {
      throw new Error(data.error);
    }

    return {
      success: true,
      message: data?.message || 'Operação realizada com sucesso.',
      status: data?.status
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Falha na comunicação com o servidor.';
    if (msg.includes('404') || msg.includes('Failed to send a request to the Edge Function')) {
      throw new Error('A Edge Function de gestão B2B (manage-wholesale-customer) aguarda deploy na instância Supabase vinculada.');
    }
    throw new Error(msg);
  }
}
