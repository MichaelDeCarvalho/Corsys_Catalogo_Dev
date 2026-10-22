import React from 'react';
import { googleMapsRouteUrl } from '../../utils/googleMapsRouteUrl';

export function GoogleMapsRouteLink({ origin, destination }: { origin: string; destination: string }) {
  let href: string;
  try { href = googleMapsRouteUrl(origin, destination); } catch { return null; }
  return <a href={href} target="_blank" rel="noopener noreferrer"
    className="inline-block border rounded-xl px-3 py-2 text-sm">
    Ver trajeto no Google Maps
  </a>;
}
