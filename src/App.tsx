import React, { useState } from 'react';
import { AppProvider, useApp } from './context/AppContext';
import { AuthProvider, useAuth } from './context/AuthContext';
import { WholesaleAccessProvider } from './context/WholesaleAccessContext';
import { Header } from './components/layout/Header';
import { SuperAdminDashboard } from './components/superadmin/SuperAdminDashboard';
import { TenantDashboard } from './components/tenantadmin/TenantDashboard';
import { StorefrontView } from './components/storefront/StorefrontView';
import { CustomerOrderTrackingView } from './components/storefront/CustomerOrderTrackingView';
import { SaasBlueprintGuide } from './components/architecture/SaasBlueprintGuide';
import { NewTenantModal } from './components/modals/NewTenantModal';
import { LoginModal } from './components/auth/LoginModal';
import { B2BGateModal } from './components/storefront/B2BGateModal';
import { B2BRegisterModal } from './components/storefront/B2BRegisterModal';
import { B2BSwitchModeConfirmModal } from './components/storefront/B2BSwitchModeConfirmModal';
import { AccessDeniedGate } from './components/auth/AccessDeniedGate';
import { CheckCircle2 } from 'lucide-react';

const MainContent: React.FC = () => {
  const { viewMode, toastMessage, currentTenant } = useApp();
  const { canAccessSuperAdmin, canAccessTenantAdmin, authTenant } = useAuth();
  const [isNewTenantModalOpen, setIsNewTenantModalOpen] = useState(false);

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col font-['Plus_Jakarta_Sans'] text-slate-100 antialiased selection:bg-blue-600 selection:text-white">
      
      {/* Universal SaaS Header & Tenant Bar */}
      <Header onOpenNewTenantModal={() => setIsNewTenantModalOpen(true)} />

      {/* Main Routed View with Authentication & Role Protection */}
      <main className="flex-1 bg-slate-950 text-slate-100">
        {viewMode === 'superadmin' && (
          canAccessSuperAdmin ? (
            <SuperAdminDashboard onOpenNewTenant={() => setIsNewTenantModalOpen(true)} />
          ) : (
            <AccessDeniedGate requiredRole="platform_admin" />
          )
        )}
        {viewMode === 'tenant_admin' && (
          canAccessTenantAdmin ? (
            <TenantDashboard />
          ) : (
            <AccessDeniedGate requiredRole="tenant_admin" tenantName={authTenant?.name || currentTenant.name} />
          )
        )}
        {viewMode === 'storefront' && <StorefrontView />}
        {viewMode === 'my_orders' && <CustomerOrderTrackingView />}
        {viewMode === 'blueprint_guide' && <SaasBlueprintGuide />}
      </main>

      {/* Global Modals */}
      <NewTenantModal 
        isOpen={isNewTenantModalOpen} 
        onClose={() => setIsNewTenantModalOpen(false)} 
      />
      <LoginModal />
      <B2BGateModal />
      <B2BRegisterModal />
      <B2BSwitchModeConfirmModal />

      {/* Global Notification Toast */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 bg-slate-900/95 text-white px-4 py-3 rounded-2xl shadow-2xl border border-slate-800 flex items-center gap-2.5 text-xs font-semibold animate-in fade-in slide-in-from-bottom-5 duration-200 backdrop-blur-md">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>{toastMessage}</span>
        </div>
      )}

    </div>
  );
};

export default function App() {
  return (
    <AppProvider>
      <AuthProvider>
        <WholesaleAccessProvider>
          <MainContent />
        </WholesaleAccessProvider>
      </AuthProvider>
    </AppProvider>
  );
}

