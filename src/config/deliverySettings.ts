export const DELIVERY_METHODS = {
  retirada: 'Retirada na loja', entrega: 'Entrega própria', uber_moto: 'Uber Moto',
  uber_carro: 'Uber Carro', transportadora: 'Transportadora', outro: 'Outro método', uber: 'Uber (legado)',
} as const;
export type DeliveryMethod = keyof typeof DELIVERY_METHODS;
export const deliveryMethodLabel = (method: string) => DELIVERY_METHODS[method as DeliveryMethod] ?? method;
export interface DeliverySettings {
  origin: null | { street: string; number: string; neighborhood: string; city: string; state: string; zipCode: string };
  motoCentsPerKm: number;
  carCentsPerKm: number;
  estimateEnabled: boolean;
}
export const DEFAULT_DELIVERY_SETTINGS: DeliverySettings = { origin: null, motoCentsPerKm: 180, carCentsPerKm: 250, estimateEnabled: false };
export function parseDeliveryMethods(raw: unknown): DeliveryMethod[] {
  if (!Array.isArray(raw) || !raw.length || raw.length > 7) throw new Error('Escolha ao menos um método de entrega.');
  const methods = raw.map(value => {
    if (typeof value !== 'string' || !Object.hasOwn(DELIVERY_METHODS, value)) throw new Error('Método de entrega inválido.');
    return value as DeliveryMethod;
  });
  if (new Set(methods).size !== methods.length) throw new Error('Métodos duplicados.');
  return methods;
}
export function parseDeliverySettings(raw: unknown): DeliverySettings {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Configuração de entrega inválida.');
  const obj = raw as Record<string, unknown>;
  if (Object.keys(obj).length !== 4 || typeof obj.estimateEnabled !== 'boolean') throw new Error('Configuração de entrega inválida.');
  for (const key of ['motoCentsPerKm', 'carCentsPerKm']) {
    if (!Number.isInteger(obj[key]) || Number(obj[key]) < 1 || Number(obj[key]) > 10000) throw new Error('Tarifa por km deve estar entre R$ 0,01 e R$ 100,00.');
  }
  let origin: DeliverySettings['origin'] = null;
  if (obj.origin !== null) {
    const keys = ['street', 'number', 'neighborhood', 'city', 'state', 'zipCode'];
    const address = obj.origin as Record<string, unknown>;
    if (!address || typeof address !== 'object' || Array.isArray(address) || Object.keys(address).length !== keys.length ||
      keys.some(key => typeof address[key] !== 'string' || !(address[key] as string).trim() || (address[key] as string).length > 200) ||
      !/^[A-Z]{2}$/.test(String(address.state)) || !/^\d{8}$/.test(String(address.zipCode))) throw new Error('Preencha o endereço de saída completo, UF e CEP com 8 dígitos.');
    origin = Object.fromEntries(keys.map(key => [key, (address[key] as string).trim()])) as NonNullable<DeliverySettings['origin']>;
  }
  if (obj.estimateEnabled && !origin) throw new Error('Cadastre a origem antes de ativar a estimativa.');
  return { origin, motoCentsPerKm: Number(obj.motoCentsPerKm), carCentsPerKm: Number(obj.carCentsPerKm), estimateEnabled: obj.estimateEnabled };
}
