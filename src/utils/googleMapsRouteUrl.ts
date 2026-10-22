/** Maps URLs open externally and do not use a Maps Platform API key. */
export function googleMapsRouteUrl(origin: string, destination: string): string {
  if (![origin, destination].every(value => typeof value === 'string' && value.trim().length > 0 && value.length <= 500)) {
    throw new Error('Informe os endereços completos da loja e do cliente.');
  }
  const url = new URL('https://www.google.com/maps/dir/');
  url.searchParams.set('api', '1');
  url.searchParams.set('origin', origin.trim());
  url.searchParams.set('destination', destination.trim());
  url.searchParams.set('travelmode', 'driving');
  return url.toString();
}
