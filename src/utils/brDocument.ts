/**
 * Utilitários puros para validação e normalização de documentos brasileiros (CPF e CNPJ).
 * Implementação nativa sem dependências externas com cálculo determinístico de dígitos verificadores.
 */

/**
 * Remove qualquer caracter que não seja dígito numérico (0-9).
 */
export function normalizeBrazilianDocument(doc: unknown): string {
  if (typeof doc !== 'string') {
    return '';
  }
  return doc.replace(/\D/g, '');
}

/**
 * Validação rigorosa de CPF brasileiro (Cadastro de Pessoas Físicas).
 * - Remove pontuações
 * - Exige exatamente 11 dígitos
 * - Rejeita sequências repetidas conhecidas (00000000000, 11111111111, etc.)
 * - Valida os 2 dígitos verificadores através do algoritmo oficial módulo 11
 */
export function isValidCPF(cpf: unknown): boolean {
  const clean = normalizeBrazilianDocument(cpf);

  if (clean.length !== 11) {
    return false;
  }

  // Rejeita sequências de 11 dígitos iguais (ex: 111.111.111-11)
  if (/^(\d)\1{10}$/.test(clean)) {
    return false;
  }

  const digits = clean.split('').map(Number);

  // 1º Dígito Verificador
  let sum1 = 0;
  for (let i = 0; i < 9; i++) {
    sum1 += digits[i] * (10 - i);
  }
  const rem1 = (sum1 * 10) % 11;
  const expectedDigit1 = rem1 === 10 || rem1 === 11 ? 0 : rem1;

  if (digits[9] !== expectedDigit1) {
    return false;
  }

  // 2º Dígito Verificador
  let sum2 = 0;
  for (let i = 0; i < 10; i++) {
    sum2 += digits[i] * (11 - i);
  }
  const rem2 = (sum2 * 10) % 11;
  const expectedDigit2 = rem2 === 10 || rem2 === 11 ? 0 : rem2;

  if (digits[10] !== expectedDigit2) {
    return false;
  }

  return true;
}

/**
 * Validação rigorosa de CNPJ brasileiro (Cadastro Nacional da Pessoa Jurídica).
 * - Remove pontuações
 * - Exige exatamente 14 dígitos
 * - Rejeita sequências repetidas conhecidas (00000000000000, etc.)
 * - Valida os 2 dígitos verificadores através do algoritmo oficial módulo 11
 */
export function isValidCNPJ(cnpj: unknown): boolean {
  const clean = normalizeBrazilianDocument(cnpj);

  if (clean.length !== 14) {
    return false;
  }

  // Rejeita sequências de 14 dígitos iguais
  if (/^(\d)\1{13}$/.test(clean)) {
    return false;
  }

  const digits = clean.split('').map(Number);

  // 1º Dígito Verificador: pesos [5,4,3,2,9,8,7,6,5,4,3,2]
  const weights1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  let sum1 = 0;
  for (let i = 0; i < 12; i++) {
    sum1 += digits[i] * weights1[i];
  }
  const rem1 = sum1 % 11;
  const expectedDigit1 = rem1 < 2 ? 0 : 11 - rem1;

  if (digits[12] !== expectedDigit1) {
    return false;
  }

  // 2º Dígito Verificador: pesos [6,5,4,3,2,9,8,7,6,5,4,3,2]
  const weights2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  let sum2 = 0;
  for (let i = 0; i < 13; i++) {
    sum2 += digits[i] * weights2[i];
  }
  const rem2 = sum2 % 11;
  const expectedDigit2 = rem2 < 2 ? 0 : 11 - rem2;

  if (digits[13] !== expectedDigit2) {
    return false;
  }

  return true;
}

/**
 * Valida o documento brasileiro de acordo com a modalidade (PF -> CPF, PJ -> CNPJ).
 */
export function isValidBrazilianDocument(doc: unknown, type: 'PF' | 'PJ'): boolean {
  if (type === 'PF') {
    return isValidCPF(doc);
  }
  if (type === 'PJ') {
    return isValidCNPJ(doc);
  }
  return false;
}
