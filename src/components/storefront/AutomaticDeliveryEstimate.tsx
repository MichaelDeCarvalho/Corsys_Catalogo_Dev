import React, { useEffect, useRef, useState } from 'react';
import { getPublicCatalogClient } from '../../lib/supabase';
import { GoogleMapsRouteLink } from './GoogleMapsRouteLink';

type Estimate = { distanceMeters: number; estimateCents: number; originAddress: string; destinationAddress: string };
export function AutomaticDeliveryEstimate({ slug, method, address }: {
  slug: string; method: string; address: { street: string; number: string; neighborhood: string; city: string; state: string; zipCode: string };
}) {
  const [result, setResult] = useState<Estimate | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);
  const fingerprint = JSON.stringify([slug, method, address]);
  const completeAddress = Object.values(address).every(value => value.trim().length > 0) &&
    /^[A-Z]{2}$/.test(address.state) && /^\d{8}$/.test(address.zipCode);
  useEffect(() => {
    generation.current++; setResult(null); setError(''); setBusy(false);
    return () => { generation.current++; };
  }, [fingerprint]);
  async function calculate() {
    const current = ++generation.current;
    setBusy(true); setError(''); setResult(null);
    try {
      const { data, error } = await getPublicCatalogClient().functions.invoke('estimate-delivery', {
        body: { slug, method, address, privacyConfirmed: true },
      });
      if (error || !data || !Number.isSafeInteger(data.distanceMeters) || data.distanceMeters <= 0 ||
          !Number.isSafeInteger(data.estimateCents) || data.estimateCents < 0 ||
          typeof data.originAddress !== 'string' || typeof data.destinationAddress !== 'string') throw new Error();
      if (current === generation.current) setResult(data);
    } catch { if (current === generation.current) setError('Estimativa indisponível. Confira o endereço ou combine o frete com a loja.'); }
    finally { if (current === generation.current) setBusy(false); }
  }
  return <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 space-y-2 text-xs">
    <p>Ao calcular, os endereços da loja e da entrega serão enviados ao Google para obter a distância pela rota de ruas.</p>
    {!completeAddress && <p>Preencha logradouro, número, bairro, cidade, UF e CEP para calcular.</p>}
    <button type="button" disabled={busy || !completeAddress} onClick={calculate} className="border rounded-lg px-3 py-2 disabled:opacity-50">
      {busy ? 'Calculando...' : 'Calcular estimativa de entrega'}
    </button>
    {error && <p role="alert">{error}</p>}
    {result && <>
      <p role="status">Distância: {(result.distanceMeters / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} km.
        {' '}Estimativa: {(result.estimateCents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}.</p>
      <GoogleMapsRouteLink origin={result.originAddress} destination={result.destinationAddress} />
    </>}
    <p>Estimativa baseada em rota básica de carro, com tarifa da modalidade escolhida. Não é cotação oficial da Uber nem rota específica de moto/caminhão. Frete sujeito à confirmação da loja e não incluído no total do pedido.</p>
    {result && <p>Distância fornecida por Google Maps.</p>}
  </div>;
}
