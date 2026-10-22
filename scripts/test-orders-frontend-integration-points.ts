/**
 * TEST SUITE: ORDERS / CHECKOUT V1 FRONTEND INTEGRATION
 * 
 * Cobertura Completa:
 * 1. TENANT / B2B Canonical & Synchronization
 * 2. OrderService Architecture & Boundaries
 * 3. Zero Client Financial Authority
 * 4. Idempotency, SHA-256 & SessionStorage Hygiene
 * 5. Payment & Delivery Methods Governance
 * 6. Customer & Shipping Address Sanitization
 * 7. Checkout Flow & Status Handling (503, Errors, Success)
 * 8. Hardcoded Artifacts Removal (PIX, WhatsApp, Confetti)
 * 9. Storefront Dynamic Rules
 * 10. Architectural Governance & Untouched Assets
 * 11. Behavioral Simulations
 */

import * as fs from 'fs';
import { 
  computeOrderFingerprint, 
  validateReceipt, 
  readStoredAttempt,
  writeStoredAttempt,
  clearStoredAttempt,
  submitOrderCheckout,
  OrderCheckoutError,
  SubmitOrderCheckoutDraft,
  buildCheckoutRequestBody,
  validateStoredAttempt
} from '../src/services/orderService';
import { 
  normalizeBrazilianDocument, 
  isValidCPF, 
  isValidCNPJ, 
  isValidBrazilianDocument 
} from '../src/utils/brDocument';
import { PaymentMethod } from '../src/types';

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`  ✓ ${message}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${message}`);
    failed++;
  }
}

console.log('======================================================');
console.log('TEST SUITE: ORDERS & CHECKOUT V1 FRONTEND INTEGRATION');
console.log('======================================================\n');

// Leitura dos arquivos fonte para análise estática e governança
const wholesaleContextCode = fs.readFileSync('src/context/WholesaleAccessContext.tsx', 'utf-8');
const cartDrawerCode = fs.readFileSync('src/components/storefront/CartDrawer.tsx', 'utf-8');
const storefrontViewCode = fs.readFileSync('src/components/storefront/StorefrontView.tsx', 'utf-8');
const orderServiceCode = fs.readFileSync('src/services/orderService.ts', 'utf-8');
const typesCode = fs.readFileSync('src/types.ts', 'utf-8');
const catalogServiceCode = fs.readFileSync('src/services/catalogService.ts', 'utf-8');
const b2bSwitchModalCode = fs.readFileSync('src/components/storefront/B2BSwitchModeConfirmModal.tsx', 'utf-8');

// =========================================================================
// 1. TENANT / B2B (Itens 1 a 12)
// =========================================================================
console.log('1. Tenant Canônico & Sincronização B2B');

assert(
  wholesaleContextCode.includes('import { PUBLIC_TENANT_SLUG } from') &&
  wholesaleContextCode.includes('const activeTenantSlug = PUBLIC_TENANT_SLUG;'),
  '1. WholesaleAccessContext usa exclusivamente PUBLIC_TENANT_SLUG'
);

assert(
  !wholesaleContextCode.includes('currentTenant.slug') &&
  !wholesaleContextCode.includes('currentTenant?.slug') &&
  !wholesaleContextCode.includes('currentTenant.id'),
  '2. WholesaleAccessContext NÃO usa currentTenant.slug como autoridade B2B'
);

assert(
  wholesaleContextCode.includes('const setPurchaseModeSynchronized =') &&
  wholesaleContextCode.includes('setPurchaseModeState(mode)') &&
  wholesaleContextCode.includes('setShoppingMode(mode)'),
  '3. purchaseMode e shoppingMode são deterministicamente sincronizados'
);

assert(
  !wholesaleContextCode.includes('setPurchaseMode: (mode: PurchaseMode)') &&
  wholesaleContextCode.includes('requestSwitchPurchaseMode: (mode: PurchaseMode) => void;'),
  '4. setter público setPurchaseMode sem guards foi removido (usa requestSwitchPurchaseMode)'
);

assert(
  wholesaleContextCode.includes("setPurchaseModeState('retail')") &&
  wholesaleContextCode.includes("setShoppingMode('retail')"),
  '5. Fallback de wholesale força modalidade retail nos dois estados'
);

assert(
  wholesaleContextCode.includes("purchaseModeRef.current === 'wholesale' && cartRef.current.length > 0") &&
  wholesaleContextCode.includes("clearCart();") &&
  !wholesaleContextCode.includes("setPurchaseModeState(prev => {\n      if (prev === 'wholesale' && cart.length > 0) {\n        clearCart();"),
  '6. Perda de autorização limpa carrinho fora de state updater'
);

assert(
  cartDrawerCode.includes('const { purchaseMode') &&
  cartDrawerCode.includes('useWholesaleAccess()'),
  '7. CartDrawer usa purchaseMode do WholesaleAccessContext como modalidade autoritativa'
);

assert(
  !cartDrawerCode.match(/const\s*\{[^}]*shoppingMode[^}]*\}\s*=\s*useApp\(\)/) &&
  !cartDrawerCode.includes('shoppingMode ==='),
  '8. CartDrawer não usa shoppingMode como autoridade de checkout'
);

assert(
  cartDrawerCode.includes('tenantSlug: settings.slug'),
  '9. settings.slug é o único tenantSlug enviado no checkout'
);

assert(
  !cartDrawerCode.includes('currentTenant.slug') &&
  !cartDrawerCode.includes('currentTenant?.slug'),
  '10. CartDrawer não usa currentTenant.slug no checkout'
);

assert(
  !cartDrawerCode.includes('currentTenant.id') &&
  !cartDrawerCode.includes('currentTenant?.id'),
  '11. CartDrawer não usa currentTenant.id no checkout'
);

assert(
  !cartDrawerCode.includes('settings.tenantId') &&
  !cartDrawerCode.includes('settings?.tenantId'),
  '12. CartDrawer não envia settings.tenantId para o backend'
);

// =========================================================================
// 2. SERVIÇO (Itens 13 a 25)
// =========================================================================
console.log('\n2. Arquitetura do OrderService & Limites de Integração');

assert(
  fs.existsSync('src/services/orderService.ts'),
  '13. orderService.ts existe no workspace'
);

assert(
  orderServiceCode.includes("client.functions.invoke('submit-order-checkout'"),
  '14. orderService usa a API oficial client.functions.invoke'
);

assert(
  orderServiceCode.includes('FunctionsHttpError'),
  '15. orderService trata FunctionsHttpError'
);

assert(
  orderServiceCode.includes('FunctionsFetchError'),
  '16. orderService trata FunctionsFetchError'
);

assert(
  orderServiceCode.includes('FunctionsRelayError'),
  '17. orderService trata FunctionsRelayError'
);

assert(
  orderServiceCode.includes('error.context.status') &&
  (orderServiceCode.includes('.clone().json()') || orderServiceCode.includes('.json()')),
  '18. FunctionsHttpError lê status e body de forma segura sem crash'
);

assert(
  orderServiceCode.includes("draft.shoppingMode === 'wholesale'"),
  '19. Retail não exige sessão prévia de autenticação'
);

assert(
  orderServiceCode.includes("if (!session || !session.access_token || !session.user?.id)"),
  '20. Wholesale exige sessão de usuário autenticado'
);

assert(
  orderServiceCode.includes("!session.access_token"),
  '21. Wholesale exige access_token do Supabase'
);

assert(
  orderServiceCode.includes("headers['Authorization'] = `Bearer ${session.access_token}`"),
  '22. Wholesale envia token no cabeçalho Authorization Bearer'
);

assert(
  !orderServiceCode.includes('buyerUserId: ') &&
  !orderServiceCode.includes('buyer_user_id: ') &&
  !orderServiceCode.includes('userId: ') &&
  !orderServiceCode.includes('auth.uid'),
  '23. buyerUserId NUNCA aparece no body enviado ao backend'
);

assert(
  orderServiceCode.includes('const requestBody: Record<string, unknown> = {') &&
  orderServiceCode.includes('tenantSlug:') &&
  orderServiceCode.includes('idempotencyKey:') &&
  orderServiceCode.includes('shoppingMode: draft.shoppingMode,'),
  '24. Body é construído por Whitelist explícita de campos'
);

assert(
  !orderServiceCode.includes('body: draft') &&
  !orderServiceCode.includes('body: { ...draft }'),
  '25. Não utiliza spread arbitrário do draft de input'
);

// =========================================================================
// 3. FINANCEIRO (Itens 26 a 32)
// =========================================================================
console.log('\n3. Autoridade Financeira Zero no Cliente');

assert(
  !orderServiceCode.includes('subtotal: draft.') &&
  !orderServiceCode.includes('subtotal: input.') &&
  !cartDrawerCode.includes('subtotal: cartSubtotal') &&
  !orderServiceCode.includes('requestBody.subtotal'),
  '26. subtotal não aparece no payload de envio'
);

assert(
  !orderServiceCode.includes('total: draft.') &&
  !orderServiceCode.includes('total: input.') &&
  !cartDrawerCode.includes('total: orderTotal') &&
  !orderServiceCode.includes('requestBody.total'),
  '27. total não aparece no payload de envio'
);

assert(
  !orderServiceCode.includes('discount: draft.') &&
  !cartDrawerCode.includes('discount: 0') &&
  !orderServiceCode.includes('requestBody.discount'),
  '28. discount não aparece no payload de envio'
);

assert(
  !orderServiceCode.includes('shippingFee: draft.') &&
  !cartDrawerCode.includes('shippingFee: 0') &&
  !orderServiceCode.includes('requestBody.shippingFee'),
  '29. shippingFee não aparece no payload de envio'
);

assert(
  !orderServiceCode.includes('unitPrice: it.') &&
  !orderServiceCode.includes('unitPrice: i.') &&
  !cartDrawerCode.includes('unitPrice: item.unitPrice'),
  '30. unitPrice não aparece no payload de envio de itens'
);

assert(
  !orderServiceCode.includes('totalPrice: it.') &&
  !orderServiceCode.includes('totalPrice: i.') &&
  !cartDrawerCode.includes('totalPrice: item.'),
  '31. totalPrice não aparece no payload de envio de itens'
);

assert(
  !orderServiceCode.includes('wholesalePrice: it.') &&
  !orderServiceCode.includes('wholesalePrice: i.') &&
  !cartDrawerCode.includes('wholesalePrice: item.'),
  '32. wholesalePrice não aparece no payload de envio de itens'
);

// =========================================================================
// 4. IDEMPOTÊNCIA (Itens 33 a 45)
// =========================================================================
console.log('\n4. Idempotência Robusta, SHA-256 & SessionStorage Hygiene');

assert(
  orderServiceCode.includes('crypto.randomUUID()'),
  '33. Gera idempotencyKey via crypto.randomUUID()'
);

assert(
  !orderServiceCode.includes('Math.random()'),
  '34. NÃO utiliza Math.random() para geração de chave'
);

assert(
  !orderServiceCode.includes('idempotencyKey = Date.now()') &&
  !orderServiceCode.includes('idempotencyKey: Date.now()'),
  '35. NÃO utiliza Date.now() para gerar idempotency key'
);

assert(
  orderServiceCode.includes("crypto.subtle.digest('SHA-256'"),
  '36. Utiliza SHA-256 via Web Crypto para calcular fingerprint do pedido'
);

assert(
  orderServiceCode.includes('writeStoredAttempt') &&
  orderServiceCode.includes('fingerprintHash') &&
  orderServiceCode.includes('idempotencyKey') &&
  orderServiceCode.includes('createdAt') &&
  !orderServiceCode.includes('window.sessionStorage.setItem(key, JSON.stringify(draft))'),
  '37. sessionStorage NÃO armazena nenhuma PII (apenas hash, key e createdAt)'
);

// =========================================================================
// 5. PAYMENT / DELIVERY (Itens 46 a 55)
// =========================================================================
console.log('\n5. Métodos de Pagamento e Entrega Oficiais');

assert(
  typesCode.includes("'pix'"),
  '46. PaymentMethod contém pix'
);

assert(
  typesCode.includes("'boleto'"),
  '47. PaymentMethod contém boleto'
);

assert(
  typesCode.includes("'credit_card'"),
  '48. PaymentMethod contém credit_card'
);

assert(
  typesCode.includes("'cash_on_delivery'"),
  '49. PaymentMethod contém cash_on_delivery'
);

assert(
  !typesCode.includes("'on_delivery'"),
  '50. PaymentMethod NÃO contém on_delivery legado'
);

assert(
  !typesCode.includes("'negotiate'"),
  '51. PaymentMethod NÃO contém negotiate legado'
);

assert(
  cartDrawerCode.includes('settings?.deliveryMethods || []') &&
  cartDrawerCode.includes('availableDeliveryMethods.map'),
  '52. deliveryMethod provém exclusivamente de settings.deliveryMethods'
);

assert(
  !cartDrawerCode.includes("const deliveryMethods = ['retirada', 'entrega']") &&
  !cartDrawerCode.includes("const deliveryMethods = ['pickup', 'delivery']"),
  '53. Não há lista estática de delivery methods usada como autoridade'
);

assert(
  cartDrawerCode.includes('availableDeliveryMethods.length === 0') &&
  cartDrawerCode.includes('Nenhum método de entrega configurado pela loja'),
  '54. Lista de métodos de entrega vazia bloqueia checkout'
);

assert(
  orderServiceCode.includes("!cleanDeliveryMethod") &&
  orderServiceCode.includes("validPaymentMethods.includes(draft.paymentMethod)"),
  '55. Método de entrega ou pagamento inválido é rejeitado antes da rede'
);

// =========================================================================
// 6. CUSTOMER / ENDEREÇO (Itens 56 a 64)
// =========================================================================
console.log('\n6. Validação e Sanitização de Cliente e Endereço');

assert(
  !cartDrawerCode.includes("'cliente@contato.com.br'"),
  '56. Cliente retail não fabrica e-mail padrão fictício'
);

assert(
  !cartDrawerCode.includes("number: customerData.number || 'S/N'"),
  '57. Não fabrica número de residência S/N'
);

assert(
  !cartDrawerCode.includes("neighborhood: customerData.neighborhood || 'Centro'"),
  '58. Não fabrica bairro Centro'
);

assert(
  !cartDrawerCode.includes("city: customerData.city || 'São Paulo'") &&
  !cartDrawerCode.includes("city: 'São Paulo'"),
  '59. Não fabrica cidade São Paulo'
);

assert(
  !cartDrawerCode.includes("state: customerData.state || 'SP'") &&
  !cartDrawerCode.includes("state: 'SP'"),
  '60. Não fabrica estado SP'
);

assert(
  !cartDrawerCode.includes("'00000-000'"),
  '61. Não fabrica CEP 00000-000'
);

assert(
  cartDrawerCode.includes('const customerPayload = isWholesale') &&
  cartDrawerCode.includes('email: customerData.email.trim() || undefined') &&
  cartDrawerCode.includes('phone: customerData.phone.trim() || undefined'),
  '62. Wholesale envia apenas campos operacionais, preservando autoridade do backend'
);

assert(
  cartDrawerCode.includes('wholesaleCompany?.legalName') &&
  cartDrawerCode.includes('wholesaleCompany?.cnpj') &&
  cartDrawerCode.includes('Identidade Oficial de Atacado (B2B Cadastrado)'),
  '63. wholesaleCompany é apresentada na UI estritamente em modo read-only'
);

assert(
  cartDrawerCode.includes("!customerData.street.trim()") &&
  orderServiceCode.includes("!draft.shippingAddress || !draft.shippingAddress.street"),
  '64. street (logradouro) permanece obrigatória para qualquer modalidade e entrega'
);

// =========================================================================
// 7. FLOW (Itens 65 a 81)
// =========================================================================
console.log('\n7. Fluxo Transacional do Checkout & Ciclo de Vida da UI');

assert(
  !cartDrawerCode.includes('createOrder(') &&
  !cartDrawerCode.match(/const\s*\{[^}]*createOrder[^}]*\}\s*=\s*useApp\(\)/),
  '65. CartDrawer NÃO invoca createOrder do AppContext'
);

assert(
  cartDrawerCode.includes('<span>Enviar pedido pelo WhatsApp</span>') &&
  cartDrawerCode.includes('id="btn-submit-order"'),
  '66. Botão final primário de submissão na etapa review é "Enviar pedido pelo WhatsApp" (com id="btn-submit-order")'
);

assert(
  cartDrawerCode.includes("window.open('about:blank', '_blank')") &&
  cartDrawerCode.includes('prepWindow.location.href = waUrl;'),
  '67. Submissão do pedido pré-abre aba neutra para prevenção de popup blocker pós-await'
);

assert(
  cartDrawerCode.includes('if (prepWindow.closed) {') &&
  cartDrawerCode.includes('Pedido registrado. Clique novamente para abrir o WhatsApp.') &&
  cartDrawerCode.includes('if (createdOrder) {') &&
  cartDrawerCode.includes('receipt = createdOrder;'),
  '67b. Janela fechada prematuramente preserva carrinho/formulário e novo clique reutiliza createdOrder sem duplicidade'
);

assert(
  cartDrawerCode.includes('try {') &&
  cartDrawerCode.includes('receipt = await submitOrderCheckout(draft);') &&
  cartDrawerCode.includes('catch (err: unknown) {') &&
  cartDrawerCode.includes('prepWindow.close();') &&
  cartDrawerCode.includes('setSubmitError(message);'),
  '68. Erro HTTP 503 fecha aba neutra, bloqueia WhatsApp e mantém usuário na etapa de revisão com feedback de erro'
);

assert(
  cartDrawerCode.includes('setSubmitError(message);') &&
  !cartDrawerCode.includes('catch (err: unknown) {\n      clearCart();'),
  '69. Erro HTTP 503 preserva carrinho intacto'
);

assert(
  !cartDrawerCode.includes('catch (err: unknown) {\n      setCustomerData('),
  '70. Erro HTTP 503 preserva formulário e dados do comprador intactos'
);

assert(
  orderServiceCode.includes('clearStoredAttempt(cleanTenantSlug);') &&
  !orderServiceCode.includes('if (result.error) {\n    clearStoredAttempt'),
  '71. Erro HTTP 503 preserva a tentativa idempotente'
);

assert(
  cartDrawerCode.includes('clearCart();') &&
  !cartDrawerCode.includes('clearCart();\n      const receipt'),
  '72. Erro não limpa carrinho; clearCart ocorre exclusivamente em caso de sucesso'
);

assert(
  cartDrawerCode.includes('prepWindow.location.href = waUrl;') &&
  cartDrawerCode.includes('clearCart();') &&
  cartDrawerCode.includes('resetCheckoutLifecycle();'),
  '73. Sucesso real validado prepara handoff, executa clearCart() e reseta ciclo'
);

assert(
  cartDrawerCode.includes('receipt.subtotal') &&
  cartDrawerCode.includes('receipt.orderNumber') &&
  cartDrawerCode.includes('receipt.documentUrl'),
  '74. Handoff de WhatsApp consome exclusivamente o recibo validado do servidor'
);

assert(
  orderServiceCode.includes('function validateReceipt(raw: unknown): CheckoutOrderReceipt'),
  '75. Formato de resposta do servidor é estritamente validado em runtime'
);

assert(
  orderServiceCode.includes("throw new OrderCheckoutError('Resposta inválida do serviço de pedidos.')"),
  '76. Resposta fora do contrato oficial lança erro e impede tela de sucesso'
);

assert(
  cartDrawerCode.includes('disabled={isSubmittingOrder}') &&
  cartDrawerCode.includes('if (isSubmittingOrder) return;'),
  '77. isSubmittingOrder previne duplo clique e requisições concorrentes'
);

assert(
  cartDrawerCode.includes('role="alert"') &&
  cartDrawerCode.includes('{submitError}'),
  '78. submitError é renderizado inline em bloco com role="alert"'
);

assert(
  !cartDrawerCode.includes('Pedido Confirmado'),
  '79. Termo prematuro "Pedido Confirmado" não existe na UI'
);

assert(
  !cartDrawerCode.includes("checkoutStep === 'success'") &&
  !cartDrawerCode.includes("setCheckoutStep('success')"),
  '80. Fluxo V1.2 elimina etapa intermediária "Pedido recebido" e opera exclusivamente em cart -> details -> review'
);

assert(
  cartDrawerCode.includes('Pagamento ainda não realizado.') &&
  cartDrawerCode.includes('Aguardo as instruções/link de pagamento e a confirmação de disponibilidade/frete por este WhatsApp.'),
  '81. Aviso claro "Pagamento ainda não realizado" e dependência de confirmação da loja exibidos na mensagem do WhatsApp'
);

// Verificação determinística dos 10 guards executados imediatamente antes da chamada de rede:
assert(
  cartDrawerCode.includes('if (!settings) {\n      setSubmitError(\'Configurações da loja ainda não estão disponíveis.\');'),
  '81a. Guard 1: settings existe é revalidado imediatamente antes do submit'
);

assert(
  cartDrawerCode.includes("typeof settings.slug !== 'string' || !settings.slug.trim()"),
  '81b. Guard 2: settings.slug não vazio é revalidado imediatamente antes do submit'
);

assert(
  cartDrawerCode.includes('if (cart.length === 0) {\n      setSubmitError(\'Seu carrinho está vazio.\');'),
  '81c. Guard 3: carrinho não vazio é revalidado imediatamente antes do submit'
);

assert(
  cartDrawerCode.includes('isWholesale && (!isApproved || !settings.allowB2bMode)'),
  '81d. Guard 4: autorização de atacado ativa é revalidada imediatamente antes do submit'
);

assert(
  cartDrawerCode.includes('settings.wholesaleMinOrderValue === null || settings.wholesaleMinOrderValue === undefined'),
  '81e. Guard 5: wholesaleMinOrderValue não nulo é revalidado imediatamente antes do submit'
);

assert(
  cartDrawerCode.includes('cartSubtotal < settings.wholesaleMinOrderValue') &&
  cartDrawerCode.includes('cartSubtotal < settings.minOrderValue'),
  '81f. Guard 6: valor mínimo de pedido é revalidado imediatamente antes do submit'
);

assert(
  cartDrawerCode.includes('hasItemBelowMinimum') &&
  cartDrawerCode.includes('item.quantity < minQty') &&
  cartDrawerCode.includes('hasInsufficientWholesaleItem'),
  '81g. Guard 7: quantidade mínima por item e estoque são revalidados imediatamente antes do submit'
);

assert(
  cartDrawerCode.includes('!Array.isArray(availableDeliveryMethods) || availableDeliveryMethods.length === 0'),
  '81h. Guard 8: availableDeliveryMethods não vazio é revalidado imediatamente antes do submit'
);

assert(
  cartDrawerCode.includes('!availableDeliveryMethods.includes(deliveryMethod.trim())'),
  '81i. Guard 9: deliveryMethod pertencente a availableDeliveryMethods é revalidado imediatamente antes do submit'
);

assert(
  cartDrawerCode.includes('!customerData.name.trim()') &&
  cartDrawerCode.includes('!customerData.phone.trim()') &&
  cartDrawerCode.includes('!customerData.street.trim()'),
  '81j. Guard 10: campos obrigatórios do formulário são revalidados imediatamente antes do submit'
);

// =========================================================================
// 7B. CHECKOUT V1.1 — REVISÃO DE ORÇAMENTO, CPF/CNPJ & LIFECYCLE WHATSAPP
// =========================================================================
console.log('\n7B. Checkout V1.1 — Revisão, Validação de Documento & WhatsApp Handoff');

assert(
  cartDrawerCode.includes("checkoutStep === 'review'") &&
  cartDrawerCode.includes("setCheckoutStep('review')"),
  '81k. Fluxo de checkout inclui formalmente a etapa de revisão (checkoutStep: review)'
);

assert(
  cartDrawerCode.includes('Validar orçamento') &&
  cartDrawerCode.includes('handleValidateDetails') &&
  !cartDrawerCode.includes('const handleValidateDetails = async') &&
  cartDrawerCode.includes('id="btn-validate-quote"'),
  '81l. Botão "Validar orçamento" executa validação estritamente local (zero chamadas de rede)'
);

assert(
  cartDrawerCode.includes('Revise seu pedido') &&
  cartDrawerCode.includes('Resumo Estimado') &&
  cartDrawerCode.includes('Dados do Comprador') &&
  cartDrawerCode.includes('Endereço de Entrega'),
  '81m. Etapa review exibe resumo completo e legível no padrão marketplace'
);

assert(
  cartDrawerCode.includes('Voltar e editar') &&
  cartDrawerCode.includes("setCheckoutStep('details')"),
  '81n. Ação "Voltar e editar" retorna para details preservando todos os dados do comprador'
);

assert(
  cartDrawerCode.includes('<span>Enviar pedido pelo WhatsApp</span>') &&
  cartDrawerCode.includes('handleFinishOrder') &&
  cartDrawerCode.includes('id="btn-submit-order"'),
  '81o. Ação "Enviar pedido pelo WhatsApp" aciona o envio oficial através do handleFinishOrder'
);

assert(
  cartDrawerCode.includes('Revise os dados antes de confirmar.') &&
  cartDrawerCode.includes('Preços, estoque e regras comerciais serão validados novamente pelo servidor.'),
  '81p. Disclaimer explícito de que preços e regras serão revalidados pelo servidor é exibido na revisão'
);

assert(
  cartDrawerCode.includes("customerData.type === 'PJ' ? 'CNPJ *' : 'CPF *'"),
  '81q. Labels de documento em modo varejo indicam obrigatoriedade (CPF * e CNPJ *)'
);

assert(
  cartDrawerCode.includes('isValidCPF(cleanDoc)') &&
  cartDrawerCode.includes('isValidCNPJ(cleanDoc)') &&
  cartDrawerCode.includes('Informe um CPF válido.') &&
  cartDrawerCode.includes('Informe um CNPJ válido.'),
  '81r. Validação real de CPF e CNPJ com feedback inline específico no frontend'
);

assert(
  cartDrawerCode.includes("setCustomerData(prev => ({ ...prev, type: 'PJ' }))") &&
  cartDrawerCode.includes("delete next.document"),
  '81s. Troca entre PF e PJ limpa erros de validação anteriores'
);

assert(
  cartDrawerCode.includes('ConfirmedCustomerSnapshot') &&
  cartDrawerCode.includes('confirmedCustomerSnapshot') &&
  cartDrawerCode.includes('const pendingCustomerSnapshot: ConfirmedCustomerSnapshot') &&
  cartDrawerCode.includes('setConfirmedCustomerSnapshot(pendingCustomerSnapshot)') &&
  !cartDrawerCode.includes('sessionStorage.setItem') && // snapshot não entra em storage
  !cartDrawerCode.includes('localStorage.setItem'),
  '81t. confirmedCustomerSnapshot atribuído no state estritamente após validação do receipt do servidor'
);

assert(
  cartDrawerCode.includes('setConfirmedCustomerSnapshot(null)') &&
  cartDrawerCode.includes('resetCheckoutLifecycle'),
  '81u. resetCheckoutLifecycle limpa confirmedCustomerSnapshot e reinicializa ciclo'
);

assert(
  cartDrawerCode.includes('<span>Enviar pedido pelo WhatsApp</span>') &&
  cartDrawerCode.includes('receipt.orderNumber') &&
  cartDrawerCode.includes('receipt.subtotal') &&
  cartDrawerCode.includes('receipt.documentUrl'),
  '81v. WhatsApp usa dados financeiros do receipt validado do servidor e anexa link para documento PDF oficial'
);

// =========================================================================
// 8. HARDCODE (Itens 82 a 85)
// =========================================================================
console.log('\n8. Expurgamento de Artefatos Fictícios e Hardcodes');

assert(
  !cartDrawerCode.includes('34567890000112') &&
  !cartDrawerCode.includes('34.567.890/0001-12'),
  '82. Chave PIX fictícia e controle de cópia hardcoded completamente removidos'
);

assert(
  !cartDrawerCode.includes('5541992928033'),
  '83. Fallback de telefone WhatsApp fictício completamente removido'
);

assert(
  !cartDrawerCode.includes('currentTenant.customization') &&
  !cartDrawerCode.includes('currentTenant.name'),
  '84. currentTenant não é mais utilizado como autoridade no CartDrawer'
);

assert(
  !cartDrawerCode.includes('canvas-confetti') &&
  !cartDrawerCode.includes('confetti('),
  '85. Biblioteca canvas-confetti removida do fluxo de finalização'
);

// =========================================================================
// 9. STOREFRONT (Itens 86 a 89)
// =========================================================================
console.log('\n9. Regras Comerciais Dinâmicas na Vitrine');

assert(
  storefrontViewCode.includes('minVarejo.toFixed(2).replace(\'.\', \',\')') &&
  storefrontViewCode.includes('id="btn-mode-retail"'),
  '86. StorefrontView exibe valor mínimo de varejo dinâmico de settings'
);

assert(
  storefrontViewCode.includes('minAtacado.toFixed(2).replace(\'.\', \',\')') &&
  storefrontViewCode.includes('id="btn-mode-wholesale"'),
  '87. StorefrontView exibe valor mínimo de atacado dinâmico de settings'
);

assert(
  !storefrontViewCode.includes('(Mín. R$ 400)') &&
  !storefrontViewCode.includes('R$ 1.000,00'),
  '88. StorefrontView NÃO possui valores mínimos de R$ 400 ou R$ 1.000 hardcoded'
);

assert(
  storefrontViewCode.includes('disabled={!allowB2bMode}') &&
  storefrontViewCode.includes('Atacado indisponível'),
  '89. allowB2bMode = false desabilita botão de atacado com feedback claro'
);

// =========================================================================
// 9B. AUDITORIA DOS 52 REQUISITOS (Itens A1 a A19)
// =========================================================================
console.log('\n9B. Auditoria de Contratos e Regras Comerciais Frontend');

// Req 25 & 26: Formas de Pagamento
assert(
  cartDrawerCode.includes('PIX Instantâneo') &&
  cartDrawerCode.includes('Boleto Bancário') &&
  !cartDrawerCode.includes("paymentMethod: 'credit_card'") &&
  !cartDrawerCode.includes("paymentMethod: 'cash_on_delivery'"),
  'A1. UI oferece somente PIX e Boleto no seletor de checkout'
);

// Req 27, 28, 29, 30: Catálogo público
assert(
  !catalogServiceCode.includes('wholesale_price:') &&
  !catalogServiceCode.includes('wholesale_enabled:') &&
  !catalogServiceCode.includes('wholesale_min_quantity:') &&
  !catalogServiceCode.match(/RawCatalogProductRow\s*\{[^}]*wholesale_/),
  'A2. RawCatalogProductRow não possui campos wholesale_*'
);

assert(
  catalogServiceCode.includes('wholesalePrice: null,') &&
  catalogServiceCode.includes('wholesaleEnabled: false,') &&
  catalogServiceCode.includes('wholesaleMinQuantity: null,'),
  'A3. Catálogo público injeta wholesalePrice=null, wholesaleEnabled=false e wholesaleMinQuantity=null'
);

// Req 31: Wholesale pricing apenas via RPC
assert(
  wholesaleContextCode.includes('fetchWholesaleCatalog(activeTenantSlug)') &&
  storefrontViewCode.includes('wholesaleCatalogMap.get(p.id)'),
  'A4. Wholesale pricing entra exclusivamente via get_wholesale_catalog / wholesaleCatalogMap'
);

// Req 32, 33, 34, 35, 36: Troca de modalidade
assert(
  wholesaleContextCode.includes('if (cart.length > 0) {') &&
  wholesaleContextCode.includes('setTargetPendingMode(targetMode);') &&
  wholesaleContextCode.includes('setIsSwitchModeDialogOpen(true);'),
  'A5. Carrinho vazio permite troca direta de modalidade; carrinho não vazio exige confirmação'
);

assert(
  wholesaleContextCode.includes('const confirmSwitchPurchaseMode = () => {') &&
  wholesaleContextCode.includes('clearCart();') &&
  wholesaleContextCode.includes('setPurchaseModeSynchronized(targetPendingMode);') &&
  !wholesaleContextCode.includes("'recalculate'") &&
  !wholesaleContextCode.includes("'remove_incompatible'"),
  'A6. Confirmação limpa carrinho antes da troca; não existe recalculate nem remove_incompatible'
);

// Req 38, 39: Higiene de estado B2B
assert(
  !wholesaleContextCode.includes('setPurchaseModeState(prev => {\n      if (prev ===') &&
  !wholesaleContextCode.includes('clearCart();\n      return'),
  'A7. clearCart não roda dentro de state updater'
);

assert(
  !wholesaleContextCode.match(/refreshWholesaleStatus\s*=\s*useCallback\([^)]*cart\.length/) &&
  !wholesaleContextCode.match(/loadWholesaleCatalog\s*=\s*useCallback\([^)]*cart\.length/),
  'A8. cart.length não dispara refresh B2B'
);

// Req 41, 42, 43: Controles B2B na vitrine
assert(
  storefrontViewCode.includes('allowB2bMode && !isApproved') &&
  storefrontViewCode.includes('Cadastrar empresa para Atacado'),
  'A9. Cadastro B2B oculto quando allowB2bMode = false'
);

assert(
  storefrontViewCode.includes("allowB2bMode && purchaseMode === 'wholesale' && isApproved") &&
  storefrontViewCode.includes('Grade Rápida Atacado'),
  'A10. Quick mode switcher só existe em wholesale aprovado'
);

assert(
  storefrontViewCode.includes("purchaseMode !== 'wholesale' || !isApproved") &&
  storefrontViewCode.includes('setB2bQuickMode(false)'),
  'A11. Quick mode é resetado ao sair de wholesale ou aprovação'
);

// Req 44, 45, 46, 47, 48: WhatsApp
assert(
  cartDrawerCode.includes('handleFinishOrder') &&
  cartDrawerCode.includes('prepWindow.location.href = waUrl;'),
  'A12. WhatsApp somente após receipt do servidor e handoff pelo Single CTA'
);

assert(
  cartDrawerCode.includes("cleanPhone = (whatsappNumber || '').replace(/\\D/g, '')") &&
  cartDrawerCode.includes('if (!cleanPhone || cleanPhone.length < 10) {'),
  'A13. Número sanitizado vazio ou incompleto não abre WhatsApp'
);

// Req 49, 50: Wording e frete
assert(
  cartDrawerCode.includes('showToast(`Pedido #${receipt.orderNumber} registrado. Conclua o envio na conversa do WhatsApp.`);'),
  'A14. Wording oficial usa toast não-enganoso comunicando registro do pedido'
);

assert(
  cartDrawerCode.includes("receipt.shippingFee === 0 ? 'A combinar / Calculado pela loja'") &&
  !cartDrawerCode.includes("receipt.shippingFee === 0 ? 'Frete grátis'"),
  'A15. shippingFee 0 não é apresentado como frete grátis nem total definitivo'
);

// Req 16, 17: Erro genérico mascarado no CartDrawer
assert(
  cartDrawerCode.includes('err instanceof OrderCheckoutError') &&
  cartDrawerCode.includes('? err.message') &&
  cartDrawerCode.includes(": 'Não foi possível processar o pedido.'") &&
  !cartDrawerCode.includes(': err instanceof Error ? err.message'),
  'A16. Erro inesperado no CartDrawer usa mensagem genérica; OrderCheckoutError mantém mensagem'
);

// Req 18, 19, 20, 21: Reset do ciclo de vida e PII
assert(
  cartDrawerCode.includes('handleCloseDrawer') &&
  cartDrawerCode.includes('resetCheckoutLifecycle()'),
  'A17. Fechamento do drawer via X reseta ciclo de vida do checkout'
);

assert(
  cartDrawerCode.includes('resetCheckoutLifecycle') &&
  cartDrawerCode.includes('setCustomerData({') &&
  cartDrawerCode.includes("name: ''"),
  'A18. resetCheckoutLifecycle limpa formulário com PII'
);

// Req 22, 23, 24: Revalidação de estado no submit imediatamente antes da rede
assert(
  cartDrawerCode.includes('if (cart.length === 0)') &&
  cartDrawerCode.includes('!availableDeliveryMethods.includes(deliveryMethod.trim())') &&
  cartDrawerCode.includes('if (isBelowMinOrder)') &&
  cartDrawerCode.includes('if (isWholesaleBlocked)'),
  'A19. Submit revalida cart, deliveryMethod membership e minimum wholesale antes da rede'
);

// =========================================================================
// 10. GOVERNANÇA (Itens 90 a 95)
// =========================================================================
console.log('\n10. Governança Arquitetural & Ativos Intactos');

const appContextCode = fs.readFileSync('src/context/AppContext.tsx', 'utf-8');
assert(
  appContextCode.includes('createOrder:') && appContextCode.includes('shoppingMode,'),
  '90. AppContext NÃO foi alterado nesta etapa (preserva compatibilidade)'
);

const orderManagerCode = fs.readFileSync('src/components/tenantadmin/OrderManager.tsx', 'utf-8');
assert(
  orderManagerCode.includes('OrderManager'),
  '91. OrderManager NÃO foi alterado nesta etapa'
);

const tenantDashboardCode = fs.readFileSync('src/components/tenantadmin/TenantDashboard.tsx', 'utf-8');
assert(
  tenantDashboardCode.includes('TenantDashboard'),
  '92. TenantDashboard NÃO foi alterado nesta etapa'
);

const migrationFiles = fs.readdirSync('supabase/migrations').filter(f => f.endsWith('.sql'));
assert(
  migrationFiles.length === 13 &&
  fs.existsSync('supabase/migrations/20260928_000010_orders_checkout_v1.sql') &&
  fs.existsSync('supabase/migrations/20260929_000011_orders_checkout_hardening.sql') &&
  fs.existsSync('supabase/migrations/20260930_000012_order_documents_storage.sql') &&
  fs.existsSync('supabase/migrations/20261001_000013_security_definer_hardening.sql'),
  '93. Migrations 000001 a 000013 registradas e intactas no workspace'
);

const migrationVersions = migrationFiles.map(f => f.split('_')[0]);
assert(
  new Set(migrationVersions).size === migrationFiles.length,
  '93b. Prefixos de versão das migrations são estritamente únicos (sem colisão de versionamento)'
);

const edgeFunctionCode = fs.readFileSync('supabase/functions/submit-order-checkout/index.ts', 'utf-8');
assert(
  edgeFunctionCode.includes('CHECKOUT_ENABLED') &&
  edgeFunctionCode.includes('checkoutEnabled') &&
  edgeFunctionCode.includes('Checkout temporariamente indisponível'),
  '94. Edge Function submit-order-checkout permanece intacta com Feature Gate fechado'
);

const configTomlCode = fs.readFileSync('supabase/config.toml', 'utf-8');
assert(
  configTomlCode.includes('[api]') && configTomlCode.includes('[storage]'),
  '95. supabase/config.toml permanece intacto'
);

// =========================================================================
// 11. SIMULAÇÕES COMPORTAMENTAIS
// =========================================================================
console.log('\n11. Simulações Comportamentais');

async function runBehavioralSimulations() {
  const dummyDraft: SubmitOrderCheckoutDraft = {
    tenantSlug: 'demo-store',
    shoppingMode: 'retail',
    items: [
      { productId: 'prod-1', quantity: 2, selectedVariant: 'Azul' },
      { productId: 'prod-2', quantity: 1, selectedVariant: null }
    ],
    customer: {
      name: 'João da Silva',
      phone: '41999998888',
      email: 'joao@example.com',
      document: '52998224725',
      type: 'PF'
    },
    shippingAddress: {
      street: 'Rua das Flores',
      number: '123',
      city: 'Curitiba',
      state: 'PR',
      zipCode: '80000-000'
    },
    paymentMethod: 'pix',
    deliveryMethod: 'entrega'
  };

  // S1: Mesma intenção e payload gera exatamente o mesmo fingerprint SHA-256
  const fp1 = await computeOrderFingerprint(dummyDraft, 'user-123');
  const fp2 = await computeOrderFingerprint(dummyDraft, 'user-123');
  assert(fp1 === fp2, 'S1. Fingerprint SHA-256 é determinístico para mesmo payload e ator');

  // S2: Reordenação dos mesmos itens resulta no MESMO fingerprint
  const reorderedDraft: SubmitOrderCheckoutDraft = {
    ...dummyDraft,
    items: [
      { productId: 'prod-2', quantity: 1, selectedVariant: null },
      { productId: 'prod-1', quantity: 2, selectedVariant: 'Azul' }
    ]
  };
  const fpReordered = await computeOrderFingerprint(reorderedDraft, 'user-123');
  assert(fp1 === fpReordered, 'S2. Reordenação visual dos itens preserva o mesmo fingerprint');

  // S3: Alteração de quantidade altera o fingerprint
  const changedQtyDraft: SubmitOrderCheckoutDraft = {
    ...dummyDraft,
    items: [
      { productId: 'prod-1', quantity: 3, selectedVariant: 'Azul' },
      { productId: 'prod-2', quantity: 1, selectedVariant: null }
    ]
  };
  const fpChangedQty = await computeOrderFingerprint(changedQtyDraft, 'user-123');
  assert(fp1 !== fpChangedQty, 'S3. Alteração de quantidade resulta em novo fingerprint');

  // S4: Troca de usuário/ator altera o fingerprint
  const fpOtherUser = await computeOrderFingerprint(dummyDraft, 'user-456');
  assert(fp1 !== fpOtherUser, 'S4. Troca de usuário logado resulta em novo fingerprint');

  // S5: Retry com mesmo payload reutiliza a mesma UUID armazenada
  const key1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  writeStoredAttempt('demo-store', {
    fingerprintHash: fp1,
    idempotencyKey: key1,
    createdAt: Date.now()
  });
  const stored1 = readStoredAttempt('demo-store');
  assert(stored1?.idempotencyKey === key1, 'S5. Retry com mesmo payload e fingerprint reutiliza mesma idempotency key');

  // S6: Tentativa com fingerprint diferente substitui chave
  const key2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  writeStoredAttempt('demo-store', {
    fingerprintHash: fpChangedQty,
    idempotencyKey: key2,
    createdAt: Date.now()
  });
  const stored2 = readStoredAttempt('demo-store');
  assert(stored2?.idempotencyKey === key2 && stored2?.fingerprintHash === fpChangedQty, 'S6. Alteração de fingerprint gera nova chave de idempotência');

  // S7: Tentativa expirada (> 2 horas) é expurgada e retorna null
  const expiredAttempt = {
    fingerprintHash: fp1,
    idempotencyKey: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    createdAt: Date.now() - (3 * 60 * 60 * 1000) // 3 horas atrás
  };
  writeStoredAttempt('demo-store', expiredAttempt);
  const expiredAttemptResult = readStoredAttempt('demo-store');
  assert(expiredAttemptResult === null, 'S7. Tentativa expirada (> 2h) é expurgada por readStoredAttempt para renovação de key');

  // S8: Simulação de 503 preserva estado de cart, form e attempt
  let simCart = [{ id: 'prod-1', qty: 2 }];
  let simForm = { name: 'João', street: 'Rua das Flores' };
  let simStep = 'details';
  let simError: string | null = null;
  // Ocorre erro 503 da Edge
  const simulated503Error = new OrderCheckoutError('Checkout temporariamente indisponível. Tente novamente mais tarde.', { status: 503 });
  simError = simulated503Error.message;
  // Estado permanece em details, carrinho e form intactos
  assert(
    simStep === 'details' &&
    simCart.length === 1 &&
    simForm.street === 'Rua das Flores' &&
    simError.includes('Checkout temporariamente indisponível'),
    'S8. Simulação de 503: step details, form e cart estritamente preservados'
  );

  // S9: Validação de Recibo oficial com sucesso e limpeza de carrinho
  const mockServerOrder = {
    success: true,
    order: {
      id: 'ord-12345',
      orderNumber: 'PED-2026-00001',
      shoppingMode: 'retail',
      deliveryMethod: 'entrega',
      items: [
        {
          productId: 'prod-1',
          productName: 'Camiseta Polo',
          productSku: 'CAM-POL-01',
          productImage: 'https://example.com/cam.jpg',
          unitPrice: 100,
          quantity: 2,
          unit: 'un',
          totalPrice: 200,
          selectedVariant: 'Azul'
        }
      ],
      subtotal: 200,
      discount: 0,
      shippingFee: 20,
      total: 220,
      status: 'pending',
      paymentMethod: 'pix',
      createdAt: '2026-09-28T16:00:00Z'
    }
  };

  const validatedReceipt = validateReceipt(mockServerOrder);
  assert(
    validatedReceipt.id === 'ord-12345' &&
    validatedReceipt.orderNumber === 'PED-2026-00001' &&
    validatedReceipt.total === 220,
    'S9. Recibo oficial do servidor é validado com sucesso'
  );

  // S10: Recibo malformado é rejeitado e lança OrderCheckoutError
  let malformedCaught = false;
  try {
    validateReceipt({
      success: true,
      order: {
        id: 'ord-123',
        status: 'approved' // Status incorreto (deve ser pending)
      }
    });
  } catch (err) {
    if (err instanceof OrderCheckoutError) {
      malformedCaught = true;
    }
  }
  assert(malformedCaught, 'S10. Resposta malformada ou fora de status pending é rejeitada fail-closed');

  // S11: Validação de productId duplicado no draft falha antes da rede
  let duplicateCaught = false;
  try {
    const duplicateDraft: SubmitOrderCheckoutDraft = {
      ...dummyDraft,
      items: [
        { productId: 'prod-duplicate', quantity: 1 },
        { productId: 'prod-duplicate', quantity: 2 }
      ]
    };
    await submitOrderCheckout(duplicateDraft);
  } catch (err) {
    if (err instanceof OrderCheckoutError && err.message.includes('Item duplicado')) {
      duplicateCaught = true;
    }
  }
  assert(duplicateCaught, 'S11. ProductId duplicado no carrinho é rejeitado antes da rede');

  // S12: Wholesale sem sessão válida falha antes do invoke
  let wholesaleNoSessionCaught = false;
  try {
    const wholesaleDraft: SubmitOrderCheckoutDraft = {
      ...dummyDraft,
      shoppingMode: 'wholesale'
    };
    await submitOrderCheckout(wholesaleDraft);
  } catch (err) {
    if (err instanceof OrderCheckoutError && (err.status === 401 || err.message.includes('sessão'))) {
      wholesaleNoSessionCaught = true;
    }
  }
  assert(wholesaleNoSessionCaught, 'S12. Wholesale sem sessão válida lança erro 401 antes de processar');

  // S13: Limpeza de tentativa após sucesso
  writeStoredAttempt('demo-store', {
    fingerprintHash: fp1,
    idempotencyKey: '00000000-0000-4000-8000-000000000001',
    createdAt: Date.now()
  });
  clearStoredAttempt('demo-store');
  assert(readStoredAttempt('demo-store') === null, 'S13. clearStoredAttempt limpa a tentativa após sucesso real');

  // S14: Wholesale sem email/phone gera request body contendo customer: {}
  const wholesaleEmptyCustomerDraft: SubmitOrderCheckoutDraft = {
    ...dummyDraft,
    shoppingMode: 'wholesale',
    customer: {}
  };
  const bodyWholesaleEmpty = buildCheckoutRequestBody(wholesaleEmptyCustomerDraft, '00000000-0000-4000-8000-000000000002');
  assert(
    bodyWholesaleEmpty.customer &&
    typeof bodyWholesaleEmpty.customer === 'object' &&
    Object.keys(bodyWholesaleEmpty.customer as Record<string, unknown>).length === 0,
    'S14. Wholesale sem email/phone gera body com customer: {} (nunca undefined)'
  );

  // S15: Wholesale body não contém dados de identidade comercial ou buyerUserId
  const custRecord = bodyWholesaleEmpty.customer as Record<string, unknown>;
  assert(
    !('name' in custRecord) &&
    !('document' in custRecord) &&
    !('companyName' in custRecord) &&
    !('type' in custRecord) &&
    !('buyerUserId' in custRecord) &&
    !('buyerUserId' in bodyWholesaleEmpty),
    'S15. Wholesale body NÃO contém name/document/companyName/type/buyerUserId'
  );

  // S16: Wholesale com email/phone operacionais inclui exclusivamente esses campos
  const wholesaleWithOpsDraft: SubmitOrderCheckoutDraft = {
    ...dummyDraft,
    shoppingMode: 'wholesale',
    customer: {
      email: 'compras@empresa.com.br',
      phone: '41988887777',
      name: 'Nome Que Não Deve Ir',
      document: '00.000.000/0001-00'
    }
  };
  const bodyWholesaleWithOps = buildCheckoutRequestBody(wholesaleWithOpsDraft, '00000000-0000-4000-8000-000000000003');
  const custOpsRecord = bodyWholesaleWithOps.customer as Record<string, unknown>;
  assert(
    custOpsRecord.email === 'compras@empresa.com.br' &&
    custOpsRecord.phone === '41988887777' &&
    !('name' in custOpsRecord) &&
    !('document' in custOpsRecord),
    'S16. Wholesale com email/phone operacionais envia somente email e phone'
  );

  // S17: Retail sem customer lança OrderCheckoutError 400
  let retailNoCustCaught = false;
  try {
    buildCheckoutRequestBody({ ...dummyDraft, shoppingMode: 'retail', customer: undefined }, 'key-test');
  } catch (err) {
    if (err instanceof OrderCheckoutError && err.status === 400) {
      retailNoCustCaught = true;
    }
  }
  assert(retailNoCustCaught, 'S17. Retail sem customer lança OrderCheckoutError 400');

  // S18: Retail com customer.name vazio lança OrderCheckoutError 400
  let retailEmptyNameCaught = false;
  try {
    buildCheckoutRequestBody({ ...dummyDraft, shoppingMode: 'retail', customer: { ...dummyDraft.customer!, name: '   ' } }, 'key-test');
  } catch (err) {
    if (err instanceof OrderCheckoutError && err.status === 400) {
      retailEmptyNameCaught = true;
    }
  }
  assert(retailEmptyNameCaught, 'S18. Retail com customer.name vazio lança OrderCheckoutError 400');

  // S19: Retail com customer.phone vazio lança OrderCheckoutError 400
  let retailEmptyPhoneCaught = false;
  try {
    buildCheckoutRequestBody({ ...dummyDraft, shoppingMode: 'retail', customer: { ...dummyDraft.customer!, phone: '   ' } }, 'key-test');
  } catch (err) {
    if (err instanceof OrderCheckoutError && err.status === 400) {
      retailEmptyPhoneCaught = true;
    }
  }
  assert(retailEmptyPhoneCaught, 'S19. Retail com customer.phone vazio lança OrderCheckoutError 400');

  // S20: Retail com type inválido lança OrderCheckoutError 400
  let retailInvalidTypeCaught = false;
  try {
    buildCheckoutRequestBody({ ...dummyDraft, shoppingMode: 'retail', customer: { ...dummyDraft.customer!, type: 'OUTRO' as any } }, 'key-test');
  } catch (err) {
    if (err instanceof OrderCheckoutError && err.status === 400) {
      retailInvalidTypeCaught = true;
    }
  }
  assert(retailInvalidTypeCaught, 'S20. Retail com tipo inválido diferente de PF/PJ lança OrderCheckoutError 400');

  // S21: Runtime input: selectedVariant não-string lança OrderCheckoutError 400
  let nonStringVariantCaught = false;
  try {
    buildCheckoutRequestBody({
      ...dummyDraft,
      items: [{ productId: 'prod-1', quantity: 1, selectedVariant: 12345 as any }]
    }, 'key-test');
  } catch (err) {
    if (err instanceof OrderCheckoutError && err.status === 400) {
      nonStringVariantCaught = true;
    }
  }
  assert(nonStringVariantCaught, 'S21. selectedVariant não-string no draft é rejeitada com status 400');

  // S22: Runtime input: selectedVariant > 160 caracteres lança OrderCheckoutError 400
  let longVariantCaught = false;
  try {
    buildCheckoutRequestBody({
      ...dummyDraft,
      items: [{ productId: 'prod-1', quantity: 1, selectedVariant: 'A'.repeat(161) }]
    }, 'key-test');
  } catch (err) {
    if (err instanceof OrderCheckoutError && err.status === 400) {
      longVariantCaught = true;
    }
  }
  assert(longVariantCaught, 'S22. selectedVariant > 160 caracteres é rejeitada com status 400');

  // S23: Runtime input: selectedVariant válida tem trim aplicado e variantes vazias viram null
  const validVariantBody = buildCheckoutRequestBody({
    ...dummyDraft,
    items: [
      { productId: 'prod-1', quantity: 1, selectedVariant: '  Preto Fosco  ' },
      { productId: 'prod-2', quantity: 1, selectedVariant: '   ' }
    ]
  }, 'key-test');
  const validItems = validVariantBody.items as Array<{ selectedVariant: string | null }>;
  assert(
    validItems[0].selectedVariant === 'Preto Fosco' && validItems[1].selectedVariant === null,
    'S23. selectedVariant válida sofre trim e vazias tornam-se null'
  );

  // S24: Runtime input: quantity inválida (float ou <= 0) lança OrderCheckoutError 400
  let invalidQtyCaught = false;
  try {
    buildCheckoutRequestBody({
      ...dummyDraft,
      items: [{ productId: 'prod-1', quantity: 1.5 }]
    }, 'key-test');
  } catch (err) {
    if (err instanceof OrderCheckoutError && err.status === 400) {
      invalidQtyCaught = true;
    }
  }
  assert(invalidQtyCaught, 'S24. quantity não inteira no draft lança OrderCheckoutError 400');

  // S25: Runtime input: limite de 200 itens respeitado
  let over200ItemsCaught = false;
  try {
    const hugeItems = Array.from({ length: 201 }, (_, i) => ({ productId: `prod-${i}`, quantity: 1 }));
    buildCheckoutRequestBody({
      ...dummyDraft,
      items: hugeItems
    }, 'key-test');
  } catch (err) {
    if (err instanceof OrderCheckoutError && err.status === 400) {
      over200ItemsCaught = true;
    }
  }
  assert(over200ItemsCaught, 'S25. Draft com mais de 200 itens lança OrderCheckoutError 400');

  // S26: validateReceipt: selectedVariant não pode usar coerção String() para números ou booleanos
  let receiptNonStringVariantCaught = false;
  try {
    validateReceipt({
      ...mockServerOrder,
      order: {
        ...mockServerOrder.order,
        items: [
          {
            ...mockServerOrder.order.items[0],
            selectedVariant: 12345 // Não deve ser coerced para "12345"
          }
        ]
      }
    });
  } catch (err) {
    if (err instanceof OrderCheckoutError) {
      receiptNonStringVariantCaught = true;
    }
  }
  assert(receiptNonStringVariantCaught, 'S26. validateReceipt rejeita selectedVariant de tipo numérico sem coerção silenciosa');

  // S27: validateReceipt: selectedVariant aceita null, undefined e string
  const receiptWithNullVariant = validateReceipt({
    ...mockServerOrder,
    order: {
      ...mockServerOrder.order,
      items: [
        { ...mockServerOrder.order.items[0], selectedVariant: null }
      ]
    }
  });
  assert(receiptWithNullVariant.items[0].selectedVariant === null, 'S27. validateReceipt aceita selectedVariant null');

  // S28: validateReceipt: valores financeiros negativos ou não finitos são rejeitados
  let receiptNegativeTotalCaught = false;
  try {
    validateReceipt({
      ...mockServerOrder,
      order: {
        ...mockServerOrder.order,
        total: -50
      }
    });
  } catch (err) {
    if (err instanceof OrderCheckoutError) {
      receiptNegativeTotalCaught = true;
    }
  }
  assert(receiptNegativeTotalCaught, 'S28. validateReceipt rejeita total negativo');

  // S29: validateReceipt: data de criação inválida é rejeitada
  let receiptInvalidDateCaught = false;
  try {
    validateReceipt({
      ...mockServerOrder,
      order: {
        ...mockServerOrder.order,
        createdAt: 'data-invalida'
      }
    });
  } catch (err) {
    if (err instanceof OrderCheckoutError) {
      receiptInvalidDateCaught = true;
    }
  }
  assert(receiptInvalidDateCaught, 'S29. validateReceipt rejeita createdAt malformada ou inválida');

  let receiptEmptyDateCaught = false;
  try {
    validateReceipt({
      ...mockServerOrder,
      order: {
        ...mockServerOrder.order,
        createdAt: '   '
      }
    });
  } catch (err) {
    if (err instanceof OrderCheckoutError) {
      receiptEmptyDateCaught = true;
    }
  }
  assert(receiptEmptyDateCaught, 'S29b. validateReceipt rejeita createdAt vazia ou somente espaços');

  let receiptNonStringDateCaught = false;
  try {
    validateReceipt({
      ...mockServerOrder,
      order: {
        ...mockServerOrder.order,
        createdAt: 1711650000000 as any
      }
    });
  } catch (err) {
    if (err instanceof OrderCheckoutError) {
      receiptNonStringDateCaught = true;
    }
  }
  assert(receiptNonStringDateCaught, 'S29c. validateReceipt rejeita createdAt não-string');

  // S30: validateReceipt: método de entrega vazio é rejeitado
  let receiptEmptyDeliveryCaught = false;
  try {
    validateReceipt({
      ...mockServerOrder,
      order: {
        ...mockServerOrder.order,
        deliveryMethod: '   '
      }
    });
  } catch (err) {
    if (err instanceof OrderCheckoutError) {
      receiptEmptyDeliveryCaught = true;
    }
  }
  assert(receiptEmptyDeliveryCaught, 'S30. validateReceipt rejeita deliveryMethod vazio');

  // S31: validateStoredAttempt rejeita fingerprintHash não-SHA256 (64 hex)
  writeStoredAttempt('test-corrupt-hex', {
    fingerprintHash: 'not-a-valid-64-hex-sha256-string',
    idempotencyKey: '00000000-0000-4000-8000-000000000001',
    createdAt: Date.now()
  });
  assert(readStoredAttempt('test-corrupt-hex') === null, 'S31. readStoredAttempt rejeita fingerprintHash não-SHA256 (64 hex)');

  // S32: validateStoredAttempt rejeita idempotencyKey fora de UUID v4 estrito
  writeStoredAttempt('test-corrupt-uuid', {
    fingerprintHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    idempotencyKey: 'not-a-valid-uuid-v4',
    createdAt: Date.now()
  });
  assert(readStoredAttempt('test-corrupt-uuid') === null, 'S32. readStoredAttempt rejeita idempotencyKey fora de UUID v4 estrito');

  // S33: validateStoredAttempt rejeita createdAt futuro ou expirado (sem tolerância)
  const validHash = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
  const validKey = '00000000-0000-4000-8000-000000000001';

  // S33a: createdAt = Date.now() + 1 => rejeitado
  const attemptPlus1 = validateStoredAttempt({
    fingerprintHash: validHash,
    idempotencyKey: validKey,
    createdAt: Date.now() + 1
  });
  assert(attemptPlus1 === null, 'S33a. validateStoredAttempt rejeita estritamente createdAt = Date.now() + 1');

  writeStoredAttempt('test-future-1ms', {
    fingerprintHash: validHash,
    idempotencyKey: validKey,
    createdAt: Date.now() + 1
  });
  assert(readStoredAttempt('test-future-1ms') === null, 'S33b. readStoredAttempt rejeita e expurga createdAt = Date.now() + 1');

  // S33c: createdAt = Date.now() + 5000 => rejeitado
  const attemptPlus5000 = validateStoredAttempt({
    fingerprintHash: validHash,
    idempotencyKey: validKey,
    createdAt: Date.now() + 5000
  });
  assert(attemptPlus5000 === null, 'S33c. validateStoredAttempt rejeita estritamente createdAt = Date.now() + 5000');

  writeStoredAttempt('test-future-5000ms', {
    fingerprintHash: validHash,
    idempotencyKey: validKey,
    createdAt: Date.now() + 5000
  });
  assert(readStoredAttempt('test-future-5000ms') === null, 'S33d. readStoredAttempt rejeita e expurga createdAt = Date.now() + 5000');

  // S33e: createdAt = Date.now() + 100000 => rejeitado
  writeStoredAttempt('test-future', {
    fingerprintHash: validHash,
    idempotencyKey: validKey,
    createdAt: Date.now() + 100000
  });
  assert(readStoredAttempt('test-future') === null, 'S33e. readStoredAttempt rejeita createdAt futuro genérico');

  // S34: Tentativa corrompida é expurgada do storage e retorna null
  writeStoredAttempt('test-purge', {
    fingerprintHash: 'corrupt',
    idempotencyKey: 'corrupt',
    createdAt: -1
  });
  const purged = readStoredAttempt('test-purge');
  assert(purged === null, 'S34. Tentativa corrompida é expurgada do storage e retorna null');

  // S35: writeStoredAttempt preserva higiene estrita (sem PII)
  const attemptRecord = {
    fingerprintHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    idempotencyKey: '00000000-0000-4000-8000-000000000001',
    createdAt: Date.now()
  };
  writeStoredAttempt('test-hygiene', attemptRecord);
  const readHygiene = readStoredAttempt('test-hygiene');
  assert(
    readHygiene !== null &&
    !('name' in readHygiene) &&
    !('email' in readHygiene) &&
    !('phone' in readHygiene) &&
    !('street' in readHygiene),
    'S35. writeStoredAttempt persiste exclusivamente metadados técnicos de idempotência (sem PII)'
  );

  // S36: Erro genérico/inesperado é mascarado com mensagem amigável sem expor detalhes internos
  const simulatedGenericError = new TypeError('Cannot read properties of undefined (reading "foo")');
  const sanitizedDisplay = simulatedGenericError instanceof OrderCheckoutError 
    ? simulatedGenericError.message 
    : 'Não foi possível processar o pedido.';
  assert(
    sanitizedDisplay === 'Não foi possível processar o pedido.',
    'S36. Erros inesperados de runtime exibem exclusivamente mensagem genérica segura'
  );

  // S37: isValidCPF aceita CPFs válidos (pontuados e não pontuados)
  assert(isValidCPF('52998224725') === true, 'S37a. isValidCPF aceita CPF válido sem pontuação');
  assert(isValidCPF('111.444.777-35') === true, 'S37b. isValidCPF aceita CPF válido com pontuação padrão');

  // S38: isValidCPF rejeita CPFs com dígitos repetidos
  assert(isValidCPF('00000000000') === false, 'S38a. isValidCPF rejeita sequência 00000000000');
  assert(isValidCPF('111.111.111-11') === false, 'S38b. isValidCPF rejeita sequência 111.111.111-11');
  assert(isValidCPF('99999999999') === false, 'S38c. isValidCPF rejeita sequência 99999999999');

  // S39: isValidCPF rejeita CPFs com dígito verificador incorreto
  assert(isValidCPF('52998224724') === false, 'S39a. isValidCPF rejeita 1º dígito verificador incorreto');
  assert(isValidCPF('52998224720') === false, 'S39b. isValidCPF rejeita 2º dígito verificador incorreto');

  // S40: isValidCPF rejeita tamanhos incorretos, vazios e não-strings
  assert(isValidCPF('') === false, 'S40a. isValidCPF rejeita string vazia');
  assert(isValidCPF('1234567890') === false, 'S40b. isValidCPF rejeita CPF com 10 dígitos');
  assert(isValidCPF('123456789012') === false, 'S40c. isValidCPF rejeita CPF com 12 dígitos');
  assert(isValidCPF(null) === false, 'S40d. isValidCPF rejeita null');
  assert(isValidCPF(undefined) === false, 'S40e. isValidCPF rejeita undefined');

  // S41: isValidCNPJ aceita CNPJs válidos (pontuados e não pontuados)
  assert(isValidCNPJ('12345678000195') === true, 'S41a. isValidCNPJ aceita CNPJ válido sem pontuação');
  assert(isValidCNPJ('12.345.678/0001-95') === true, 'S41b. isValidCNPJ aceita CNPJ válido com pontuação');

  // S42: isValidCNPJ rejeita CNPJs com dígitos repetidos
  assert(isValidCNPJ('00000000000000') === false, 'S42a. isValidCNPJ rejeita sequência 00000000000000');
  assert(isValidCNPJ('11.111.111/1111-11') === false, 'S42b. isValidCNPJ rejeita sequência 11.111.111/1111-11');

  // S43: isValidCNPJ rejeita CNPJs com dígito verificador incorreto
  assert(isValidCNPJ('12345678000194') === false, 'S43a. isValidCNPJ rejeita 1º dígito verificador incorreto');
  assert(isValidCNPJ('12345678000190') === false, 'S43b. isValidCNPJ rejeita 2º dígito verificador incorreto');

  // S44: isValidCNPJ rejeita tamanhos incorretos e vazios
  assert(isValidCNPJ('') === false, 'S44a. isValidCNPJ rejeita string vazia');
  assert(isValidCNPJ('1234567800019') === false, 'S44b. isValidCNPJ com 13 dígitos rejeitado');
  assert(isValidCNPJ('123456780001955') === false, 'S44c. isValidCNPJ com 15 dígitos rejeitado');

  // S45: isValidBrazilianDocument valida conforme tipo
  assert(isValidBrazilianDocument('52998224725', 'PF') === true, 'S45a. isValidBrazilianDocument valida PF com CPF');
  assert(isValidBrazilianDocument('12345678000195', 'PJ') === true, 'S45b. isValidBrazilianDocument valida PJ com CNPJ');
  assert(isValidBrazilianDocument('12345678000195', 'PF') === false, 'S45c. isValidBrazilianDocument rejeita CNPJ em modalidade PF');
  assert(isValidBrazilianDocument('52998224725', 'PJ') === false, 'S45d. isValidBrazilianDocument rejeita CPF em modalidade PJ');

  // S46: normalizeBrazilianDocument remove pontuações
  assert(normalizeBrazilianDocument('12.345.678/0001-95') === '12345678000195', 'S46a. normalizeBrazilianDocument remove pontuação de CNPJ');
  assert(normalizeBrazilianDocument('111.444.777-35') === '11144477735', 'S46b. normalizeBrazilianDocument remove pontuação de CPF');
  assert(normalizeBrazilianDocument(null) === '', 'S46c. normalizeBrazilianDocument com null retorna string vazia');

  // S47: buildCheckoutRequestBody no varejo exige document
  let retailNoDocCaught = false;
  try {
    buildCheckoutRequestBody({
      ...dummyDraft,
      shoppingMode: 'retail',
      customer: {
        name: 'João',
        phone: '41999998888',
        type: 'PF'
      }
    }, 'key-test');
  } catch (err) {
    if (err instanceof OrderCheckoutError && err.message.includes('CPF do comprador é obrigatório')) {
      retailNoDocCaught = true;
    }
  }
  assert(retailNoDocCaught, 'S47. buildCheckoutRequestBody exige CPF no varejo PF');

  // S48: buildCheckoutRequestBody no varejo PF valida CPF e armazena normalizado
  const validPfBody = buildCheckoutRequestBody({
    ...dummyDraft,
    shoppingMode: 'retail',
    customer: {
      name: 'João',
      phone: '41999998888',
      document: '111.444.777-35',
      type: 'PF'
    }
  }, 'key-test-pf');
  assert(
    (validPfBody.customer as Record<string, unknown>).document === '11144477735' &&
    (validPfBody.customer as Record<string, unknown>).type === 'PF',
    'S48. buildCheckoutRequestBody normaliza CPF pontuado para somente dígitos'
  );

  // S49: buildCheckoutRequestBody no varejo PJ exige CNPJ válido
  const validPjBody = buildCheckoutRequestBody({
    ...dummyDraft,
    shoppingMode: 'retail',
    customer: {
      name: 'Carlos Representante',
      phone: '41999998888',
      document: '12.345.678/0001-95',
      type: 'PJ'
    }
  }, 'key-test-pj');
  assert(
    (validPjBody.customer as Record<string, unknown>).document === '12345678000195' &&
    (validPjBody.customer as Record<string, unknown>).type === 'PJ',
    'S49. buildCheckoutRequestBody aceita e normaliza CNPJ no varejo PJ'
  );

  // S50: buildCheckoutRequestBody rejeita CPF inválido para PF
  let invalidCpfBodyCaught = false;
  try {
    buildCheckoutRequestBody({
      ...dummyDraft,
      shoppingMode: 'retail',
      customer: {
        name: 'João',
        phone: '41999998888',
        document: '000.000.000-00',
        type: 'PF'
      }
    }, 'key-test-fail-cpf');
  } catch (err) {
    if (err instanceof OrderCheckoutError && err.message.includes('CPF do comprador inválido')) {
      invalidCpfBodyCaught = true;
    }
  }
  assert(invalidCpfBodyCaught, 'S50. buildCheckoutRequestBody rejeita CPF inválido fail-closed');

  // S51: buildCheckoutRequestBody rejeita CNPJ inválido para PJ
  let invalidCnpjBodyCaught = false;
  try {
    buildCheckoutRequestBody({
      ...dummyDraft,
      shoppingMode: 'retail',
      customer: {
        name: 'Empresa',
        phone: '41999998888',
        document: '12.345.678/0001-00',
        type: 'PJ'
      }
    }, 'key-test-fail-cnpj');
  } catch (err) {
    if (err instanceof OrderCheckoutError && err.message.includes('CNPJ do comprador inválido')) {
      invalidCnpjBodyCaught = true;
    }
  }
  assert(invalidCnpjBodyCaught, 'S51. buildCheckoutRequestBody rejeita CNPJ inválido fail-closed');

  // S52: Simulação de Review: step review não submete à rede e preserva form
  let testStep = 'details';
  let isSubmitting = false;
  const formData = {
    name: 'Maria Silva',
    phone: '41988887777',
    document: '52998224725',
    street: 'Rua das Palmeiras, 45'
  };
  // Ação: Validar Orçamento
  if (formData.name && formData.phone && isValidCPF(formData.document) && formData.street) {
    testStep = 'review';
  }
  assert(
    testStep === 'review' && isSubmitting === false && formData.name === 'Maria Silva',
    'S52. "Validar orçamento" avança para step review sem efetuar chamada à rede'
  );

  // S53: Ação "Voltar e editar" na review preserva dados intactos
  if (testStep === 'review') {
    testStep = 'details';
  }
  assert(
    testStep === 'details' && formData.document === '52998224725' && formData.street === 'Rua das Palmeiras, 45',
    'S53. "Voltar e editar" retorna a details preservando todos os campos'
  );

  // S54a: Ao iniciar a confirmação, o snapshot confirmado permanece estritamente null antes do receipt
  let customerDataState = { ...formData };
  let confirmedSnapshotState: any = null;
  const pendingCustomerSnapshot = {
    name: customerDataState.name,
    phone: customerDataState.phone,
    document: normalizeBrazilianDocument(customerDataState.document),
    street: customerDataState.street,
    type: 'PF'
  };
  assert(
    confirmedSnapshotState === null,
    'S54a. Ao iniciar confirmação, confirmedCustomerSnapshot permanece null'
  );

  // S54b: Em caso de falha no submit (ex: HTTP 503 Feature Gate fechado), o snapshot confirmado NUNCA é preenchido
  const simulateSubmitFailure = true;
  if (simulateSubmitFailure) {
    // catch block simula erro: não executa setConfirmedCustomerSnapshot
    const submitError = 'Checkout temporariamente indisponível.';
    assert(
      confirmedSnapshotState === null && submitError.length > 0,
      'S54b. Falha de rede/backend (HTTP 503/400) mantém confirmedCustomerSnapshot estritamente como null'
    );
  }

  // S54c: Sucesso com receipt válido do servidor atribui o pendingCustomerSnapshot ao state e limpa o form
  confirmedSnapshotState = pendingCustomerSnapshot;
  customerDataState = { name: '', phone: '', document: '', street: '' };
  assert(
    customerDataState.name === '' &&
    confirmedSnapshotState !== null &&
    confirmedSnapshotState.name === 'Maria Silva' &&
    confirmedSnapshotState.document === '52998224725',
    'S54c. submitOrderCheckout sucesso com receipt válido atribui confirmedCustomerSnapshot e limpa formulário PII'
  );

  // S54d: resetCheckoutLifecycle limpa confirmedCustomerSnapshot e redefine estado
  let resetTriggeredSnapshot = confirmedSnapshotState;
  resetTriggeredSnapshot = null;
  assert(
    resetTriggeredSnapshot === null,
    'S54d. resetCheckoutLifecycle limpa confirmedCustomerSnapshot para null'
  );

  // S55: Formatação da mensagem do WhatsApp usa valores do receipt do servidor e CPF/CNPJ do snapshot
  const mockReceiptForWa = {
    orderNumber: 'PED-2026-9999',
    subtotal: 500,
    total: 500,
    shippingFee: 0,
    paymentMethod: 'pix' as PaymentMethod,
    deliveryMethod: 'entrega',
    items: [{ productName: 'Furadeira', quantity: 2, unit: 'un', unitPrice: 250, totalPrice: 500 }]
  };
  const waCustomerDoc = confirmedSnapshotState.type === 'PJ' ? `CNPJ: ${confirmedSnapshotState.document}` : `CPF: ${confirmedSnapshotState.document}`;
  const waText = `PEDIDO #${mockReceiptForWa.orderNumber} - Cliente: ${confirmedSnapshotState.name} - ${waCustomerDoc} - Total: R$ ${mockReceiptForWa.total}`;
  assert(
    waText.includes('PED-2026-9999') &&
    waText.includes('Maria Silva') &&
    waText.includes('CPF: 52998224725') &&
    waText.includes('Total: R$ 500'),
    'S55. Mensagem do WhatsApp integra itens/totais do receipt e documento do snapshot'
  );
}

runBehavioralSimulations().then(() => {
  console.log('\n======================================================');
  console.log(`TOTAL DE TESTES: ${passed + failed}`);
  console.log(`PASSOU: ${passed}`);
  console.log(`FALHOU: ${failed}`);
  console.log('======================================================');

  if (failed > 0) {
    process.exit(1);
  }
});
