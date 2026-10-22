/** Server-only adapter. No credentials, calls, retries, or quota fallback in the frontend. */
export async function computeGoogleRoadDistance(options: {
  origin: string;
  destination: string;
  apiKey: string;
  deploymentApproved: boolean;
  // Must atomically reserve a project-wide slot BEFORE every attempt, including failed calls.
  // Implementer must cap at 300/day AND verify Cloud Console quota independently.
  reserveAttempt: () => Promise<boolean>;
  fetcher?: typeof fetch;
}): Promise<number> {
  if (!options.deploymentApproved || !options.apiKey.trim()) throw new Error('ROUTING_DISABLED');
  if (![options.origin, options.destination].every(value => typeof value === 'string' && value.trim().length > 0 && value.length <= 500)) {
    throw new Error('INVALID_ADDRESS');
  }
  if (!await options.reserveAttempt()) throw new Error('ROUTING_QUOTA_EXHAUSTED');
  let response: Response;
  try {
    response = await (options.fetcher ?? fetch)('https://routes.googleapis.com/directions/v2:computeRoutes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': options.apiKey,
        'X-Goog-FieldMask': 'routes.distanceMeters' },
      body: JSON.stringify({ origin: { address: options.origin.trim() }, destination: { address: options.destination.trim() },
        travelMode: 'DRIVE', routingPreference: 'TRAFFIC_UNAWARE', computeAlternativeRoutes: false }),
      signal: AbortSignal.timeout(8000),
      redirect: 'error',
    });
  } catch { throw new Error('ROUTING_UNAVAILABLE'); }
  if (!response.ok) throw new Error(response.status === 429 ? 'ROUTING_QUOTA_EXHAUSTED' : 'ROUTING_UNAVAILABLE');
  let data: { routes?: { distanceMeters?: number }[] };
  try { data = await response.json(); } catch { throw new Error('INVALID_ROUTE_RESPONSE'); }
  const meters = data?.routes?.[0]?.distanceMeters;
  if (!Number.isSafeInteger(meters) || meters! <= 0 || meters! > 1000000) throw new Error('ROUTE_NOT_FOUND');
  return meters!;
}

/** Rates must come from the tenant configuration, never from a customer request. */
export function estimatedFreightCents(distanceMeters: number, centsPerKm: number): number {
  if (!Number.isSafeInteger(distanceMeters) || distanceMeters <= 0 || distanceMeters > 1000000 ||
      !Number.isInteger(centsPerKm) || centsPerKm < 1 || centsPerKm > 10000) throw new Error('INVALID_FREIGHT_INPUT');
  return Math.round(distanceMeters * centsPerKm / 1000);
}
