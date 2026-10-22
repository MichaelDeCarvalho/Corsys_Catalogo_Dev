import React, { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { DELIVERY_METHODS, DEFAULT_DELIVERY_SETTINGS, DeliveryMethod, DeliverySettings as Config, parseDeliveryMethods, parseDeliverySettings } from '../../config/deliverySettings';

const emptyAddress = { street: '', number: '', neighborhood: '', city: '', state: '', zipCode: '' };
const addressLabels = { street: 'Logradouro', number: 'Número', neighborhood: 'Bairro', city: 'Cidade', state: 'UF', zipCode: 'CEP' };
export function DeliverySettings({ tenantId }: { tenantId: string | null }) {
  const [methods, setMethods] = useState<DeliveryMethod[]>([]);
  const [config, setConfig] = useState<Config>(DEFAULT_DELIVERY_SETTINGS);
  const [previous, setPrevious] = useState<{ methods: DeliveryMethod[]; settings: Config | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let active = true;
    setPrevious(null); setError(''); setMessage('');
    if (!tenantId) return;
    Promise.all([
      supabase.from('tenant_public_settings').select('delivery_methods').eq('tenant_id', tenantId).single(),
      supabase.from('tenant_delivery_settings').select('settings').eq('tenant_id', tenantId).maybeSingle(),
    ]).then(([publicResult, privateResult]) => {
      if (!active) return;
      try {
        if (publicResult.error || privateResult.error) throw new Error();
        const loadedMethods = parseDeliveryMethods(publicResult.data.delivery_methods);
        const loadedSettings = privateResult.data ? parseDeliverySettings(privateResult.data.settings) : null;
        setMethods(loadedMethods); setConfig(loadedSettings ?? DEFAULT_DELIVERY_SETTINGS);
        setPrevious({ methods: loadedMethods, settings: loadedSettings });
      } catch { setError('Não foi possível carregar as configurações de entrega.'); }
    }).catch(() => { if (active) setError('Não foi possível carregar as configurações de entrega.'); });
    return () => { active = false; };
  }, [tenantId, reload]);
  async function save() {
    if (!tenantId || !previous || busy) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const parsed = parseDeliverySettings(config);
      const activeMethods = parseDeliveryMethods(methods);
      const { error } = await supabase.rpc('save_delivery_settings', {
        p_tenant_id: tenantId, p_methods: activeMethods, p_settings: parsed,
        p_previous_methods: previous.methods, p_previous_settings: previous.settings,
      });
      if (error) throw new Error('Não foi possível salvar. Verifique sua permissão ou recarregue para obter alterações recentes.');
      setConfig(parsed); setPrevious({ methods: activeMethods, settings: parsed });
      setMessage('Entrega salva. Recarregue o catálogo para usar os métodos ativos.');
    } catch (err) { setError(err instanceof Error ? err.message : 'Falha ao salvar.'); }
    finally { setBusy(false); }
  }
  return <section className="bg-white text-slate-900 p-6 rounded-2xl border border-slate-200 space-y-4 my-5">
    <h3 className="font-bold">Checkout e entrega</h3>
    <p className="text-sm text-slate-600">Escolha os métodos disponíveis. Tarifas de Uber Moto/Carro são estimativas internas por km, sem cotação oficial da Uber. O frete continua a combinar até o serviço de rotas estar configurado.</p>
    {!previous && !error && <p role="status">Carregando entrega...</p>}
    {error && <p role="alert" className="text-red-700">{error}</p>}
    {previous && <fieldset disabled={busy} className="space-y-4">
      <legend className="font-semibold">Métodos disponíveis</legend>
      <div className="grid sm:grid-cols-2 gap-3">{(Object.keys(DELIVERY_METHODS) as DeliveryMethod[]).map(method => <label key={method} className="flex gap-2 items-center">
        <input type="checkbox" checked={methods.includes(method)} onChange={e => {
          setMessage(''); setMethods(e.target.checked ? [...methods, method] : methods.filter(m => m !== method));
        }} />{DELIVERY_METHODS[method]}
      </label>)}</div>
      <p className="text-xs text-slate-600">Uber legado mantém compatibilidade com a configuração anterior. Desative-o quando optar por Moto e Carro.</p>
      <div className="grid sm:grid-cols-2 gap-3">{(['motoCentsPerKm', 'carCentsPerKm'] as const).map((key, i) => <label key={key} className="text-sm">
        {i === 0 ? 'Uber Moto — R$/km' : 'Uber Carro — R$/km'}
        <input type="number" min="0.01" max="100" step="0.01" value={Number.isFinite(config[key]) ? config[key] / 100 : ''} onChange={e => {
          setMessage(''); setConfig({ ...config, [key]: Math.round(e.currentTarget.valueAsNumber * 100) });
        }} className="block border rounded-lg p-2 w-full" />
      </label>)}</div>
      <label className="flex gap-2 items-center"><input type="checkbox" checked={config.origin !== null} onChange={e => {
        setMessage(''); setConfig({ ...config, origin: e.target.checked ? { ...emptyAddress } : null });
      }} />Cadastrar endereço de saída da loja</label>
      <p className="text-xs text-slate-600">A configuração é privada, mas o endereço de saída aparece no resultado e no link de rota para o comprador. Cadastre um endereço comercial que possa ser compartilhado.</p>
      <label className="flex gap-2 items-center"><input type="checkbox" disabled={import.meta.env.VITE_GOOGLE_ROUTES_UI_ENABLED !== 'true'} checked={config.estimateEnabled} onChange={e => {
        setMessage(''); setConfig({ ...config, estimateEnabled: e.target.checked });
      }} />Ativar estimativa por distância (requer serviço de rotas configurado)</label>
      {config.origin && <div className="grid sm:grid-cols-2 gap-3">{(Object.keys(addressLabels) as (keyof typeof addressLabels)[]).map(key => <label key={key} className="text-sm">
        {addressLabels[key]} da loja
        <input value={config.origin![key]} maxLength={key === 'state' ? 2 : key === 'zipCode' ? 8 : 200} onChange={e => {
          const value = key === 'state' ? e.target.value.toUpperCase() : key === 'zipCode' ? e.target.value.replace(/\D/g, '') : e.target.value;
          setMessage(''); setConfig({ ...config, origin: { ...config.origin!, [key]: value } });
        }} className="block border rounded-lg p-2 w-full" />
      </label>)}</div>}
    </fieldset>}
    <div className="flex gap-3"><button type="button" disabled={!previous || busy} onClick={save} className="bg-blue-600 text-white rounded-xl px-4 py-2 disabled:opacity-50">{busy ? 'Salvando...' : 'Salvar entrega'}</button>
      <button type="button" disabled={busy} onClick={() => setReload(n => n + 1)} className="border rounded-xl px-4 py-2">Recarregar entrega</button></div>
    {message && <p role="status" className="text-emerald-700">{message}</p>}
  </section>;
}
