import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { Session, User } from '@supabase/supabase-js';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { useApp, AppViewMode } from './AppContext';

export interface TenantMembership {
  id: string; // auth.users id
  tenant_id: string;
  role: 'tenant_admin' | 'sales_rep' | 'stock_manager';
  name: string;
  email: string;
  active: boolean;
}

export interface AuthTenant {
  id: string;
  slug: string;
  name: string;
  trade_name?: string | null;
  cnpj_cpf?: string | null;
  owner_email?: string | null;
  owner_phone?: string | null;
  owner_name?: string | null;
  plan?: string | null;
  status?: string | null;
  custom_domain?: string | null;
  created_at?: string | null;
}

export interface AuthContextType {
  // Sessão e Usuário
  session: Session | null;
  user: User | null;
  loading: boolean;
  isConfigured: boolean;

  // Papéis e Permissões Descobertos
  isPlatformAdmin: boolean;
  authRole: 'platform_admin' | 'tenant_admin' | 'sales_rep' | 'stock_manager' | null;
  authTenantId: string | null;
  authTenant: AuthTenant | null;
  tenantMemberships: TenantMembership[];
  currentTenantRole: 'tenant_admin' | 'sales_rep' | 'stock_manager' | null;

  // Guards e Permissões de Acesso
  canAccessTenantAdmin: boolean;
  canAccessSuperAdmin: boolean;
  isCurrentTenantAdmin: boolean;
  hasTenantAdminFor: (tenantId: string) => boolean;

  // Métodos de Autenticação
  signInWithPassword: (email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;

  // Controle do Modal de Login
  isLoginModalOpen: boolean;
  openLoginModal: (targetMode?: AppViewMode) => void;
  closeLoginModal: () => void;
  targetRedirectMode: AppViewMode | null;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { currentTenantId, viewMode, setViewMode, showToast } = useApp();

  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false);
  const [authRole, setAuthRole] = useState<'platform_admin' | 'tenant_admin' | 'sales_rep' | 'stock_manager' | null>(null);
  const [authTenantId, setAuthTenantId] = useState<string | null>(null);
  const [authTenant, setAuthTenant] = useState<AuthTenant | null>(null);
  const [tenantMemberships, setTenantMemberships] = useState<TenantMembership[]>([]);

  // Modal State
  const [isLoginModalOpen, setIsLoginModalOpen] = useState(false);
  const [targetRedirectMode, setTargetRedirectMode] = useState<AppViewMode | null>(null);

  const isConfigured = isSupabaseConfigured();

  // Consulta e descobre privilégios reais em platform_admins e tenant_users
  const fetchUserRoles = useCallback(async (userId: string) => {
    if (!isSupabaseConfigured()) {
      setIsPlatformAdmin(false);
      setAuthRole(null);
      setAuthTenantId(null);
      setAuthTenant(null);
      setTenantMemberships([]);
      return;
    }

    try {
      // 1. Descobrir se é platform_admin via tabela public.platform_admins (RLS select_self)
      // Usar maybeSingle(): zero registros NÃO é erro de autenticação e NÃO pode abortar
      const { data: adminData, error: adminErr } = await supabase
        .from('platform_admins')
        .select('id, email, full_name')
        .eq('id', userId)
        .maybeSingle();

      const isPlatform = Boolean(!adminErr && adminData);
      setIsPlatformAdmin(isPlatform);

      // 2. Descobrir vínculos em public.tenant_users (RLS select_self)
      // CONTINUAR OBRIGATORIAMENTE mesmo se não for platform_admin
      const { data: teamData, error: teamErr } = await supabase
        .from('tenant_users')
        .select('id, tenant_id, role, name, email, active')
        .eq('id', userId);

      let memberships: TenantMembership[] = [];
      if (!teamErr && Array.isArray(teamData)) {
        memberships = teamData.filter((m: any) => m.active !== false) as TenantMembership[];
        setTenantMemberships(memberships);
      } else {
        setTenantMemberships([]);
      }

      // 3. Determinar authRole e tenantId
      const adminMembership = memberships.find((m) => m.role === 'tenant_admin');
      const anyMembership = memberships[0];

      let resolvedRole: 'platform_admin' | 'tenant_admin' | 'sales_rep' | 'stock_manager' | null = null;
      let resolvedTenantId: string | null = null;

      if (isPlatform) {
        resolvedRole = 'platform_admin';
        resolvedTenantId = adminMembership?.tenant_id || anyMembership?.tenant_id || null;
      } else if (adminMembership) {
        resolvedRole = 'tenant_admin';
        resolvedTenantId = adminMembership.tenant_id;
      } else if (anyMembership) {
        resolvedRole = anyMembership.role;
        resolvedTenantId = anyMembership.tenant_id;
      }

      setAuthRole(resolvedRole);
      setAuthTenantId(resolvedTenantId);

      // 4. Tenant Resolution: consultar public.tenants usando exatamente id = tenantId
      if (resolvedTenantId) {
        try {
          const { data: tenantRecord, error: tenantErr } = await supabase
            .from('tenants')
            .select('id, slug, name, trade_name, cnpj_cpf, owner_email, owner_phone, owner_name, plan, status, custom_domain, created_at')
            .eq('id', resolvedTenantId)
            .maybeSingle();

          if (!tenantErr && tenantRecord) {
            setAuthTenant(tenantRecord as AuthTenant);
          } else {
            // Se o vínculo em tenant_users está ativo e válido, fornecer fallback estruturado
            setAuthTenant({
              id: resolvedTenantId,
              name: adminMembership?.name ? `Loja (${adminMembership.name})` : 'Loja Vinculada',
              slug: 'loja',
              status: 'active',
              plan: 'pro'
            });
          }
        } catch {
          setAuthTenant({
            id: resolvedTenantId,
            name: 'Loja Vinculada',
            slug: 'loja',
            status: 'active',
            plan: 'pro'
          });
        }
      } else {
        setAuthTenant(null);
      }
    } catch (err) {
      console.warn('[AuthContext] Falha ao processar papéis do usuário:', err);
      setIsPlatformAdmin(false);
      setAuthRole(null);
      setAuthTenantId(null);
      setAuthTenant(null);
      setTenantMemberships([]);
    }
  }, []);

  const refreshProfile = useCallback(async () => {
    if (user) {
      await fetchUserRoles(user.id);
    }
  }, [user, fetchUserRoles]);

  // Acompanhamento contínuo da sessão Supabase
  useEffect(() => {
    if (!isConfigured) {
      setLoading(false);
      return;
    }

    let isMounted = true;

    // Recupera sessão ativa no storage local do Supabase
    supabase.auth
      .getSession()
      .then(({ data: { session: initialSession } }) => {
        if (!isMounted) return;
        setSession(initialSession);
        setUser(initialSession?.user ?? null);
        if (initialSession?.user) {
          fetchUserRoles(initialSession.user.id).finally(() => {
            if (isMounted) setLoading(false);
          });
        } else {
          setLoading(false);
        }
      })
      .catch((err) => {
        console.warn('[AuthContext] Erro ao recuperar sessão inicial:', err);
        if (isMounted) setLoading(false);
      });

    // Subscrição a eventos de autenticação (SIGNED_IN, SIGNED_OUT, TOKEN_REFRESHED)
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (_event, newSession) => {
      if (!isMounted) return;
      setSession(newSession);
      setUser(newSession?.user ?? null);
      if (newSession?.user) {
        await fetchUserRoles(newSession.user.id);
      } else {
        setIsPlatformAdmin(false);
        setAuthRole(null);
        setAuthTenantId(null);
        setAuthTenant(null);
        setTenantMemberships([]);
      }
      setLoading(false);
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, [isConfigured, fetchUserRoles]);

  // Login com senha usando Supabase Auth (signInWithPassword)
  const signInWithPassword = async (
    email: string,
    password: string
  ): Promise<{ success: boolean; error?: string }> => {
    if (!isConfigured) {
      return {
        success: false,
        error:
          'Supabase não está configurado. Preencha VITE_SUPABASE_URL e VITE_SUPABASE_PUBLISHABLE_KEY no ambiente.',
      };
    }

    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        return { success: false, error: error.message };
      }

      if (data.user) {
        await fetchUserRoles(data.user.id);
      }

      showToast(`Autenticado com sucesso.`);
      return { success: true };
    } catch (err: any) {
      return {
        success: false,
        error: err?.message || 'Erro inesperado ao realizar autenticação.',
      };
    }
  };

  // Logout via Supabase Auth
  const signOut = async () => {
    if (isConfigured) {
      try {
        await supabase.auth.signOut();
      } catch (err) {
        console.warn('[AuthContext] Erro ao executar signOut:', err);
      }
    }
    setSession(null);
    setUser(null);
    setIsPlatformAdmin(false);
    setAuthRole(null);
    setAuthTenantId(null);
    setAuthTenant(null);
    setTenantMemberships([]);
    showToast('Sessão encerrada com sucesso.');

    // Se estiver em telas restritas ou tela de Meus Pedidos, redireciona para a vitrine pública
    if (viewMode === 'superadmin' || viewMode === 'tenant_admin' || viewMode === 'my_orders') {
      setViewMode('storefront');
    }
  };

  // Resolução de papéis e guards
  const isAuthenticated = Boolean(session && user);
  const isTenantValid = Boolean(authTenant && (authTenant.status === 'active' || !authTenant.status));

  // O acesso ao Painel da Loja depende do perfil e tenant reais (não de currentTenantId legado nem mock)
  const canAccessTenantAdmin = Boolean(
    isAuthenticated && (
      isPlatformAdmin ||
      (authRole === 'tenant_admin' && authTenantId !== null && isTenantValid)
    )
  );

  // Painel Master exclusivo para Administradores Globais
  const canAccessSuperAdmin = Boolean(isAuthenticated && isPlatformAdmin);

  // isCurrentTenantAdmin unificado com canAccessTenantAdmin para manter compatibilidade
  const isCurrentTenantAdmin = canAccessTenantAdmin;

  const currentMembership = tenantMemberships.find((m) => m.tenant_id === (authTenantId || currentTenantId));
  const currentTenantRole = currentMembership ? currentMembership.role : (authRole === 'tenant_admin' ? 'tenant_admin' : null);

  const hasTenantAdminFor = (tenantId: string): boolean => {
    if (isPlatformAdmin) return true;
    if (authRole === 'tenant_admin' && authTenantId === tenantId) return true;
    return tenantMemberships.some(
      (m) => m.tenant_id === tenantId && m.role === 'tenant_admin'
    );
  };

  const openLoginModal = (targetMode?: AppViewMode) => {
    setTargetRedirectMode(targetMode || null);
    setIsLoginModalOpen(true);
  };

  const closeLoginModal = () => {
    setIsLoginModalOpen(false);
    setTargetRedirectMode(null);
  };

  return (
    <AuthContext.Provider
      value={{
        session,
        user,
        loading,
        isConfigured,
        isPlatformAdmin,
        authRole,
        authTenantId,
        authTenant,
        tenantMemberships,
        currentTenantRole,
        canAccessTenantAdmin,
        canAccessSuperAdmin,
        isCurrentTenantAdmin,
        hasTenantAdminFor,
        signInWithPassword,
        signOut,
        refreshProfile,
        isLoginModalOpen,
        openLoginModal,
        closeLoginModal,
        targetRedirectMode,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth deve ser utilizado dentro de um AuthProvider');
  }
  return context;
};
