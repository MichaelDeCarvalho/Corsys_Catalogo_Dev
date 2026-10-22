import React, { useState } from 'react';
import { 
  Lock, 
  Mail, 
  KeyRound, 
  X, 
  AlertCircle, 
  Loader2, 
  ShieldCheck, 
  ArrowRight,
  Info
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useApp } from '../../context/AppContext';

export const LoginModal: React.FC = () => {
  const { 
    isLoginModalOpen, 
    closeLoginModal, 
    signInWithPassword, 
    targetRedirectMode, 
    isConfigured,
    isPlatformAdmin,
    isCurrentTenantAdmin
  } = useAuth();

  const { setViewMode, showToast, currentTenant } = useApp();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  if (!isLoginModalOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    if (!email.trim() || !password.trim()) {
      setErrorMessage('Por favor, informe o e-mail e a senha.');
      return;
    }

    setLoading(true);

    const result = await signInWithPassword(email.trim(), password);

    setLoading(false);

    if (!result.success) {
      setErrorMessage(result.error || 'Falha na autenticação. Verifique suas credenciais.');
      return;
    }

    // Login bem-sucedido: verifica redirecionamento solicitado
    if (targetRedirectMode === 'superadmin') {
      // O estado de isPlatformAdmin foi atualizado durante o signInWithPassword
      setViewMode('superadmin');
    } else if (targetRedirectMode === 'tenant_admin') {
      setViewMode('tenant_admin');
    }

    closeLoginModal();
    setEmail('');
    setPassword('');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200">
      <div 
        className="fixed inset-0" 
        onClick={closeLoginModal} 
        aria-hidden="true" 
      />

      <div className="relative w-full max-w-md bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-8 shadow-2xl z-10 text-slate-100 overflow-hidden">
        {/* Subtle top light bar */}
        <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-blue-500 via-indigo-500 to-purple-500" />

        {/* Close button */}
        <button
          onClick={closeLoginModal}
          className="absolute top-5 right-5 text-slate-400 hover:text-white p-1 rounded-xl hover:bg-slate-800 transition-colors"
          title="Fechar"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Modal Header */}
        <div className="flex items-center gap-3 mb-6">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-blue-600 to-indigo-600 flex items-center justify-center text-white shadow-lg shadow-blue-500/20">
            <Lock className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-lg font-bold tracking-tight text-white font-['Outfit']">
              Acesso Administrativo
            </h2>
            <p className="text-xs text-slate-400">
              {targetRedirectMode === 'superadmin' && 'Autenticação de Administrador Global (Master)'}
              {targetRedirectMode === 'tenant_admin' && 'Autenticação de Administrador da Loja (Tenant Admin)'}
              {!targetRedirectMode && 'Entre com sua conta Supabase'}
            </p>
          </div>
        </div>

        {/* Configuration Warning if Supabase is not configured */}
        {!isConfigured && (
          <div className="mb-5 p-3.5 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-300 text-xs flex items-start gap-2.5">
            <Info className="w-4 h-4 shrink-0 mt-0.5" />
            <div className="leading-relaxed">
              <strong>Supabase não conectado:</strong> Configure as variáveis <code className="bg-black/30 px-1 py-0.5 rounded text-[11px]">VITE_SUPABASE_URL</code> e <code className="bg-black/30 px-1 py-0.5 rounded text-[11px]">VITE_SUPABASE_PUBLISHABLE_KEY</code> para autenticar contas reais via <code className="bg-black/30 px-1 py-0.5 rounded text-[11px]">auth.users</code>.
            </div>
          </div>
        )}

        {/* Error Alert */}
        {errorMessage && (
          <div className="mb-5 p-3.5 rounded-2xl bg-red-500/10 border border-red-500/20 text-red-300 text-xs flex items-start gap-2.5">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <div className="leading-relaxed font-medium">{errorMessage}</div>
          </div>
        )}

        {/* Login Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1.5">
              E-mail da Conta
            </label>
            <div className="relative">
              <Mail className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="seu.email@empresa.com"
                className="w-full pl-10 pr-4 py-2.5 bg-slate-800/80 border border-slate-700/80 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                autoFocus
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1.5">
              Senha
            </label>
            <div className="relative">
              <KeyRound className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••••••"
                className="w-full pl-10 pr-4 py-2.5 bg-slate-800/80 border border-slate-700/80 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 px-4 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-semibold rounded-xl text-xs transition-all shadow-lg shadow-blue-500/25 flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed mt-2"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Autenticando no Supabase...</span>
              </>
            ) : (
              <>
                <span>Entrar no Sistema</span>
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>
        </form>

        {/* Security / Architecture Footer Note */}
        <div className="mt-6 pt-5 border-t border-slate-800/80 text-center">
          <p className="text-[11px] text-slate-500 flex items-center justify-center gap-1.5">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
            <span>Autenticação direta via Supabase Auth & RLS nativo</span>
          </p>
        </div>
      </div>
    </div>
  );
};
