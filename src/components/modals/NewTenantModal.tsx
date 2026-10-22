import React, { useState } from 'react';
import { X, Building, Check, Sparkles, AlertCircle } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { PlanType, Tenant } from '../../types';
import { SAAS_PLANS } from '../../data/initialData';

export const NewTenantModal: React.FC<{ isOpen: boolean; onClose: () => void }> = ({ isOpen, onClose }) => {
  const { addTenant } = useApp();

  const [formData, setFormData] = useState({
    name: '',
    tradeName: '',
    slug: '',
    segment: 'Alimentos e Distribuição',
    ownerName: '',
    ownerEmail: '',
    ownerPhone: '',
    cnpjCpf: '',
    plan: 'pro' as PlanType,
    primaryColor: '#0284c7',
    minOrderValue: 150,
    allowB2BMode: true,
    whatsappNumber: ''
  });

  const [errors, setErrors] = useState<Record<string, string>>({});

  if (!isOpen) return null;

  const handleSlugGenerate = (name: string) => {
    const generated = name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
    return generated;
  };

  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setFormData(prev => ({
      ...prev,
      name: val,
      tradeName: prev.tradeName || val,
      slug: handleSlugGenerate(val)
    }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const newErrors: Record<string, string> = {};

    if (!formData.name.trim()) newErrors.name = 'Nome da empresa é obrigatório';
    if (!formData.slug.trim()) newErrors.slug = 'Slug da URL é obrigatório';
    if (!formData.ownerEmail.trim()) newErrors.ownerEmail = 'E-mail do responsável é obrigatório';
    if (!formData.whatsappNumber.trim()) newErrors.whatsappNumber = 'WhatsApp para receber pedidos é obrigatório';

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    const cleanWhatsapp = formData.whatsappNumber.replace(/\D/g, '');

    addTenant({
      name: formData.name,
      slug: formData.slug,
      ownerEmail: formData.ownerEmail,
      ownerName: formData.ownerName || formData.name,
      ownerPhone: formData.ownerPhone || formData.whatsappNumber,
      plan: formData.plan,
      status: 'active',
      customization: {
        businessName: formData.name,
        tradeName: formData.tradeName || formData.name,
        cnpjCpf: formData.cnpjCpf,
        segment: formData.segment,
        slug: formData.slug,
        customDomain: `${formData.slug}.suaplataforma.com.br`,
        logoUrl: 'https://images.unsplash.com/photo-1578575437130-527eed3abbec?w=200&auto=format&fit=crop&q=80',
        bannerUrl: 'https://images.unsplash.com/photo-1586528116311-ad8dd3c8310d?w=1200&auto=format&fit=crop&q=80',
        primaryColor: formData.primaryColor,
        accentColor: '#0f172a',
        whatsappNumber: cleanWhatsapp.startsWith('55') ? cleanWhatsapp : `55${cleanWhatsapp}`,
        emailContact: formData.ownerEmail,
        minOrderValue: Number(formData.minOrderValue) || 0,
        allowB2BMode: formData.allowB2BMode,
        hidePricesWithoutLogin: false,
        enableResendEmail: true,
        resendSenderEmail: `pedidos@${formData.slug}.com.br`,
        deliveryMethods: {
          pickup: true,
          carrierDelivery: true,
          fixedFreight: true,
          fixedFreightValue: 25.00,
          freeFreightThreshold: 800.00
        },
        announcementText: `Bem-vindo ao catálogo oficial de ${formData.name}! Faça seu pedido direto no WhatsApp.`
      }
    });

    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-xs overflow-y-auto">
      <div className="bg-white rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto shadow-2xl border border-slate-200">
        
        {/* Modal Header */}
        <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50/80 rounded-t-2xl">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-600 text-white flex items-center justify-center font-bold shadow-md shadow-blue-500/20">
              <Building className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-900 font-['Outfit']">Criar Nova Loja / Empresa (Tenant)</h2>
              <p className="text-xs text-slate-500">Provisione um catálogo exclusivo com subdomain e banco isolado</p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="w-8 h-8 rounded-full hover:bg-slate-200 text-slate-500 flex items-center justify-center transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                Nome da Empresa / Razão Social *
              </label>
              <input
                type="text"
                value={formData.name}
                onChange={handleNameChange}
                placeholder="Ex: MC Distribuição, Alimentos Silva..."
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              {errors.name && <p className="text-red-500 text-xs mt-1">{errors.name}</p>}
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                Nome Fantasia / Marca
              </label>
              <input
                type="text"
                value={formData.tradeName}
                onChange={e => setFormData({ ...formData, tradeName: e.target.value })}
                placeholder="Como o cliente conhece"
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                Slug da URL / Subdomínio *
              </label>
              <div className="flex items-center rounded-xl border border-slate-300 overflow-hidden focus-within:ring-2 focus-within:ring-blue-500">
                <span className="bg-slate-100 px-3 py-2.5 text-xs text-slate-500 border-r border-slate-300 font-mono">
                  app.com/
                </span>
                <input
                  type="text"
                  value={formData.slug}
                  onChange={e => setFormData({ ...formData, slug: handleSlugGenerate(e.target.value) })}
                  placeholder="mc-distribuicao"
                  className="w-full px-3 py-2 text-sm focus:outline-none font-mono text-blue-700 font-semibold"
                />
              </div>
              {errors.slug && <p className="text-red-500 text-xs mt-1">{errors.slug}</p>}
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                Segmento / Nicho
              </label>
              <input
                type="text"
                value={formData.segment}
                onChange={e => setFormData({ ...formData, segment: e.target.value })}
                placeholder="Ex: Distribuidora de Bebidas, Roupas, Autopeças"
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          {/* WhatsApp & Owner */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                WhatsApp de Pedidos *
              </label>
              <input
                type="text"
                value={formData.whatsappNumber}
                onChange={e => setFormData({ ...formData, whatsappNumber: e.target.value })}
                placeholder="11987654321 (com DDD)"
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <p className="text-[11px] text-slate-400 mt-1">Os pedidos dos clientes serão enviados para este número.</p>
              {errors.whatsappNumber && <p className="text-red-500 text-xs mt-1">{errors.whatsappNumber}</p>}
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                E-mail do Proprietário / Admin *
              </label>
              <input
                type="email"
                value={formData.ownerEmail}
                onChange={e => setFormData({ ...formData, ownerEmail: e.target.value })}
                placeholder="dono@empresa.com.br"
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              {errors.ownerEmail && <p className="text-red-500 text-xs mt-1">{errors.ownerEmail}</p>}
            </div>
          </div>

          {/* Plan Selection */}
          <div>
            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-2">
              Plano de Assinatura SaaS Inicial
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {SAAS_PLANS.map((p) => (
                <div
                  key={p.id}
                  onClick={() => setFormData({ ...formData, plan: p.id })}
                  className={`p-3.5 rounded-xl border-2 cursor-pointer transition-all ${
                    formData.plan === p.id
                      ? 'border-blue-600 bg-blue-50/60 shadow-sm'
                      : 'border-slate-200 hover:border-slate-300'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-xs text-slate-900">{p.name}</span>
                    {formData.plan === p.id && <Check className="w-4 h-4 text-blue-600" />}
                  </div>
                  <div className="text-base font-extrabold text-blue-700 mt-1">
                    R$ {p.priceMonthly.toFixed(2).replace('.', ',')}<span className="text-[10px] text-slate-500 font-normal">/mês</span>
                  </div>
                  <div className="text-[11px] text-slate-600 mt-1">
                    Até {p.maxProducts} produtos • {p.maxUsers} usuários
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Color & B2B Options */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2 border-t border-slate-100">
            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                Cor Primária da Marca
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={formData.primaryColor}
                  onChange={e => setFormData({ ...formData, primaryColor: e.target.value })}
                  className="w-9 h-9 rounded-lg border border-slate-300 cursor-pointer p-0.5"
                />
                <input
                  type="text"
                  value={formData.primaryColor}
                  onChange={e => setFormData({ ...formData, primaryColor: e.target.value })}
                  className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 text-xs font-mono"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                Pedido Mínimo (R$)
              </label>
              <input
                type="number"
                value={formData.minOrderValue}
                onChange={e => setFormData({ ...formData, minOrderValue: Number(e.target.value) })}
                className="w-full px-3 py-2 rounded-xl border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div className="flex flex-col justify-end">
              <label className="flex items-center gap-2 cursor-pointer p-2 rounded-xl border border-slate-200 hover:bg-slate-50">
                <input
                  type="checkbox"
                  checked={formData.allowB2BMode}
                  onChange={e => setFormData({ ...formData, allowB2BMode: e.target.checked })}
                  className="w-4 h-4 text-blue-600 rounded"
                />
                <span className="text-xs font-semibold text-slate-800">Ativar Modo Atacado B2B</span>
              </label>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 rounded-xl border border-slate-300 text-slate-700 hover:bg-slate-100 text-xs font-bold transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold flex items-center gap-2 shadow-lg shadow-blue-600/30 transition-all cursor-pointer"
            >
              <Sparkles className="w-4 h-4" />
              Criar e Ativar Catálogo
            </button>
          </div>
        </form>

      </div>
    </div>
  );
};
