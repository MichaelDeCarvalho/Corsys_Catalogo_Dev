import React, { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { CHECKOUT_FIELDS, CheckoutField, CheckoutFieldsConfig, LOCKED_CHECKOUT_FIELDS, parseCheckoutFields } from '../../config/checkoutFields';

export function CheckoutFieldSettings({ tenantId }: { tenantId: string | null }) {
  const [config, setConfig] = useState<CheckoutFieldsConfig | null>(null);
  const [savedConfig, setSavedConfig] = useState<CheckoutFieldsConfig | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let active = true;
    setConfig(null); setSavedConfig(null); setError(null); setSaved(false);
    if (!tenantId) return;
    Promise.resolve(supabase.from('tenant_public_settings').select('checkout_fields').eq('tenant_id', tenantId).single())
      .then(({ data, error }) => {
        if (!active) return;
        try {
          if (error) throw error;
          const loaded = parseCheckoutFields(data?.checkout_fields);
          setConfig(loaded); setSavedConfig(loaded);
        } catch { setError('Não foi possível carregar os campos do checkout.'); }
      }).catch(() => { if (active) setError('Não foi possível carregar os campos do checkout.'); });
    return () => { active = false; };
  }, [tenantId, reload]);
  async function save() {
    if (!tenantId || !config || !savedConfig || busy) return;
    setBusy(true); setError(null); setSaved(false);
    try {
      // Conditional update prevents overwriting another administrator's changes.
      const { data, error } = await supabase.from('tenant_public_settings')
        .update({ checkout_fields: parseCheckoutFields(config) }).eq('tenant_id', tenantId)
        .eq('checkout_fields', JSON.stringify(savedConfig)).select('checkout_fields').single();
      if (error || !data) throw new Error('Falha ao salvar. Verifique sua permissão ou recarregue para obter alterações recentes.');
      const persisted = parseCheckoutFields(data.checkout_fields);
      setConfig(persisted); setSavedConfig(persisted); setSaved(true);
    } catch (err) { setError(err instanceof Error ? err.message : 'Falha ao salvar os campos.'); }
    finally { setBusy(false); }
  }
  return <section className="bg-white p-6 rounded-2xl border border-slate-200 space-y-4">
    <h3 className="text-sm font-bold text-slate-900">Campos do checkout</h3>
    <p className="text-xs text-slate-600">Escolha quais informações solicitar. Nome, WhatsApp, CPF/CNPJ e logradouro continuam obrigatórios. No atacado, a identidade comercial vem do cadastro aprovado. Razão social configurável aplica-se ao varejo PJ.</p>
    {!tenantId && <p role="status">Aguardando contexto da loja.</p>}
    {tenantId && !config && !error && <p role="status">Carregando campos...</p>}
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    {config && <div className="overflow-x-auto"><table className="w-full text-sm text-left">
      <thead><tr><th>Campo</th><th>Visível</th><th>Obrigatório</th></tr></thead>
      <tbody>{(Object.keys(CHECKOUT_FIELDS) as CheckoutField[]).map(key => {
        const locked = LOCKED_CHECKOUT_FIELDS.includes(key);
        return <tr key={key} className="border-t border-slate-100">
          <th scope="row" className="py-2 font-medium">{CHECKOUT_FIELDS[key]}{locked ? ' (fixo)' : ''}</th>
          <td><input type="checkbox" aria-label={`${CHECKOUT_FIELDS[key]} visível`} checked={config[key].visible} disabled={busy || locked}
            onChange={e => { setSaved(false); setConfig({ ...config, [key]: { visible: e.target.checked, required: e.target.checked && config[key].required } }); }} /></td>
          <td><input type="checkbox" aria-label={`${CHECKOUT_FIELDS[key]} obrigatório`} checked={config[key].required} disabled={busy || locked || !config[key].visible}
            onChange={e => { setSaved(false); setConfig({ ...config, [key]: { ...config[key], required: e.target.checked } }); }} /></td>
        </tr>;
      })}</tbody>
    </table></div>}
    <div className="flex gap-3">
      <button type="button" disabled={!config || busy} onClick={save} className="px-4 py-2 bg-blue-600 text-white rounded-xl disabled:opacity-50">{busy ? 'Salvando...' : 'Salvar campos do checkout'}</button>
      <button type="button" disabled={busy || !tenantId} onClick={() => setReload(n => n + 1)} className="px-4 py-2 border rounded-xl">Recarregar</button>
    </div>
    {saved && <p role="status" className="text-sm text-emerald-700">Campos salvos. O catálogo usa a nova configuração ao recarregar.</p>}
  </section>;
}
