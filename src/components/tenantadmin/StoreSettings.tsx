import React, { useState, useRef, useEffect } from 'react';
import { 
  Settings, 
  Palette, 
  Phone, 
  Truck, 
  Check, 
  Sparkles, 
  Building,
  Upload,
  Trash2,
  ImageIcon,
  AlertCircle,
  Loader2,
  RefreshCw
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';
import { TenantCustomization } from '../../types';
import { 
  validateBrandingFileDeep,
  uploadTenantBranding, 
  removeTenantBranding,
  updateTenantBrandingSettings,
  rollbackUploadedFile,
  sanitizeTenantPath,
  isValidUUID,
  UploadResult
} from '../../services/brandingStorageService';

export const StoreSettings: React.FC = () => {
  const { currentTenant, updateTenantCustomization, showToast } = useApp();
  const { authTenantId, authTenant } = useAuth();

  // Resolução canônica de UUID do Tenant - Fail Closed
  const [resolvedTenantUuid, setResolvedTenantUuid] = useState<string | null>(() => {
    if (isValidUUID(authTenantId)) return authTenantId;
    if (isValidUUID(authTenant?.id)) return authTenant?.id || null;
    if (isValidUUID(currentTenant.id)) return currentTenant.id;
    return null;
  });

  useEffect(() => {
    let isMounted = true;
    async function resolveUuid() {
      if (isValidUUID(authTenantId)) {
        setResolvedTenantUuid(authTenantId);
        return;
      }
      if (isValidUUID(authTenant?.id)) {
        setResolvedTenantUuid(authTenant?.id || null);
        return;
      }
      if (isValidUUID(currentTenant.id)) {
        setResolvedTenantUuid(currentTenant.id);
        return;
      }
      // Resolução via tenant_public_settings pelo slug oficial
      try {
        const slugQuery = currentTenant.slug || currentTenant.id;
        const { data } = await supabase
          .from('tenant_public_settings')
          .select('tenant_id')
          .eq('slug', slugQuery)
          .maybeSingle();

        if (isMounted && data?.tenant_id && isValidUUID(data.tenant_id)) {
          setResolvedTenantUuid(data.tenant_id);
        }
      } catch (err) {
        console.warn('[StoreSettings] Falha na resolução de UUID do tenant:', err);
      }
    }
    resolveUuid();
    return () => { isMounted = false; };
  }, [authTenantId, authTenant?.id, currentTenant.id, currentTenant.slug]);

  const [formData, setFormData] = useState<TenantCustomization>({
    ...currentTenant.customization
  });

  // Upload States - Logo
  const logoInputRef = useRef<HTMLInputElement | null>(null);
  const logoObjectUrlRef = useRef<string | null>(null);
  const [selectedLogoFile, setSelectedLogoFile] = useState<File | null>(null);
  const [logoPreviewUrl, setLogoPreviewUrl] = useState<string | null>(formData.logoUrl || null);
  const [logoError, setLogoError] = useState<string | null>(null);

  // Upload States - Banner
  const bannerInputRef = useRef<HTMLInputElement | null>(null);
  const bannerObjectUrlRef = useRef<string | null>(null);
  const [selectedBannerFile, setSelectedBannerFile] = useState<File | null>(null);
  const [bannerPreviewUrl, setBannerPreviewUrl] = useState<string | null>(formData.bannerUrl || null);
  const [bannerError, setBannerError] = useState<string | null>(null);

  // General & Concurrency States
  const [isSaving, setIsSaving] = useState(false);
  const [isRemovingLogo, setIsRemovingLogo] = useState(false);
  const [isRemovingBanner, setIsRemovingBanner] = useState(false);
  const [isSaved, setIsSaved] = useState(false);
  const [globalError, setGlobalError] = useState<string | null>(null);

  const isBusy = isSaving || isRemovingLogo || isRemovingBanner;

  // Cleanup de Object URLs no unmount para evitar vazamentos de memória no navegador
  useEffect(() => {
    return () => {
      if (logoObjectUrlRef.current) {
        URL.revokeObjectURL(logoObjectUrlRef.current);
        logoObjectUrlRef.current = null;
      }
      if (bannerObjectUrlRef.current) {
        URL.revokeObjectURL(bannerObjectUrlRef.current);
        bannerObjectUrlRef.current = null;
      }
    };
  }, []);

  // Handler: Selecionar Logomarca com validação profunda (MIME + Magic Bytes) e controle de ObjectURL
  const handleLogoFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (isBusy) return;
    setLogoError(null);
    const file = e.target.files?.[0];
    if (!file) return;

    if (!resolvedTenantUuid || !isValidUUID(resolvedTenantUuid)) {
      setLogoError('Identificador do tenant inválido ou não autenticado (UUID obrigatório). Upload bloqueado.');
      if (logoInputRef.current) logoInputRef.current.value = '';
      return;
    }

    const validation = await validateBrandingFileDeep(file, 'logo');
    if (!validation.valid) {
      setLogoError(validation.error || 'Arquivo de imagem inválido.');
      if (logoInputRef.current) logoInputRef.current.value = '';
      return;
    }

    // Revoga Object URL anterior se houver troca de seleção
    if (logoObjectUrlRef.current) {
      URL.revokeObjectURL(logoObjectUrlRef.current);
      logoObjectUrlRef.current = null;
    }

    setSelectedLogoFile(file);
    const localPreview = URL.createObjectURL(file);
    logoObjectUrlRef.current = localPreview;
    setLogoPreviewUrl(localPreview);
  };

  // Handler: Remover Logomarca (Ordem estrita: 1. DB -> NULL, 2. Limpeza Storage se controlada, 3. Estado local)
  const handleRemoveLogo = async () => {
    if (isBusy) return;
    setLogoError(null);
    const previousLogoUrl = formData.logoUrl;

    // Revoga Object URL local se houver
    if (logoObjectUrlRef.current) {
      URL.revokeObjectURL(logoObjectUrlRef.current);
      logoObjectUrlRef.current = null;
    }

    if (!resolvedTenantUuid || !isValidUUID(resolvedTenantUuid)) {
      setLogoError('Identificador do tenant inválido (UUID obrigatório). Remoção bloqueada.');
      return;
    }

    if (previousLogoUrl) {
      setIsRemovingLogo(true);
      try {
        // 1. Atualizar referência no banco para NULL primeiro
        const dbResult = await updateTenantBrandingSettings(resolvedTenantUuid, { logoUrl: null });
        if (!dbResult.success) {
          setLogoError(dbResult.error || 'Falha ao remover logomarca no banco de dados.');
          return;
        }

        // 2. Banco confirmado: atualiza estado local e contexto
        setSelectedLogoFile(null);
        setLogoPreviewUrl(null);
        setFormData(prev => ({ ...prev, logoUrl: '' }));
        updateTenantCustomization(currentTenant.id, { logoUrl: '' });
        if (logoInputRef.current) {
          logoInputRef.current.value = '';
        }

        // 3. Tenta remover arquivo do Storage (Fail-Closed para URLs externas ou outros buckets)
        await removeTenantBranding(resolvedTenantUuid, 'logo', previousLogoUrl);
        showToast('Logomarca removida com sucesso.');
      } catch (err: any) {
        setLogoError(err?.message || 'Erro inesperado ao remover logomarca.');
      } finally {
        setIsRemovingLogo(false);
      }
    } else {
      // Se era apenas arquivo selecionado localmente sem persistência anterior
      setSelectedLogoFile(null);
      setLogoPreviewUrl(null);
      if (logoInputRef.current) {
        logoInputRef.current.value = '';
      }
    }
  };

  // Handler: Selecionar Banner com validação profunda (MIME + Magic Bytes) e controle de ObjectURL
  const handleBannerFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (isBusy) return;
    setBannerError(null);
    const file = e.target.files?.[0];
    if (!file) return;

    if (!resolvedTenantUuid || !isValidUUID(resolvedTenantUuid)) {
      setBannerError('Identificador do tenant inválido ou não autenticado (UUID obrigatório). Upload bloqueado.');
      if (bannerInputRef.current) bannerInputRef.current.value = '';
      return;
    }

    const validation = await validateBrandingFileDeep(file, 'banner');
    if (!validation.valid) {
      setBannerError(validation.error || 'Arquivo de banner inválido.');
      if (bannerInputRef.current) bannerInputRef.current.value = '';
      return;
    }

    // Revoga Object URL anterior se houver troca de seleção
    if (bannerObjectUrlRef.current) {
      URL.revokeObjectURL(bannerObjectUrlRef.current);
      bannerObjectUrlRef.current = null;
    }

    setSelectedBannerFile(file);
    const localPreview = URL.createObjectURL(file);
    bannerObjectUrlRef.current = localPreview;
    setBannerPreviewUrl(localPreview);
  };

  // Handler: Remover Banner (Ordem estrita: 1. DB -> NULL, 2. Limpeza Storage se controlada, 3. Estado local)
  const handleRemoveBanner = async () => {
    if (isBusy) return;
    setBannerError(null);
    const previousBannerUrl = formData.bannerUrl;

    // Revoga Object URL local se houver
    if (bannerObjectUrlRef.current) {
      URL.revokeObjectURL(bannerObjectUrlRef.current);
      bannerObjectUrlRef.current = null;
    }

    if (!resolvedTenantUuid || !isValidUUID(resolvedTenantUuid)) {
      setBannerError('Identificador do tenant inválido (UUID obrigatório). Remoção bloqueada.');
      return;
    }

    if (previousBannerUrl) {
      setIsRemovingBanner(true);
      try {
        // 1. Atualizar referência no banco para NULL primeiro
        const dbResult = await updateTenantBrandingSettings(resolvedTenantUuid, { bannerUrl: null });
        if (!dbResult.success) {
          setBannerError(dbResult.error || 'Falha ao remover banner de capa no banco de dados.');
          return;
        }

        // 2. Banco confirmado: atualiza estado local e contexto
        setSelectedBannerFile(null);
        setBannerPreviewUrl(null);
        setFormData(prev => ({ ...prev, bannerUrl: '' }));
        updateTenantCustomization(currentTenant.id, { bannerUrl: '' });
        if (bannerInputRef.current) {
          bannerInputRef.current.value = '';
        }

        // 3. Tenta remover arquivo do Storage (Fail-Closed para URLs externas ou outros buckets)
        await removeTenantBranding(resolvedTenantUuid, 'banner', previousBannerUrl);
        showToast('Banner de capa removido com sucesso.');
      } catch (err: any) {
        setBannerError(err?.message || 'Erro inesperado ao remover banner de capa.');
      } finally {
        setIsRemovingBanner(false);
      }
    } else {
      // Se era apenas arquivo selecionado localmente sem persistência anterior
      setSelectedBannerFile(null);
      setBannerPreviewUrl(null);
      if (bannerInputRef.current) {
        bannerInputRef.current.value = '';
      }
    }
  };

  // Submit Geral: Fluxo com consistência por compensação e rollback compensatório
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isBusy) return;
    setIsSaving(true);
    setGlobalError(null);
    setLogoError(null);
    setBannerError(null);

    // Fail-closed se o UUID do tenant não for estritamente válido
    if (!resolvedTenantUuid || !isValidUUID(resolvedTenantUuid)) {
      setGlobalError('Não foi possível identificar o UUID do tenant autenticado. Ação bloqueada por segurança.');
      setIsSaving(false);
      return;
    }

    const previousLogoUrl = formData.logoUrl;
    const previousBannerUrl = formData.bannerUrl;

    let newLogoUpload: UploadResult | null = null;
    let newBannerUpload: UploadResult | null = null;

    try {
      // 1. Upload de Logo se houver novo arquivo selecionado
      if (selectedLogoFile) {
        newLogoUpload = await uploadTenantBranding(resolvedTenantUuid, selectedLogoFile, 'logo');
        if (newLogoUpload.error || !newLogoUpload.url) {
          setLogoError(newLogoUpload.error || 'Erro no envio da logomarca.');
          setIsSaving(false);
          return;
        }
      }

      // 2. Upload de Banner se houver novo arquivo selecionado
      if (selectedBannerFile) {
        newBannerUpload = await uploadTenantBranding(resolvedTenantUuid, selectedBannerFile, 'banner');
        if (newBannerUpload.error || !newBannerUpload.url) {
          // COMPENSAÇÃO CRÍTICA (Caso logo sucesso e banner falha):
          // Rollback imediato da logo recém-enviada para não deixar objeto órfão
          if (newLogoUpload?.url) {
            await rollbackUploadedFile(newLogoUpload.url, resolvedTenantUuid);
          }
          setBannerError(newBannerUpload.error || 'Erro no envio do banner.');
          setIsSaving(false);
          return;
        }
      }

      const finalLogoUrl = newLogoUpload?.url ? newLogoUpload.url : formData.logoUrl;
      const finalBannerUrl = newBannerUpload?.url ? newBannerUpload.url : formData.bannerUrl;

      // 3. Gravação no banco (tenant_public_settings)
      // Executado com consistência por compensação ANTES de apagar imagens antigas
      const dbResult = await updateTenantBrandingSettings(resolvedTenantUuid, {
        logoUrl: finalLogoUrl || null,
        bannerUrl: finalBannerUrl || null,
      });

      if (!dbResult.success) {
        // COMPENSAÇÃO CRÍTICA (Caso banco falhe):
        // Rollback dos DOIS novos objetos recém-enviados do Storage
        if (newLogoUpload?.url) {
          await rollbackUploadedFile(newLogoUpload.url, resolvedTenantUuid);
        }
        if (newBannerUpload?.url) {
          await rollbackUploadedFile(newBannerUpload.url, resolvedTenantUuid);
        }
        setGlobalError(dbResult.error || 'Falha ao salvar configurações no banco de dados. O upload foi revertido para manter a consistência.');
        setIsSaving(false);
        return;
      }

      // 4. Sucesso confirmado no banco: agora sim atualiza o estado local e contexto
      // Revoga Object URLs locais de preview concluídos
      if (logoObjectUrlRef.current) {
        URL.revokeObjectURL(logoObjectUrlRef.current);
        logoObjectUrlRef.current = null;
      }
      if (bannerObjectUrlRef.current) {
        URL.revokeObjectURL(bannerObjectUrlRef.current);
        bannerObjectUrlRef.current = null;
      }

      const updatedCustomization: TenantCustomization = {
        ...formData,
        logoUrl: finalLogoUrl || '',
        bannerUrl: finalBannerUrl || '',
      };

      setFormData(updatedCustomization);
      setSelectedLogoFile(null);
      setSelectedBannerFile(null);
      updateTenantCustomization(currentTenant.id, updatedCustomization);

      // 5. Limpeza de substituição: apaga do Storage as imagens antigas substituídas
      // Apenas se a URL pertencer comprovadamente a este tenant e ao bucket tenant-assets
      if (newLogoUpload?.url && previousLogoUrl && previousLogoUrl !== finalLogoUrl) {
        await removeTenantBranding(resolvedTenantUuid, 'logo', previousLogoUrl);
      }
      if (newBannerUpload?.url && previousBannerUrl && previousBannerUrl !== finalBannerUrl) {
        await removeTenantBranding(resolvedTenantUuid, 'banner', previousBannerUrl);
      }

      setIsSaved(true);
      showToast('Configurações da loja e imagens salvas com sucesso!');
      setTimeout(() => setIsSaved(false), 3500);
    } catch (err: any) {
      // Rollback compensatório em caso de exceção inesperada
      if (newLogoUpload?.url) await rollbackUploadedFile(newLogoUpload.url, resolvedTenantUuid);
      if (newBannerUpload?.url) await rollbackUploadedFile(newBannerUpload.url, resolvedTenantUuid);
      setGlobalError(err?.message || 'Erro inesperado ao salvar as configurações.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 font-['Outfit'] flex items-center gap-2">
            <Settings className="w-5 h-5 text-blue-600" />
            Identidade Visual, Contatos & Regras de Venda
          </h2>
          <p className="text-xs text-slate-600">
            Personalize a aparência do catálogo, WhatsApp de recebimento de pedidos, chave PIX e políticas de frete de {currentTenant.name}
          </p>
        </div>

        <button
          type="button"
          onClick={handleSubmit}
          disabled={isBusy}
          className="px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold flex items-center gap-2 shadow-md shadow-blue-600/20 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isSaving ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Salvando Imagens & Dados...
            </>
          ) : isSaved ? (
            <>
              <Check className="w-4 h-4" />
              Alterações Salvas!
            </>
          ) : (
            <>
              <Sparkles className="w-4 h-4" />
              Salvar Configurações
            </>
          )}
        </button>
      </div>

      {globalError && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-2xl flex items-center gap-3 text-red-800 text-xs font-medium">
          <AlertCircle className="w-5 h-5 text-red-600 shrink-0" />
          <span>{globalError}</span>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        
        {/* Basic Store Info */}
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs space-y-4">
          <div className="text-sm font-bold text-slate-900 flex items-center gap-2 border-b border-slate-100 pb-3">
            <Building className="w-4 h-4 text-blue-600" />
            Dados da Empresa & Domínio
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                Razão Social / Nome da Empresa
              </label>
              <input
                type="text"
                value={formData.businessName}
                onChange={e => setFormData({ ...formData, businessName: e.target.value })}
                className="w-full px-3.5 py-2 rounded-xl bg-white border border-slate-300 text-sm font-medium text-slate-900 placeholder:text-slate-400 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                Nome Fantasia (Exibido no Topo)
              </label>
              <input
                type="text"
                value={formData.tradeName || ''}
                onChange={e => setFormData({ ...formData, tradeName: e.target.value })}
                className="w-full px-3.5 py-2 rounded-xl bg-white border border-slate-300 text-sm font-bold text-slate-900 placeholder:text-slate-400 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 focus:outline-none"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                CNPJ / CPF
              </label>
              <input
                type="text"
                value={formData.cnpjCpf || ''}
                onChange={e => setFormData({ ...formData, cnpjCpf: e.target.value })}
                placeholder="00.000.000/0001-00"
                className="w-full px-3.5 py-2 rounded-xl bg-white border border-slate-300 text-sm font-medium text-slate-900 placeholder:text-slate-400 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 focus:outline-none font-mono"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                Slug do Catálogo
              </label>
              <input
                type="text"
                value={formData.slug}
                onChange={e => setFormData({ ...formData, slug: e.target.value })}
                className="w-full px-3.5 py-2 rounded-xl bg-white border border-slate-300 text-sm font-mono text-blue-700 font-bold focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                Domínio Personalizado (Opcional)
              </label>
              <input
                type="text"
                value={formData.customDomain || ''}
                onChange={e => setFormData({ ...formData, customDomain: e.target.value })}
                placeholder="catalogo.minhaempresa.com.br"
                className="w-full px-3.5 py-2 rounded-xl bg-white border border-slate-300 text-sm font-mono font-medium text-slate-900 placeholder:text-slate-400 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 focus:outline-none"
              />
            </div>
          </div>
        </div>

        {/* Visual Identity & Branding with Real Upload */}
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs space-y-5">
          <div className="text-sm font-bold text-slate-900 flex items-center gap-2 border-b border-slate-100 pb-3">
            <Palette className="w-4 h-4 text-blue-600" />
            Identidade Visual & Mídia da Loja (Upload Oficial)
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                Cor Principal da Loja (Botões, Destaques)
              </label>
              <div className="flex items-center gap-3">
                <input
                  type="color"
                  value={formData.primaryColor}
                  onChange={e => setFormData({ ...formData, primaryColor: e.target.value })}
                  className="w-10 h-10 rounded-xl border border-slate-300 cursor-pointer p-0.5 bg-white shrink-0"
                />
                <input
                  type="text"
                  value={formData.primaryColor}
                  onChange={e => setFormData({ ...formData, primaryColor: e.target.value })}
                  className="w-full px-3.5 py-2 rounded-xl bg-white border border-slate-300 text-xs font-mono font-bold text-slate-900 placeholder:text-slate-400 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 focus:outline-none"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                Texto da Faixa Superior de Anúncios / Avisos
              </label>
              <input
                type="text"
                value={formData.announcementText || ''}
                onChange={e => setFormData({ ...formData, announcementText: e.target.value })}
                placeholder="Ex: 📦 Pedido mínimo de R$ 400 | Frete Grátis na Grande Curitiba"
                className="w-full px-3.5 py-2 rounded-xl bg-white border border-slate-300 text-sm font-medium text-slate-900 placeholder:text-slate-400 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 focus:outline-none"
              />
            </div>
          </div>

          {/* Section: Upload Logomarca & Upload Banner */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-2">
            
            {/* Campo: Logomarca */}
            <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <label className="block text-xs font-bold text-slate-800 uppercase tracking-wider">
                    Logomarca da Loja
                  </label>
                  <p className="text-[11px] text-slate-500">
                    Formatos: JPG, PNG ou WebP (Máx: 2 MB)
                  </p>
                </div>

                {logoPreviewUrl && (
                  <button
                    type="button"
                    onClick={handleRemoveLogo}
                    disabled={isBusy}
                    className="text-xs font-bold text-red-600 hover:text-red-700 flex items-center gap-1 hover:underline cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isRemovingLogo ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        Removendo...
                      </>
                    ) : (
                      <>
                        <Trash2 className="w-3.5 h-3.5" />
                        Remover
                      </>
                    )}
                  </button>
                )}
              </div>

              {/* Preview Box Logo */}
              <div className="flex items-center gap-4 bg-white p-3 rounded-xl border border-slate-200">
                <div className="w-20 h-20 rounded-xl bg-slate-100 border border-slate-200 flex items-center justify-center overflow-hidden shrink-0">
                  {logoPreviewUrl ? (
                    <img 
                      src={logoPreviewUrl} 
                      alt="Preview da Logomarca" 
                      className="w-full h-full object-contain p-1"
                    />
                  ) : (
                    <ImageIcon className="w-8 h-8 text-slate-300" />
                  )}
                </div>

                <div className="space-y-1.5 flex-1 min-w-0">
                  <input
                    ref={logoInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    onChange={handleLogoFileChange}
                    disabled={isBusy}
                    className="hidden"
                    id="tenant-logo-file-input"
                  />
                  
                  <button
                    type="button"
                    onClick={() => logoInputRef.current?.click()}
                    disabled={isBusy}
                    className="px-3.5 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer transition-colors shadow-xs disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Upload className="w-3.5 h-3.5" />
                    {selectedLogoFile ? 'Trocar Imagem' : 'Selecionar Imagem'}
                  </button>

                  {selectedLogoFile && (
                    <p className="text-[11px] text-blue-700 font-medium truncate">
                      ✓ Selecionado: {selectedLogoFile.name} ({(selectedLogoFile.size / 1024).toFixed(0)} KB)
                    </p>
                  )}
                  {!selectedLogoFile && logoPreviewUrl && (
                    <p className="text-[11px] text-emerald-700 font-medium truncate">
                      ✓ Logomarca ativa
                    </p>
                  )}
                  {!selectedLogoFile && !logoPreviewUrl && (
                    <p className="text-[11px] text-slate-400">
                      Nenhuma imagem selecionada
                    </p>
                  )}
                </div>
              </div>

              {logoError && (
                <p className="text-xs text-red-600 font-medium flex items-center gap-1">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                  {logoError}
                </p>
              )}
            </div>

            {/* Campo: Banner de Capa */}
            <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <label className="block text-xs font-bold text-slate-800 uppercase tracking-wider">
                    Banner de Capa
                  </label>
                  <p className="text-[11px] text-slate-500">
                    Formatos: JPG, PNG ou WebP (Máx: 5 MB)
                  </p>
                </div>

                {bannerPreviewUrl && (
                  <button
                    type="button"
                    onClick={handleRemoveBanner}
                    disabled={isBusy}
                    className="text-xs font-bold text-red-600 hover:text-red-700 flex items-center gap-1 hover:underline cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isRemovingBanner ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        Removendo...
                      </>
                    ) : (
                      <>
                        <Trash2 className="w-3.5 h-3.5" />
                        Remover
                      </>
                    )}
                  </button>
                )}
              </div>

              {/* Preview Box Banner */}
              <div className="space-y-3 bg-white p-3 rounded-xl border border-slate-200">
                <div className="w-full h-24 rounded-xl bg-slate-100 border border-slate-200 flex items-center justify-center overflow-hidden">
                  {bannerPreviewUrl ? (
                    <img 
                      src={bannerPreviewUrl} 
                      alt="Preview do Banner de Capa" 
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="flex flex-col items-center justify-center gap-1 text-slate-300">
                      <ImageIcon className="w-8 h-8" />
                      <span className="text-[10px] text-slate-400">Sem banner configurado</span>
                    </div>
                  )}
                </div>

                <div className="flex items-center justify-between gap-2">
                  <input
                    ref={bannerInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    onChange={handleBannerFileChange}
                    disabled={isBusy}
                    className="hidden"
                    id="tenant-banner-file-input"
                  />

                  <button
                    type="button"
                    onClick={() => bannerInputRef.current?.click()}
                    disabled={isBusy}
                    className="px-3.5 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer transition-colors shadow-xs disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Upload className="w-3.5 h-3.5" />
                    {selectedBannerFile ? 'Trocar Banner' : 'Selecionar Banner'}
                  </button>

                  {selectedBannerFile && (
                    <p className="text-[11px] text-blue-700 font-medium truncate text-right">
                      ✓ {selectedBannerFile.name} ({(selectedBannerFile.size / 1024).toFixed(0)} KB)
                    </p>
                  )}
                  {!selectedBannerFile && bannerPreviewUrl && (
                    <p className="text-[11px] text-emerald-700 font-medium truncate text-right">
                      ✓ Banner ativo
                    </p>
                  )}
                </div>
              </div>

              {bannerError && (
                <p className="text-xs text-red-600 font-medium flex items-center gap-1">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                  {bannerError}
                </p>
              )}
            </div>

          </div>
        </div>

        {/* WhatsApp & Pix */}
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs space-y-4">
          <div className="text-sm font-bold text-slate-900 flex items-center gap-2 border-b border-slate-100 pb-3">
            <Phone className="w-4 h-4 text-emerald-600" />
            WhatsApp de Pedidos & Pagamento PIX
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                WhatsApp que Receberá os Pedidos *
              </label>
              <input
                type="text"
                value={formData.whatsappNumber}
                onChange={e => setFormData({ ...formData, whatsappNumber: e.target.value })}
                placeholder="5541992928033"
                className="w-full px-3.5 py-2 rounded-xl bg-white border border-slate-300 text-sm font-mono text-emerald-700 font-bold placeholder:text-slate-400 focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                Chave PIX da Empresa
              </label>
              <input
                type="text"
                value={formData.pixKey || ''}
                onChange={e => setFormData({ ...formData, pixKey: e.target.value })}
                placeholder="CNPJ, CPF, E-mail ou Telefone"
                className="w-full px-3.5 py-2 rounded-xl bg-white border border-slate-300 text-sm font-mono font-medium text-slate-900 placeholder:text-slate-400 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                Tipo da Chave PIX
              </label>
              <select
                value={formData.pixKeyType || 'cnpj'}
                onChange={e => setFormData({ ...formData, pixKeyType: e.target.value as any })}
                className="w-full px-3.5 py-2 rounded-xl bg-white border border-slate-300 text-sm font-medium text-slate-900 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 focus:outline-none cursor-pointer"
              >
                <option value="cnpj">CNPJ</option>
                <option value="cpf">CPF</option>
                <option value="email">E-mail</option>
                <option value="phone">Telefone</option>
                <option value="random">Chave Aleatória</option>
              </select>
            </div>
          </div>
        </div>

        {/* Commercial Policies & B2B Rules */}
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs space-y-4">
          <div className="text-sm font-bold text-slate-900 flex items-center gap-2 border-b border-slate-100 pb-3">
            <Truck className="w-4 h-4 text-blue-600" />
            Políticas Comerciais & Atacado B2B
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                Valor do Pedido Mínimo Varejo (R$)
              </label>
              <input
                type="number"
                step="0.01"
                value={formData.minOrderValue}
                onChange={e => setFormData({ ...formData, minOrderValue: Number(e.target.value) })}
                className="w-full px-3.5 py-2 rounded-xl bg-white border border-slate-300 text-sm font-bold text-slate-900 placeholder:text-slate-400 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 focus:outline-none"
              />
              <p className="text-[11px] text-slate-500 mt-1">O cliente não poderá finalizar pedidos de varejo abaixo deste valor.</p>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                Frete Fixo (R$)
              </label>
              <input
                type="number"
                step="0.01"
                value={formData.deliveryMethods.fixedFreightValue || 0}
                onChange={e => setFormData({
                  ...formData,
                  deliveryMethods: {
                    ...formData.deliveryMethods,
                    fixedFreightValue: Number(e.target.value)
                  }
                })}
                className="w-full px-3.5 py-2 rounded-xl bg-white border border-slate-300 text-sm font-medium text-slate-900 placeholder:text-slate-400 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                Frete Grátis a Partir de (R$)
              </label>
              <input
                type="number"
                step="0.01"
                value={formData.deliveryMethods.freeFreightThreshold || 0}
                onChange={e => setFormData({
                  ...formData,
                  deliveryMethods: {
                    ...formData.deliveryMethods,
                    freeFreightThreshold: Number(e.target.value)
                  }
                })}
                className="w-full px-3.5 py-2 rounded-xl bg-white border border-slate-300 text-sm text-emerald-700 font-bold placeholder:text-slate-400 focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 focus:outline-none"
              />
            </div>
          </div>

          <div className="pt-2 border-t border-slate-100 flex flex-col sm:flex-row gap-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={formData.allowB2BMode}
                onChange={e => setFormData({ ...formData, allowB2BMode: e.target.checked })}
                className="w-4 h-4 text-blue-600 rounded border-slate-300 focus:ring-blue-500"
              />
              <span className="text-xs font-bold text-slate-800">
                Ativar "Grade de Pedido Rápido B2B" no catálogo
              </span>
            </label>

            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={formData.enableResendEmail}
                onChange={e => setFormData({ ...formData, enableResendEmail: e.target.checked })}
                className="w-4 h-4 text-blue-600 rounded border-slate-300 focus:ring-blue-500"
              />
              <span className="text-xs font-bold text-slate-800">
                Enviar cópia do pedido por e-mail via Resend
              </span>
            </label>
          </div>

        </div>

      </form>

    </div>
  );
};
