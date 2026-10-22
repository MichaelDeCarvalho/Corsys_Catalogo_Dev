export const CHECKOUT_FIELDS = {
  name: 'Nome do comprador', phone: 'WhatsApp', document: 'CPF/CNPJ', street: 'Logradouro',
  companyName: 'Razão social (varejo PJ)', email: 'E-mail', number: 'Número',
  complement: 'Complemento', neighborhood: 'Bairro', city: 'Cidade', state: 'UF',
  zipCode: 'CEP', notes: 'Observações', sellerCode: 'Código do vendedor',
} as const;
export type CheckoutField = keyof typeof CHECKOUT_FIELDS;
export type CheckoutFieldsConfig = Record<CheckoutField, { visible: boolean; required: boolean }>;
export const LOCKED_CHECKOUT_FIELDS: readonly CheckoutField[] = ['name', 'phone', 'document', 'street'];
export const DEFAULT_CHECKOUT_FIELDS = Object.fromEntries(Object.keys(CHECKOUT_FIELDS).map(key => [
  key, { visible: true, required: LOCKED_CHECKOUT_FIELDS.includes(key as CheckoutField) },
])) as CheckoutFieldsConfig;

// Missing config is allowed only for legacy typed callers. Persisted malformed config fails closed.
export function parseCheckoutFields(raw: unknown): CheckoutFieldsConfig {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Configuração de checkout inválida.');
  const record = raw as Record<string, unknown>;
  if (Object.keys(record).length !== Object.keys(CHECKOUT_FIELDS).length) throw new Error('Campos de checkout inválidos.');
  const result = {} as CheckoutFieldsConfig;
  for (const key of Object.keys(CHECKOUT_FIELDS) as CheckoutField[]) {
    const rule = record[key] as Record<string, unknown> | undefined;
    if (!rule || typeof rule !== 'object' || Array.isArray(rule) ||
      Object.keys(rule).length !== 2 || typeof rule.visible !== 'boolean' || typeof rule.required !== 'boolean' ||
      (rule.required && !rule.visible) || (LOCKED_CHECKOUT_FIELDS.includes(key) && (!rule.visible || !rule.required))) {
      throw new Error(`Configuração inválida para ${CHECKOUT_FIELDS[key]}.`);
    }
    result[key] = { visible: rule.visible, required: rule.required };
  }
  return result;
}

export function fieldApplies(key: CheckoutField, wholesale: boolean, type: string): boolean {
  if (key === 'companyName') return !wholesale && type === 'PJ';
  if (key === 'name' || key === 'document' || key === 'phone') return !wholesale;
  return true;
}

export function checkoutRequiredErrors(config: CheckoutFieldsConfig, values: Record<string, string>, wholesale: boolean): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const key of Object.keys(CHECKOUT_FIELDS) as CheckoutField[]) {
    if (fieldApplies(key, wholesale, values.type) && config[key].required && !values[key]?.trim()) {
      errors[key] = `${CHECKOUT_FIELDS[key]} é obrigatório.`;
    }
  }
  return errors;
}

export function projectCheckoutValues<T extends Record<string, string>>(config: CheckoutFieldsConfig, values: T, wholesale: boolean): T {
  const result = { ...values };
  for (const key of Object.keys(CHECKOUT_FIELDS) as CheckoutField[]) {
    if (!config[key].visible || (key === 'companyName' && !fieldApplies(key, wholesale, values.type))) {
      (result as Record<string, string>)[key] = '';
    }
  }
  return result;
}
