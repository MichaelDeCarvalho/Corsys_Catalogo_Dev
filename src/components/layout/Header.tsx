import React, { useState, useRef, useEffect } from 'react';
import { 
  Building2, 
  Store, 
  ShieldCheck, 
  ShoppingCart, 
  ExternalLink, 
  Plus, 
  ChevronDown, 
  User, 
  LogIn, 
  LogOut
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useAuth } from '../../context/AuthContext';

export const Header: React.FC<{ onOpenNewTenantModal?: () => void }> = ({ onOpenNewTenantModal }) => {
  const {
    viewMode,
    setViewMode,
    currentTenant,
    tenants,
    setCurrentTenantId,
    cartItemsCount,
    setIsCartOpen,
  } = useApp();

  const {
    session,
    user,
    isPlatformAdmin,
    canAccessTenantAdmin,
    canAccessSuperAdmin,
    authRole,
    authTenant,
    openLoginModal,
    signOut
  } = useAuth();

  const [isTenantMenuOpen, setIsTenantMenuOpen] = useState(false);
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);

  // Fechamento de dropdowns em cliques externos
  const userMenuRef = useRef<HTMLDivElement>(null);
  const tenantMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(event.target as Node)) {
        setIsUserMenuOpen(false);
      }
      if (tenantMenuRef.current && !tenantMenuRef.current.contains(event.target as Node)) {
        setIsTenantMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <header className="sticky top-0 z-40 bg-[#0F172A] text-white border-b border-slate-800 shadow-md">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16 gap-3">
          
          {/* Identidade Corsys.Catálogo & Seletor de Tenant (Exclusivo Platform Admin) */}
          <div className="flex items-center gap-3">
            <button 
              onClick={() => setViewMode('storefront')}
              className="flex items-center gap-2.5 text-left cursor-pointer group focus:outline-none"
              id="header-logo-button"
              title="Corsys.Catálogo — Início"
            >
              <div className="w-8 h-8 rounded-xl bg-slate-800 border border-slate-700 flex items-center justify-center text-white shadow-xs group-hover:border-[#FF5A00] transition-colors">
                <span className="font-extrabold text-sm text-[#FF5A00]">C.</span>
              </div>
              <div>
                <div className="font-extrabold tracking-tight text-base leading-tight text-white flex items-center gap-1 font-['Outfit']">
                  Corsys<span className="text-[#FF5A00]">.</span>Catálogo
                </div>
                <div className="text-[10px] text-slate-400 font-medium hidden sm:block">
                  Catálogo Digital & Pedidos
                </div>
              </div>
            </button>

            {/* Seletor Global de Tenant: EXCLUSIVO para platform_admin */}
            {isPlatformAdmin && (
              <div className="relative ml-2" ref={tenantMenuRef}>
                <button
                  onClick={() => setIsTenantMenuOpen(!isTenantMenuOpen)}
                  className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-slate-800/90 hover:bg-slate-700 border border-indigo-500/40 text-xs text-slate-200 transition-colors cursor-pointer"
                  id="tenant-switcher-button"
                  title="Seletor Global de Empresas (Exclusivo Platform Admin)"
                >
                  <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  <span className="font-semibold text-white max-w-[120px] sm:max-w-[160px] truncate">
                    {currentTenant.name}
                  </span>
                  <span className="text-[9px] bg-indigo-900/60 text-indigo-300 px-1.5 py-0.5 rounded uppercase font-bold border border-indigo-700/50">
                    {currentTenant.plan}
                  </span>
                  <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
                </button>

                {isTenantMenuOpen && (
                  <div className="absolute left-0 mt-2 w-72 rounded-xl bg-slate-900 border border-slate-700 shadow-2xl z-50 p-2 text-xs">
                    <div className="px-2 py-1.5 text-[10px] font-bold text-indigo-400 uppercase tracking-wider flex items-center gap-1">
                      <ShieldCheck className="w-3.5 h-3.5" />
                      Selecione a Empresa (Master)
                    </div>
                    
                    <div className="space-y-1 my-1 max-h-60 overflow-y-auto">
                      {tenants.map((t) => (
                        <button
                          key={t.id}
                          onClick={() => {
                            setCurrentTenantId(t.id);
                            setIsTenantMenuOpen(false);
                          }}
                          className={`w-full text-left px-3 py-2 rounded-lg flex items-center justify-between transition-colors cursor-pointer ${
                            t.id === currentTenant.id
                              ? 'bg-blue-600 text-white font-medium'
                              : 'text-slate-200 hover:bg-slate-800'
                          }`}
                        >
                          <div className="truncate">
                            <div className="font-medium truncate">{t.name}</div>
                            <div className="text-[10px] opacity-75">/{t.slug}</div>
                          </div>
                          <span className="text-[9px] uppercase px-1.5 py-0.5 rounded bg-black/30">
                            {t.plan}
                          </span>
                        </button>
                      ))}
                    </div>

                    <div className="pt-2 border-t border-slate-800 mt-1">
                      <button
                        onClick={() => {
                          setIsTenantMenuOpen(false);
                          onOpenNewTenantModal?.();
                        }}
                        className="w-full py-2 px-3 bg-blue-600 hover:bg-blue-500 text-white rounded-lg flex items-center justify-center gap-1.5 font-medium transition-colors cursor-pointer"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        Cadastrar Nova Empresa / Loja
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Barra de Navegação Central (Exclusiva para platform_admin) */}
          {isPlatformAdmin && (
            <div className="hidden md:flex items-center gap-1 bg-slate-800/80 p-1 rounded-xl border border-slate-700/60 text-xs">
              <button
                onClick={() => setViewMode('superadmin')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-medium transition-all cursor-pointer ${
                  viewMode === 'superadmin'
                    ? 'bg-indigo-600 text-white shadow-xs'
                    : 'text-slate-300 hover:text-white hover:bg-slate-700/50'
                }`}
                id="nav-superadmin"
                title="Painel Master Global"
              >
                <ShieldCheck className="w-3.5 h-3.5" />
                <span>Painel Master</span>
              </button>

              <button
                onClick={() => setViewMode('tenant_admin')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-medium transition-all cursor-pointer ${
                  viewMode === 'tenant_admin'
                    ? 'bg-blue-600 text-white shadow-xs'
                    : 'text-slate-300 hover:text-white hover:bg-slate-700/50'
                }`}
                id="nav-tenant-admin"
                title="Painel de Gestão da Loja Ativa"
              >
                <Store className="w-3.5 h-3.5" />
                <span>Painel Loja</span>
              </button>

              <button
                onClick={() => setViewMode('storefront')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-medium transition-all cursor-pointer ${
                  viewMode === 'storefront'
                    ? 'bg-slate-700 text-white shadow-xs'
                    : 'text-slate-300 hover:text-white hover:bg-slate-700/50'
                }`}
                id="nav-storefront"
                title="Visualizar Catálogo Público"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                <span>Catálogo</span>
              </button>
            </div>
          )}

          {/* Ações da Direita: Carrinho, Botão de Loja para Tenant Admin e Menu da Conta */}
          <div className="flex items-center gap-2 sm:gap-2.5">
            
            {/* Carrinho / Ver Pedido (Visível no catálogo para qualquer usuário) */}
            {viewMode === 'storefront' && (
              <button
                onClick={() => setIsCartOpen(true)}
                className="relative flex items-center gap-2 bg-[#FF5A00] hover:bg-[#E04F00] text-white px-3.5 py-1.5 rounded-xl font-bold text-xs transition-all shadow-md shadow-orange-950/20 cursor-pointer"
                id="header-cart-button"
                title="Abrir carrinho de pedidos"
              >
                <ShoppingCart className="w-4 h-4" />
                <span className="hidden sm:inline">Ver Pedido</span>
                {cartItemsCount > 0 && (
                  <span className="w-5 h-5 bg-white text-[#0F172A] font-black rounded-full flex items-center justify-center text-[11px] shadow-xs">
                    {cartItemsCount}
                  </span>
                )}
              </button>
            )}

            {/* Acesso rápido discreto para tenant_admin (não polui para anônimo nem platform_admin) */}
            {!isPlatformAdmin && canAccessTenantAdmin && (
              viewMode === 'storefront' ? (
                <button
                  onClick={() => setViewMode('tenant_admin')}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-semibold text-slate-200 transition-colors cursor-pointer"
                  id="header-tenant-admin-btn"
                  title="Acessar o Painel de Gestão da Loja"
                >
                  <Store className="w-3.5 h-3.5 text-blue-400" />
                  <span className="hidden sm:inline">Painel da Loja</span>
                </button>
              ) : (
                <button
                  onClick={() => setViewMode('storefront')}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-semibold text-slate-200 transition-colors cursor-pointer"
                  id="header-back-to-storefront-btn"
                  title="Voltar ao Catálogo Público"
                >
                  <ExternalLink className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="hidden sm:inline">Ver Catálogo</span>
                </button>
              )
            )}

            {/* Autenticação: Botão Entrar ou Dropdown da Conta */}
            {!session ? (
              <button
                onClick={() => openLoginModal()}
                className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-semibold text-xs transition-colors border border-slate-700 shadow-xs cursor-pointer"
                id="header-login-button"
                title="Entrar na conta"
              >
                <LogIn className="w-3.5 h-3.5 text-slate-300" />
                <span>Entrar</span>
              </button>
            ) : (
              <div className="relative" ref={userMenuRef}>
                <button
                  onClick={() => setIsUserMenuOpen(!isUserMenuOpen)}
                  className="flex items-center gap-2 p-1 sm:px-2.5 sm:py-1.5 rounded-xl bg-slate-800/90 hover:bg-slate-700/80 border border-slate-700 text-xs transition-colors cursor-pointer"
                  id="header-user-menu-btn"
                  title="Menu do Usuário"
                >
                  <div className={`w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold shrink-0 ${
                    isPlatformAdmin 
                      ? 'bg-gradient-to-tr from-indigo-500 to-purple-600 text-white shadow-xs ring-1 ring-indigo-400/50' 
                      : 'bg-gradient-to-tr from-blue-500 to-cyan-600 text-white shadow-xs'
                  }`}>
                    {user?.email?.charAt(0).toUpperCase() || 'U'}
                  </div>
                  <div className="hidden md:block text-left leading-tight max-w-[120px]">
                    <div className="font-semibold text-slate-200 text-[11px] truncate">
                      {user?.email}
                    </div>
                  </div>
                  <ChevronDown className="w-3.5 h-3.5 text-slate-400 hidden sm:block" />
                </button>

                {/* Dropdown Menu da Conta */}
                {isUserMenuOpen && (
                  <div className="absolute right-0 mt-2 w-64 rounded-2xl bg-slate-900 border border-slate-800 shadow-2xl z-50 p-2 text-xs divide-y divide-slate-800 animate-in fade-in slide-in-from-top-2 duration-150">
                    {/* Cabeçalho do Perfil */}
                    <div className="p-2 pb-3">
                      <div className="font-semibold text-white text-xs truncate">
                        {user?.email}
                      </div>
                      <div className="mt-1">
                        {isPlatformAdmin ? (
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-md bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                            <ShieldCheck className="w-3 h-3" /> Platform Admin
                          </span>
                        ) : canAccessTenantAdmin ? (
                          <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-md bg-blue-500/20 text-blue-300 border border-blue-500/30">
                            <Store className="w-3 h-3" /> {authTenant?.name || 'Administrador da Loja'}
                          </span>
                        ) : (
                          <span className="text-[10px] text-slate-400">
                            Cliente Autenticado
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Ações Rápidas por Perfil */}
                    <div className="py-1 space-y-0.5">
                      {canAccessTenantAdmin && (
                        <button
                          onClick={() => {
                            setViewMode('tenant_admin');
                            setIsUserMenuOpen(false);
                          }}
                          className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-left font-medium transition-colors cursor-pointer ${
                            viewMode === 'tenant_admin'
                              ? 'bg-blue-600 text-white'
                              : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                          }`}
                        >
                          <Store className="w-4 h-4 text-blue-400" />
                          <span>Painel da Loja</span>
                        </button>
                      )}

                      {isPlatformAdmin && (
                        <button
                          onClick={() => {
                            setViewMode('superadmin');
                            setIsUserMenuOpen(false);
                          }}
                          className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-left font-medium transition-colors cursor-pointer ${
                            viewMode === 'superadmin'
                              ? 'bg-indigo-600 text-white'
                              : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                          }`}
                        >
                          <ShieldCheck className="w-4 h-4 text-indigo-400" />
                          <span>Painel Master Global</span>
                        </button>
                      )}

                      <button
                        onClick={() => {
                          setViewMode('storefront');
                          setIsUserMenuOpen(false);
                        }}
                        className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-left font-medium transition-colors cursor-pointer ${
                          viewMode === 'storefront'
                            ? 'bg-slate-800 text-white'
                            : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                        }`}
                      >
                        <ExternalLink className="w-4 h-4 text-emerald-400" />
                        <span>Catálogo Público</span>
                      </button>
                    </div>

                    {/* Logout */}
                    <div className="pt-1.5">
                      <button
                        onClick={() => {
                          setIsUserMenuOpen(false);
                          signOut();
                        }}
                        className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-left font-semibold text-red-400 hover:bg-red-500/15 hover:text-red-300 transition-colors cursor-pointer"
                        id="header-user-logout-btn"
                      >
                        <LogOut className="w-4 h-4" />
                        <span>Encerrar Sessão (Sair)</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

          </div>

        </div>
      </div>
    </header>
  );
};

