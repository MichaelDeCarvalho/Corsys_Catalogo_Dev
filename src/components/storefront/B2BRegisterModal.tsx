import React, { useState } from 'react';
import { Building2, X, AlertCircle, CheckCircle2, Loader2, ArrowRight } from 'lucide-react';
import { useWholesaleAccess } from '../../context/WholesaleAccessContext';
import { useApp } from '../../context/AppContext';
import { submitWholesaleApplication, validateCnpj, formatCnpj } from '../../services/wholesaleService';

export const B2BRegisterModal: React.FC = () => {
  const { isB2BRegisterModalOpen, closeB2BRegisterModal } = useWholesaleAccess();
  const { currentTenant, showToast } = useApp();

  const [cnpj, setCnpj] = useState('');
  const [legalName, setLegalName] = useState('');
  const [tradeName, setTradeName] = useState('');
  const [contactName, setContactName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  
  // Anti-spam Honeypot field (invisible to humans)
  const [honeypot, setHoneypot] = useState('');

  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  if (!isB2BRegisterModalOpen) return null;

  const handleCnpjChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    const formatted = formatCnpj(raw);
    setCnpj(formatted);
    if (errorMessage) setErrorMessage(null);
  };

  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(/\D/g, '').slice(0, 11);
    let formatted = raw;
    if (raw.length > 2 && raw.length <= 6) {
      formatted = `(${raw.slice(0, 2)}) ${raw.slice(2)}`;
    } else if (raw.length > 6) {
      formatted = `(${raw.slice(0, 2)}) ${raw.slice(2, 7)}-${raw.slice(7)}`;
    }
    setPhone(formatted);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    // 1. Validação de CNPJ
    const digitsOnly = cnpj.replace(/\D/g, '');
    const cnpjValidation = validateCnpj(digitsOnly);
    if (!cnpjValidation.valid) {
      setErrorMessage(cnpjValidation.error || 'Por favor, informe um CNPJ válido com 14 dígitos.');
      return;
    }

    // 2. Validação dos campos obrigatórios
    if (!legalName.trim() || legalName.trim().length < 3) {
      setErrorMessage('A Razão Social é obrigatória (mínimo 3 caracteres).');
      return;
    }

    if (!contactName.trim() || contactName.trim().length < 2) {
      setErrorMessage('O Nome do Responsável é obrigatório.');
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email.trim())) {
      setErrorMessage('Informe um e-mail comercial válido.');
      return;
    }

    const phoneDigits = phone.replace(/\D/g, '');
    if (phoneDigits.length < 10 || phoneDigits.length > 11) {
      setErrorMessage('Informe um WhatsApp/Telefone válido com DDD.');
      return;
    }

    const tenantSlug = currentTenant?.slug || (import.meta as any).env?.VITE_PUBLIC_TENANT_SLUG || 'corsys-catalogo-demo';

    setLoading(true);
    try {
      const res = await submitWholesaleApplication({
        tenantSlug,
        cnpj: digitsOnly,
        legalName: legalName.trim(),
        tradeName: tradeName.trim() || undefined,
        contactName: contactName.trim(),
        email: email.trim().toLowerCase(),
        phone: phone.trim(),
        city: city.trim() || undefined,
        state: state.trim().toUpperCase() || undefined,
        website: honeypot
      });

      setSuccessMessage(res.message);
      showToast('Solicitação de cadastro atacadista enviada com sucesso!');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Falha ao processar cadastro atacadista.';
      setErrorMessage(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    closeB2BRegisterModal();
    setErrorMessage(null);
    setSuccessMessage(null);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fadeIn">
      <div 
        className="bg-white rounded-3xl max-w-lg w-full p-6 sm:p-8 shadow-2xl border border-slate-100 relative overflow-hidden max-h-[92vh] flex flex-col"
        id="b2b-register-modal"
      >
        {/* Close Button */}
        <button
          onClick={handleClose}
          className="absolute top-5 right-5 p-2 rounded-full text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
          id="btn-close-b2b-register"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Modal Header */}
        <div className="flex items-center gap-3 mb-5 shrink-0">
          <div className="w-12 h-12 rounded-2xl bg-amber-50 border border-amber-100 flex items-center justify-center text-amber-600 shrink-0">
            <Building2 className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-xl font-black text-slate-900 tracking-tight">
              Cadastro de Empresa (B2B)
            </h3>
            <p className="text-xs text-slate-500">
              Preencha os dados da sua empresa para liberação das condições de atacado.
            </p>
          </div>
        </div>

        {/* Feedback Messages */}
        {errorMessage && (
          <div className="mb-4 p-3.5 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-700 flex items-start gap-2.5 shrink-0">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span className="leading-relaxed font-medium">{errorMessage}</span>
          </div>
        )}

        {successMessage ? (
          <div className="py-8 text-center space-y-4 shrink-0">
            <div className="w-16 h-16 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto border border-emerald-100">
              <CheckCircle2 className="w-8 h-8" />
            </div>
            <div className="space-y-2">
              <h4 className="text-lg font-black text-slate-900">Solicitação Enviada!</h4>
              <p className="text-sm text-slate-600 max-w-sm mx-auto leading-relaxed">
                {successMessage}
              </p>
              <p className="text-xs text-slate-400">
                Nossa equipe comercial analisará seu CNPJ e liberará o acesso atacadista.
              </p>
            </div>
            <div className="pt-4">
              <button
                onClick={handleClose}
                className="w-full py-3 px-4 rounded-xl bg-slate-900 text-white font-bold text-sm hover:bg-slate-800 transition-colors"
              >
                Entendido, voltar ao catálogo
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4 overflow-y-auto pr-1">
            {/* Honeypot field (hidden from real users, traps spam bots) */}
            <div className="hidden" aria-hidden="true">
              <input
                type="text"
                name="website"
                value={honeypot}
                onChange={(e) => setHoneypot(e.target.value)}
                tabIndex={-1}
                autoComplete="off"
              />
            </div>

            {/* CNPJ */}
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                CNPJ <span className="text-rose-500">*</span>
              </label>
              <input
                type="text"
                value={cnpj}
                onChange={handleCnpjChange}
                placeholder="00.000.000/0000-00"
                maxLength={18}
                className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-mono text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 transition-all"
                required
                id="input-b2b-cnpj"
              />
              <span className="text-[10px] text-slate-400 mt-0.5 block">
                Somente empresas ativas no território nacional.
              </span>
            </div>

            {/* Razão Social */}
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Razão Social <span className="text-rose-500">*</span>
              </label>
              <input
                type="text"
                value={legalName}
                onChange={(e) => setLegalName(e.target.value)}
                placeholder="Ex: Comercial de Alimentos e Bebidas LTDA"
                maxLength={150}
                className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 transition-all"
                required
                id="input-b2b-legal-name"
              />
            </div>

            {/* Nome Fantasia */}
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Nome Fantasia <span className="text-slate-400 text-[10px] font-normal">(Opcional)</span>
              </label>
              <input
                type="text"
                value={tradeName}
                onChange={(e) => setTradeName(e.target.value)}
                placeholder="Ex: MC Distribuição"
                maxLength={150}
                className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 transition-all"
                id="input-b2b-trade-name"
              />
            </div>

            {/* Nome do Responsável */}
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Nome do Responsável / Comprador <span className="text-rose-500">*</span>
              </label>
              <input
                type="text"
                value={contactName}
                onChange={(e) => setContactName(e.target.value)}
                placeholder="Ex: Carlos Eduardo Silva"
                maxLength={100}
                className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 transition-all"
                required
                id="input-b2b-contact-name"
              />
            </div>

            {/* E-mail e Telefone em grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  E-mail Comercial <span className="text-rose-500">*</span>
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="compras@suaempresa.com"
                  maxLength={100}
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 transition-all"
                  required
                  id="input-b2b-email"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  WhatsApp / Telefone <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  value={phone}
                  onChange={handlePhoneChange}
                  placeholder="(11) 99999-9999"
                  maxLength={15}
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 transition-all"
                  required
                  id="input-b2b-phone"
                />
              </div>
            </div>

            {/* Cidade e Estado */}
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2">
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Cidade <span className="text-slate-400 text-[10px] font-normal">(Opcional)</span>
                </label>
                <input
                  type="text"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  placeholder="Ex: São Paulo"
                  maxLength={100}
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 transition-all"
                  id="input-b2b-city"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  UF
                </label>
                <input
                  type="text"
                  value={state}
                  onChange={(e) => setState(e.target.value.toUpperCase())}
                  placeholder="SP"
                  maxLength={2}
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-900 text-center font-bold focus:bg-white focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 transition-all uppercase"
                  id="input-b2b-state"
                />
              </div>
            </div>

            {/* Privacy note */}
            <p className="text-[11px] text-slate-400 leading-tight">
              Ao enviar, você confirma que os dados cadastrais pertencem à sua pessoa jurídica e serão utilizados exclusivamente para conferência comercial e faturamento de pedidos B2B.
            </p>

            {/* Submit Button */}
            <div className="pt-2">
              <button
                type="submit"
                disabled={loading}
                className="w-full py-3.5 px-4 rounded-xl bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-slate-950 font-extrabold text-sm transition-all flex items-center justify-center gap-2 shadow-sm"
                id="btn-submit-b2b-application"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Validando e enviando...
                  </>
                ) : (
                  <>
                    Enviar Solicitação de Cadastro
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
