import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  X,
  Trash2,
  Plus,
  Minus,
  ShoppingCart,
  MessageSquare,
  Check,
  Truck,
  CreditCard,
  QrCode,
  AlertCircle,
  ArrowRight,
  ArrowLeft,
  Building2,
  Clock,
  RefreshCw,
  Info,
  User,
  MapPin,
  FileText,
  Tag,
  CheckCircle2
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useAuth } from '../../context/AuthContext';
import { useWholesaleAccess } from '../../context/WholesaleAccessContext';
import { PaymentMethod, TenantPublicSettings } from '../../types';
import { AutomaticDeliveryEstimate } from './AutomaticDeliveryEstimate';
import { getSafeProductImage, handleProductImageError } from '../../utils/productImages';
import {
  submitOrderCheckout,
  computeOrderFingerprint,
  CheckoutOrderReceipt,
  SubmitOrderCheckoutDraft,
  OrderCheckoutError
} from '../../services/orderService';
import {
  normalizeBrazilianDocument,
  isValidCPF,
  isValidCNPJ
} from '../../utils/brDocument';
import { storeRetailOrderTracking } from '../../services/customerTrackingService';
import { CHECKOUT_FIELDS, CheckoutField, DEFAULT_CHECKOUT_FIELDS, checkoutRequiredErrors, projectCheckoutValues } from '../../config/checkoutFields';
import { buildOrderWhatsAppMessage } from '../../utils/orderWhatsAppMessage';

interface CartItemQuantityControlProps {
  quantity: number;
  stock?: number;
  min?: number;
  onUpdate: (qty: number) => void;
}

const CartItemQuantityControl: React.FC<CartItemQuantityControlProps> = ({
  quantity,
  stock,
  min = 1,
  onUpdate,
}) => {
  const [inputValue, setInputValue] = useState<string>(String(quantity));
  const [isFocused, setIsFocused] = useState<boolean>(false);

  useEffect(() => {
    if (!isFocused) {
      setInputValue(String(quantity));
    }
  }, [quantity, isFocused]);

  const maxAllowed = stock !== undefined && stock > 0 ? stock : Infinity;

  const commitValue = (raw: string) => {
    const trimmed = raw.trim();
    if (trimmed === '') {
      setInputValue(String(quantity));
      return;
    }

    let parsed = parseInt(trimmed, 10);
    if (isNaN(parsed) || parsed < min) {
      parsed = min;
    }
    if (parsed > maxAllowed) {
      parsed = maxAllowed;
    }

    setInputValue(String(parsed));
    if (parsed !== quantity) {
      onUpdate(parsed);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const cleaned = e.target.value.replace(/\D/g, '');
    setInputValue(cleaned);
  };

  const handleBlur = () => {
    setIsFocused(false);
    commitValue(inputValue);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.currentTarget.blur();
    } else if (e.key === 'Escape') {
      setInputValue(String(quantity));
      e.currentTarget.blur();
    }
  };

  const handleFocus = (e: React.FocusEvent<HTMLInputElement>) => {
    setIsFocused(true);
    e.target.select();
  };

  const handleDecrease = () => {
    const next = Math.max(min, quantity - 1);
    setInputValue(String(next));
    onUpdate(next);
  };

  const handleIncrease = () => {
    const next = Math.min(maxAllowed, quantity + 1);
    setInputValue(String(next));
    onUpdate(next);
  };

  return (
    <div className="flex items-center border border-slate-300 rounded-lg bg-white overflow-hidden shadow-2xs">
      <button
        type="button"
        onClick={handleDecrease}
        disabled={quantity <= min}
        className="w-7 h-7 flex items-center justify-center text-slate-600 hover:bg-slate-100 disabled:opacity-40 disabled:hover:bg-white cursor-pointer transition-colors"
        title="Diminuir quantidade"
      >
        <Minus className="w-3 h-3" />
      </button>

      <input
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        value={inputValue}
        onChange={handleChange}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        className="w-12 h-7 text-center text-xs font-bold text-slate-900 border-x border-slate-200 bg-transparent focus:outline-none focus:bg-orange-50 focus:border-[#FF5A00] transition-colors"
        aria-label="Quantidade do produto"
      />

      <button
        type="button"
        onClick={handleIncrease}
        disabled={quantity >= maxAllowed}
        className="w-7 h-7 flex items-center justify-center text-slate-600 hover:bg-slate-100 disabled:opacity-40 disabled:hover:bg-white cursor-pointer transition-colors"
        title="Aumentar quantidade"
      >
        <Plus className="w-3 h-3" />
      </button>
    </div>
  );
};

export interface ConfirmedCustomerSnapshot {
  type: 'PF' | 'PJ';
  name: string;
  document: string;
  companyName?: string;
  email?: string;
  phone: string;
  street: string;
  number?: string;
  complement?: string;
  neighborhood?: string;
  city?: string;
  state?: string;
  zipCode?: string;
  notes?: string;
  sellerCode?: string;
}

export const CartDrawer: React.FC<{
  settings?: TenantPublicSettings | null;
}> = ({ settings }) => {
  const {
    cart,
    updateCartQuantity,
    removeFromCart,
    clearCart,
    isCartOpen,
    setIsCartOpen,
    cartSubtotal,
    showToast
  } = useApp();

  // Modalidade de compra autoritativa da UI oficial
  const { purchaseMode, isApproved, wholesaleCompany } = useWholesaleAccess();
  const { user } = useAuth();
  const checkoutIdentity = `${settings?.slug || ''}:${user?.id || 'anonymous'}`;
  const currentIdentityRef = useRef(checkoutIdentity);
  currentIdentityRef.current = checkoutIdentity;
  const previousIdentityRef = useRef(checkoutIdentity);

  const [checkoutStep, setCheckoutStep] = useState<'cart' | 'details' | 'review'>('cart');
  const [createdOrder, setCreatedOrder] = useState<CheckoutOrderReceipt | null>(null);
  // Vínculo criptográfico entre o recibo já registrado e o draft/usuário original.
  const [createdOrderFingerprint, setCreatedOrderFingerprint] = useState<string | null>(null);
  const [confirmedCustomerSnapshot, setConfirmedCustomerSnapshot] = useState<ConfirmedCustomerSnapshot | null>(null);
  const [isSubmittingOrder, setIsSubmittingOrder] = useState<boolean>(false);
  const [submittingStateText, setSubmittingStateText] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Métodos de entrega provenientes exclusivamente das configurações oficiais da loja
  const availableDeliveryMethods = settings?.deliveryMethods || [];
  const [deliveryMethod, setDeliveryMethod] = useState<string>('');

  useEffect(() => {
    if (availableDeliveryMethods.length > 0) {
      if (!availableDeliveryMethods.includes(deliveryMethod)) {
        setDeliveryMethod(availableDeliveryMethods[0]);
      }
    } else {
      setDeliveryMethod('');
    }
  }, [availableDeliveryMethods, deliveryMethod]);

  // Customer & Shipping Details State (sem defaults fictícios de endereço)
  const [customerData, setCustomerData] = useState({
    name: '',
    type: 'PJ' as 'PF' | 'PJ',
    document: '',
    companyName: '',
    email: '',
    phone: '',
    street: '',
    number: '',
    complement: '',
    neighborhood: '',
    city: '',
    state: '',
    zipCode: '',
    paymentMethod: 'pix' as PaymentMethod,
    notes: '',
    sellerCode: ''
  });

  const checkoutFields = settings?.checkoutFields ?? DEFAULT_CHECKOUT_FIELDS;
  const formValues = projectCheckoutValues(checkoutFields, customerData, purchaseMode === 'wholesale');

  const [errors, setErrors] = useState<Record<string, string>>({});

  const resetCheckoutLifecycle = useCallback(() => {
    setCheckoutStep('cart');
    setCreatedOrder(null);
    setCreatedOrderFingerprint(null);
    setConfirmedCustomerSnapshot(null);
    setSubmitError(null);
    setSubmittingStateText(null);
    setErrors({});
    setCustomerData({
      name: '',
      type: 'PJ',
      document: '',
      companyName: '',
      email: '',
      phone: '',
      street: '',
      number: '',
      complement: '',
      neighborhood: '',
      city: '',
      state: '',
      zipCode: '',
      paymentMethod: 'pix',
      notes: '',
      sellerCode: ''
    });
  }, []);

  // Clear cached receipt and customer PII on buyer/tenant change. Stable identity
  // across JWT refresh avoids needless checkout resets.
  useEffect(() => {
    if (previousIdentityRef.current !== checkoutIdentity) {
      previousIdentityRef.current = checkoutIdentity;
      resetCheckoutLifecycle();
    }
  }, [checkoutIdentity, resetCheckoutLifecycle]);

  const handleCloseDrawer = () => {
    setIsCartOpen(false);
  };

  if (!isCartOpen) return null;

  const storeName = settings?.publicName || 'Corsys.Catálogo';
  const whatsappNumber = settings?.whatsappNumber || '';

  // Regras Oficiais de Pedido Mínimo derivadas exclusivamente de TenantPublicSettings
  const isWholesale = purchaseMode === 'wholesale';
  const minOrderValue = isWholesale ? (settings?.wholesaleMinOrderValue ?? null) : (settings?.minOrderValue ?? 0);

  // Defesa fail-closed para atacado: se atacado não permitido ou sem valor mínimo definido, bloqueia
  const isWholesaleBlocked = isWholesale && (!settings?.allowB2bMode || minOrderValue === null || !isApproved);
  const isBelowMinOrder = isWholesaleBlocked
    ? true
    : minOrderValue !== null && minOrderValue > 0 && cartSubtotal < minOrderValue;
  const missingAmount = isWholesaleBlocked
    ? 0
    : (minOrderValue !== null && minOrderValue > 0 && cartSubtotal < minOrderValue ? minOrderValue - cartSubtotal : 0);

  // Defesa de estoque para itens de atacado
  const hasInsufficientWholesaleItem = isWholesale && cart.some(item => {
    const isItemWholesale = Boolean(
      item.product.wholesaleEnabled ?? (item.product.wholesalePrice !== null && (item.product.wholesalePrice ?? 0) > 0)
    );
    const minQty = isItemWholesale ? Math.max(1, item.product.wholesaleMinQuantity || 1) : 1;
    return isItemWholesale && (item.product.stock < minQty || item.quantity < minQty);
  });

  const handleProceedToDetails = () => {
    if (!settings || !settings.slug) {
      showToast('Configurações da loja ainda não estão disponíveis.');
      return;
    }
    if (cart.length === 0) {
      showToast('Seu carrinho está vazio.');
      return;
    }
    if (isWholesaleBlocked) {
      showToast('Modalidade atacado indisponível ou cadastro B2B não aprovado.');
      return;
    }
    if (hasInsufficientWholesaleItem) {
      showToast('Há itens no carrinho com estoque insuficiente para o mínimo de atacado.');
      return;
    }
    if (isBelowMinOrder) {
      const minFormatted = minOrderValue !== null ? `R$ ${minOrderValue.toFixed(2).replace('.', ',')}` : 'a definir';
      showToast(`O valor mínimo para pedidos é de ${minFormatted}.`);
      return;
    }
    if (availableDeliveryMethods.length === 0) {
      showToast('Nenhum método de entrega configurado pela loja.');
      return;
    }

    setSubmitError(null);
    setCheckoutStep('details');
  };

  const getDeliveryMethodLabel = (method: string): string => {
    const lower = method.toLowerCase();
    if (lower === 'retirada') return 'Retirada na Loja';
    if (lower === 'entrega') return 'Entrega Padrão';
    if (lower === 'uber') return 'Uber / Entrega Rápida';
    if (lower === 'uber_moto') return 'Uber Moto';
    if (lower === 'uber_carro') return 'Carro / Caminhão';
    if (lower === 'transportadora') return 'Transportadora';
    if (lower === 'outro') return 'Outro Método';
    return method;
  };

  const getPaymentMethodLabel = (method: PaymentMethod): string => {
    switch (method) {
      case 'pix': return 'PIX Instantâneo';
      case 'boleto': return 'Boleto Bancário';
      case 'credit_card': return 'Cartão de Crédito';
      case 'cash_on_delivery': return 'Pagamento na Entrega / Retirada';
      default: return method;
    }
  };

  /**
   * Validação local prévia para avançar da etapa details para a etapa review.
   * Não executa chamadas de rede nem submete pedido.
   */
  const handleValidateDetails = () => {
    if (!settings || !settings.slug) {
      setSubmitError('Configurações da loja ainda não estão disponíveis.');
      return;
    }
    if (cart.length === 0) {
      setSubmitError('Seu carrinho está vazio.');
      return;
    }
    if (isWholesaleBlocked) {
      setSubmitError('Modalidade atacado indisponível ou cadastro B2B não aprovado.');
      return;
    }
    if (isBelowMinOrder) {
      const minFormatted = minOrderValue !== null ? `R$ ${minOrderValue.toFixed(2).replace('.', ',')}` : 'a definir';
      setSubmitError(`O valor mínimo para pedidos é de ${minFormatted}.`);
      return;
    }
    if (hasInsufficientWholesaleItem) {
      setSubmitError('Há itens no carrinho com estoque insuficiente para o mínimo de atacado.');
      return;
    }
    if (!availableDeliveryMethods.includes(deliveryMethod.trim())) {
      setSubmitError('Selecione uma forma de entrega disponível.');
      return;
    }

    const newErrors: Record<string, string> = checkoutRequiredErrors(checkoutFields, formValues, isWholesale);
    if (!isWholesale) {
      if (!formValues.name.trim()) {
        newErrors.name = 'Nome do comprador é obrigatório';
      }
      if (!formValues.phone.trim()) {
        newErrors.phone = 'Telefone/WhatsApp é obrigatório';
      }
      if (!formValues.document.trim()) {
        newErrors.document = formValues.type === 'PF' ? 'Informe um CPF válido.' : 'Informe um CNPJ válido.';
      } else {
        const cleanDoc = normalizeBrazilianDocument(formValues.document);
        if (formValues.type === 'PF') {
          if (!isValidCPF(cleanDoc)) {
            newErrors.document = 'Informe um CPF válido.';
          }
        } else {
          if (!isValidCNPJ(cleanDoc)) {
            newErrors.document = 'Informe um CNPJ válido.';
          }
        }
      }
    }
    if (!formValues.street.trim()) {
      newErrors.street = 'Endereço (rua/logradouro) é obrigatório';
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      setSubmitError(Object.values(newErrors).join(' '));
      return;
    }

    setErrors({});
    setSubmitError(null);
    setCheckoutStep('review');
  };

  const handleFinishOrder = async () => {
    if (isSubmittingOrder) return;

    // 1. Revalidação de existência de settings
    if (!settings) {
      setSubmitError('Configurações da loja ainda não estão disponíveis.');
      return;
    }

    // 2. Revalidação de settings.slug não vazio
    if (typeof settings.slug !== 'string' || !settings.slug.trim()) {
      setSubmitError('Identificador da loja não disponível.');
      return;
    }

    // 3. Revalidação de carrinho não vazio
    if (cart.length === 0) {
      setSubmitError('Seu carrinho está vazio.');
      return;
    }

    // 4. Revalidação de autorização B2B/wholesale continua ativa
    if (isWholesale && (!isApproved || !settings.allowB2bMode)) {
      setSubmitError('Acesso ao atacado não está aprovado ou modalidade B2B desativada nesta loja.');
      return;
    }

    // 5. Revalidação de wholesaleMinOrderValue não nulo quando em atacado
    if (isWholesale && (settings.wholesaleMinOrderValue === null || settings.wholesaleMinOrderValue === undefined)) {
      setSubmitError('Modalidade atacado indisponível ou valor mínimo não configurado.');
      return;
    }

    // 6. Revalidação de valor mínimo atendido (wholesale e retail)
    if (isWholesaleBlocked) {
      setSubmitError('Modalidade atacado indisponível ou cadastro B2B não aprovado.');
      return;
    }
    if (isBelowMinOrder) {
      const minFormatted = minOrderValue !== null ? `R$ ${minOrderValue.toFixed(2).replace('.', ',')}` : 'a definir';
      setSubmitError(`O valor mínimo para pedidos é de ${minFormatted}.`);
      return;
    }
    if (isWholesale && typeof settings.wholesaleMinOrderValue === 'number' && settings.wholesaleMinOrderValue > 0 && cartSubtotal < settings.wholesaleMinOrderValue) {
      const minFormatted = `R$ ${settings.wholesaleMinOrderValue.toFixed(2).replace('.', ',')}`;
      setSubmitError(`O valor mínimo para pedidos é de ${minFormatted}.`);
      return;
    }
    if (!isWholesale && typeof settings.minOrderValue === 'number' && settings.minOrderValue > 0 && cartSubtotal < settings.minOrderValue) {
      const minFormatted = `R$ ${settings.minOrderValue.toFixed(2).replace('.', ',')}`;
      setSubmitError(`O valor mínimo para pedidos é de ${minFormatted}.`);
      return;
    }

    // 7. Revalidação de quantidade mínima por item e suficiência
    const hasItemBelowMinimum = isWholesale && cart.some(item => {
      const isItemWholesale = Boolean(
        item.product.wholesaleEnabled ?? (item.product.wholesalePrice !== null && (item.product.wholesalePrice ?? 0) > 0)
      );
      const minQty = isItemWholesale ? Math.max(1, item.product.wholesaleMinQuantity || 1) : 1;
      return item.quantity < minQty;
    });
    if (hasItemBelowMinimum) {
      setSubmitError('Há itens no carrinho abaixo da quantidade mínima exigida para atacado.');
      return;
    }
    if (hasInsufficientWholesaleItem) {
      setSubmitError('Há itens no carrinho com estoque insuficiente para o mínimo de atacado.');
      return;
    }

    // 8. Revalidação de deliveryMethods não vazio
    if (!Array.isArray(availableDeliveryMethods) || availableDeliveryMethods.length === 0) {
      setSubmitError('Nenhum método de entrega configurado pela loja.');
      return;
    }

    // 9. Revalidação de deliveryMethod atual pertencente a deliveryMethods
    if (!deliveryMethod || !deliveryMethod.trim() || !availableDeliveryMethods.includes(deliveryMethod.trim())) {
      setSubmitError('Selecione uma forma de entrega disponível.');
      return;
    }

    // 10. Revalidação de formulário obrigatório
    const newErrors: Record<string, string> = checkoutRequiredErrors(checkoutFields, formValues, isWholesale);
    if (!isWholesale) {
      if (!formValues.name.trim()) newErrors.name = 'Nome do comprador é obrigatório';
      if (!formValues.phone.trim()) newErrors.phone = 'Telefone/WhatsApp é obrigatório';
      if (!formValues.document.trim()) {
        newErrors.document = formValues.type === 'PF' ? 'Informe um CPF válido.' : 'Informe um CNPJ válido.';
      } else {
        const cleanDoc = normalizeBrazilianDocument(formValues.document);
        if (formValues.type === 'PF') {
          if (!isValidCPF(cleanDoc)) newErrors.document = 'Informe um CPF válido.';
        } else {
          if (!isValidCNPJ(cleanDoc)) newErrors.document = 'Informe um CNPJ válido.';
        }
      }
    }
    if (!formValues.street.trim()) {
      newErrors.street = 'Endereço (rua/logradouro) é obrigatório';
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      setSubmitError(Object.values(newErrors).join(' '));
      return;
    }

    // 11. Validação Fail-Closed do WhatsApp da loja ANTES de qualquer requisição de rede
    const cleanPhone = (whatsappNumber || '').replace(/\D/g, '');
    if (!cleanPhone || cleanPhone.length < 10) {
      setSubmitError('WhatsApp da loja não está configurado corretamente. Entre em contato com a loja.');
      return;
    }

    // Do not show an order from another session after a login/tenant change.
    const submissionIdentity = checkoutIdentity;

    // 12. Pré-abertura síncrona da janela de handoff para evitar bloqueio de popup pelo navegador pós-await
    let prepWindow: Window | null = null;
    try {
      prepWindow = window.open('about:blank', '_blank');
    } catch {
      prepWindow = null;
    }

    if (!prepWindow) {
      setSubmitError('Por favor, permita pop-ups para abrir a conversa no WhatsApp.');
      return;
    }

    setErrors({});
    setSubmitError(null);
    setIsSubmittingOrder(true);
    setSubmittingStateText('Validando pedido...');

    // Snapshot em memória local imutável — aguarda receipt válido do servidor
    const pendingCustomerSnapshot: ConfirmedCustomerSnapshot = {
      type: formValues.type,
      name: formValues.name.trim(),
      document: normalizeBrazilianDocument(formValues.document),
      companyName: formValues.companyName.trim() || undefined,
      email: formValues.email.trim() || undefined,
      phone: formValues.phone.trim(),
      street: formValues.street.trim(),
      number: formValues.number.trim() || undefined,
      complement: formValues.complement.trim() || undefined,
      neighborhood: formValues.neighborhood.trim() || undefined,
      city: formValues.city.trim() || undefined,
      state: formValues.state.trim() || undefined,
      zipCode: formValues.zipCode.trim() || undefined,
      notes: formValues.notes.trim() || undefined,
      sellerCode: formValues.sellerCode.trim() || undefined
    };

    try {
      // 5. Montagem do draft estritamente sem autoridade financeira
      const draftItems = cart.map(item => ({
        productId: item.product.id,
        quantity: item.quantity,
        selectedVariant: item.selectedVariant || null
      }));

      // No atacado, a identidade comercial oficial é resolvida pelo backend via wholesale_customers
      const customerPayload = isWholesale
        ? {
            email: formValues.email.trim() || undefined,
            phone: formValues.phone.trim() || undefined
          }
        : {
            name: formValues.name.trim(),
            document: formValues.document.trim() || undefined,
            companyName: formValues.companyName.trim() || undefined,
            email: formValues.email.trim() || undefined,
            phone: formValues.phone.trim(),
            type: formValues.type
          };

      const shippingAddressPayload = {
        street: formValues.street.trim(),
        number: formValues.number.trim() || undefined,
        complement: formValues.complement.trim() || undefined,
        neighborhood: formValues.neighborhood.trim() || undefined,
        city: formValues.city.trim() || undefined,
        state: formValues.state.trim() || undefined,
        zipCode: formValues.zipCode.trim() || undefined
      };

      const draft: SubmitOrderCheckoutDraft = {
        tenantSlug: settings.slug,
        shoppingMode: purchaseMode,
        items: draftItems,
        customer: customerPayload,
        shippingAddress: shippingAddressPayload,
        paymentMethod: formValues.paymentMethod,
        deliveryMethod: deliveryMethod.trim(),
        notes: formValues.notes.trim() || undefined,
        sellerCode: formValues.sellerCode.trim() || undefined
      };

      // Só permite reutilizar recibo após popup fechado se draft e identidade não mudaram.
      // Mesma canonicalização criptográfica usada pela idempotência oficial do serviço.
      const currentFingerprint = await computeOrderFingerprint(draft, user?.id || 'anonymous');
      if (currentIdentityRef.current !== submissionIdentity) {
        throw new OrderCheckoutError('Sessão ou loja alterada durante a confirmação. Revise o pedido.', { kind: 'stale-session' });
      }
      let receipt: CheckoutOrderReceipt;
      if (createdOrder) {
        if (!createdOrderFingerprint || createdOrderFingerprint !== currentFingerprint) {
          throw new OrderCheckoutError(
            'O pedido anterior já foi registrado com outros dados. Não é possível reutilizar seu recibo. Retorne aos dados originais para abrir o WhatsApp ou inicie uma nova compra.',
            { kind: 'stale-receipt' }
          );
        }
        receipt = createdOrder;
      } else {
        receipt = await submitOrderCheckout(draft);
      }

      if (currentIdentityRef.current !== submissionIdentity) {
        throw new OrderCheckoutError('Sessão ou loja alterada durante a confirmação. Revise o pedido.', { kind: 'stale-session' });
      }

      // 7. Preparação do WhatsApp Handoff (Mensagem Textual Completa com Itens do Recibo Servidor)
      setSubmittingStateText('Preparando WhatsApp...');

      const formattedPhone = cleanPhone.startsWith('55') ? cleanPhone : `55${cleanPhone}`;
      const customerDisplay = isWholesale
        ? (wholesaleCompany?.tradeName || wholesaleCompany?.legalName || 'Cliente Atacadista')
        : (pendingCustomerSnapshot.name || 'Cliente');

      const message = buildOrderWhatsAppMessage({
        receipt,
        customerDisplay,
        paymentMethodLabel: getPaymentMethodLabel(receipt.paymentMethod),
        deliveryMethodLabel: getDeliveryMethodLabel(receipt.deliveryMethod),
      });

      const waUrl = `https://wa.me/${formattedPhone}?text=${encodeURIComponent(message)}`;

      // 8. Armazenamento seguro de token de rastreamento de varejo no cliente (isolado por tenant)
      if (!isWholesale && receipt.trackingToken) {
        storeRetailOrderTracking(settings.slug, {
          orderNumber: receipt.orderNumber,
          trackingToken: receipt.trackingToken,
          createdAt: receipt.createdAt
        });
      }

      // 9. Verificação de fechamento prematuro da janela pelo usuário durante o await
      if (prepWindow.closed) {
        setConfirmedCustomerSnapshot(pendingCustomerSnapshot);
        setCreatedOrder(receipt);
        setCreatedOrderFingerprint(currentFingerprint);
        setSubmitError('Pedido registrado. Clique novamente para abrir o WhatsApp.');
        showToast(`Pedido #${receipt.orderNumber} registrado.`);
        return;
      }

      // Redireciona a janela aberta previamente
      prepWindow.location.href = waUrl;

      // Sucesso real validado: confirma snapshot do cliente, atualiza recibo e limpa carrinho e formulário PII
      setConfirmedCustomerSnapshot(pendingCustomerSnapshot);
      setCreatedOrder(receipt);
      clearCart();
      resetCheckoutLifecycle();
      setIsCartOpen(false);

      showToast(`Pedido #${receipt.orderNumber} registrado. Conclua o envio na conversa do WhatsApp.`);
    } catch (err: unknown) {
      // Em caso de falha: fecha a janela de preparação e mantém o usuário na review com todos os dados intactos
      if (prepWindow) {
        try {
          prepWindow.close();
        } catch {
          // Silencioso
        }
      }
      const message = err instanceof OrderCheckoutError
        ? err.message
        : 'Não foi possível processar o pedido.';
      setSubmitError(message);
    } finally {
      setIsSubmittingOrder(false);
      setSubmittingStateText(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-hidden bg-black/60 backdrop-blur-xs flex justify-end">
      <div className="w-full max-w-lg bg-white h-full shadow-2xl flex flex-col justify-between overflow-hidden">

        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-[#E2E8F0] flex items-center justify-between bg-slate-50">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-[#0F172A] text-[#FF5A00] flex items-center justify-center font-bold text-xs">
              <ShoppingCart className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-bold text-[#0F172A] text-sm">
                {checkoutStep === 'cart'
                  ? 'Seu Pedido'
                  : checkoutStep === 'details'
                  ? 'Dados para Entrega & Pagamento'
                  : 'Revise seu pedido'}
              </h3>
              <p className="text-[11px] text-slate-500">{storeName}</p>
            </div>
          </div>
          <button
            onClick={handleCloseDrawer}
            disabled={isSubmittingOrder}
            className="w-8 h-8 rounded-full hover:bg-slate-200 text-slate-500 flex items-center justify-center transition-colors cursor-pointer disabled:opacity-50"
            title="Fechar carrinho"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* STEP 1: CART ITEMS */}
        {checkoutStep === 'cart' && (
          <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4">

            {cart.length === 0 ? (
              <div className="py-16 text-center space-y-3">
                <div className="w-16 h-16 rounded-full bg-slate-100 text-slate-400 flex items-center justify-center mx-auto">
                  <ShoppingCart className="w-8 h-8" />
                </div>
                <div className="text-sm font-bold text-slate-700">Seu carrinho está vazio</div>
                <p className="text-xs text-slate-400 max-w-xs mx-auto">
                  Navegue pelo catálogo e adicione produtos para gerar seu orçamento ou pedido.
                </p>
                <button
                  onClick={() => setIsCartOpen(false)}
                  className="px-4 py-2 rounded-xl bg-[#0F172A] hover:bg-slate-800 text-white text-xs font-bold transition-colors cursor-pointer"
                >
                  Continuar Comprando
                </button>
              </div>
            ) : (
              <>
                {/* Minimum Order Warning */}
                {isBelowMinOrder && (
                  <div className="p-3 bg-amber-50 rounded-xl border border-amber-200 text-xs text-amber-800 flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
                    <div>
                      {isWholesaleBlocked ? (
                        <span>Modalidade de atacado requer aprovação B2B ativa e valor mínimo configurado pela loja.</span>
                      ) : (
                        <span>
                          Pedido mínimo da loja ({isWholesale ? 'Atacado' : 'Varejo'}): <strong>R$ {minOrderValue?.toFixed(2).replace('.', ',')}</strong>. Faltam <strong>R$ {missingAmount.toFixed(2).replace('.', ',')}</strong> para finalizar.
                        </span>
                      )}
                    </div>
                  </div>
                )}

                {/* Insufficient Wholesale Stock Warning */}
                {hasInsufficientWholesaleItem && (
                  <div className="p-3 bg-red-50 rounded-xl border border-red-200 text-xs text-red-800 flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
                    <div>
                      Há item(ns) no pedido com estoque insuficiente para o mínimo de atacado. Ajuste a quantidade ou remova-o(s) para continuar.
                    </div>
                  </div>
                )}

                {/* Items List */}
                <div className="space-y-3">
                  {cart.map((item, idx) => {
                    const isWholesaleItem = isWholesale && Boolean(
                      item.product.wholesaleEnabled ?? (item.product.wholesalePrice !== null && (item.product.wholesalePrice ?? 0) > 0)
                    );
                    const itemMinQty = isWholesaleItem
                      ? Math.max(1, item.product.wholesaleMinQuantity || 1)
                      : (item.product.minOrderQuantity || 1);
                    const isItemInsufficientStock = isWholesaleItem && (item.product.stock < itemMinQty || item.quantity < itemMinQty);

                    return (
                      <div key={`${item.product.id}-${idx}`} className="p-3 bg-slate-50 rounded-2xl border border-[#E2E8F0] flex items-center justify-between gap-3">
                        <img
                          src={getSafeProductImage(item.product.images[0], item.product.category)}
                          alt={item.product.name}
                          className="w-14 h-14 rounded-xl object-cover border border-[#E2E8F0] shrink-0"
                          onError={(e) => handleProductImageError(e, item.product.category)}
                        />

                        <div className="flex-1 min-w-0">
                          <h4 className="text-xs font-bold text-slate-900 truncate">{item.product.name}</h4>
                          <div className="text-[11px] text-slate-500 font-mono flex items-center gap-1.5">
                            <span>R$ {item.unitPrice.toFixed(2).replace('.', ',')} /{item.product.unit}</span>
                            {isWholesale && (
                              <span className="text-[10px] font-bold text-amber-800 bg-amber-100 px-1.5 py-0.2 rounded">
                                Atacado
                              </span>
                            )}
                          </div>

                          {isItemInsufficientStock && (
                            <div className="text-[10px] text-rose-600 font-bold bg-rose-50 px-2 py-0.5 rounded border border-rose-200 mt-1 inline-flex items-center gap-1">
                              <AlertCircle className="w-3 h-3 shrink-0" />
                              <span>Estoque insuficiente para o mínimo de atacado (disponível: {item.product.stock})</span>
                            </div>
                          )}

                          <div className="flex items-center gap-2 mt-1.5">
                            <CartItemQuantityControl
                              quantity={item.quantity}
                              stock={item.product.stock}
                              min={itemMinQty}
                              onUpdate={(newQty) => updateCartQuantity(item.product.id, newQty, item.selectedVariant)}
                            />
                            <div className="text-[10px] text-slate-500 font-medium">
                              <span>{item.product.unit}</span>
                              {isWholesale && itemMinQty > 1 && (
                                <span className="text-amber-700 block text-[9px] font-bold">
                                  Mín. {itemMinQty}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>

                        <div className="text-right shrink-0">
                          <div className="text-xs font-extrabold text-[#0F172A]">
                            R$ {(item.unitPrice * item.quantity).toFixed(2).replace('.', ',')}
                          </div>
                          <button
                            onClick={() => removeFromCart(item.product.id, item.selectedVariant)}
                            className="text-slate-400 hover:text-red-500 p-1 mt-1 transition-colors cursor-pointer"
                            title="Remover item"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="text-right">
                  <button
                    onClick={clearCart}
                    className="text-[11px] text-slate-400 hover:text-red-600 font-medium underline cursor-pointer"
                  >
                    Esvaziar carrinho
                  </button>
                </div>
              </>
            )}

          </div>
        )}

        {/* STEP 2: CUSTOMER & DELIVERY DETAILS FORM */}
        {checkoutStep === 'details' && (
          <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4 text-xs">

            {/* Feedback de Erro Inline com role="alert" */}
            {submitError && (
              <div
                role="alert"
                className="p-3.5 bg-red-50 border border-red-200 rounded-xl text-xs text-red-800 flex items-start gap-2.5 animate-shake"
              >
                <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                <div className="flex-1 font-semibold leading-relaxed">
                  {submitError}
                </div>
              </div>
            )}

            {/* Identidade Comercial: Varejo vs Atacado */}
            {isWholesale ? (
              <div className="p-3 bg-amber-50/70 border border-amber-200 rounded-xl space-y-1.5">
                <div className="flex items-center gap-1.5 text-amber-950 font-bold text-[11px]">
                  <Building2 className="w-4 h-4 text-amber-600" />
                  <span>Identidade Oficial de Atacado (B2B Cadastrado)</span>
                </div>
                <div className="text-slate-700 space-y-0.5 font-mono text-[11px]">
                  <div><strong>Razão Social:</strong> {wholesaleCompany?.legalName || 'Empresa Cadastrada'}</div>
                  {wholesaleCompany?.tradeName && (
                    <div><strong>Nome Fantasia:</strong> {wholesaleCompany.tradeName}</div>
                  )}
                  <div><strong>CNPJ:</strong> {wholesaleCompany?.cnpj || '—'}</div>
                  {wholesaleCompany?.contactName && (
                    <div><strong>Contato Oficial:</strong> {wholesaleCompany.contactName}</div>
                  )}
                </div>
                <p className="text-[10px] text-amber-800 pt-1 border-t border-amber-200/60">
                  A identidade comercial do comprador é vinculada automaticamente pelo servidor através da sua conta autorizada.
                </p>
              </div>
            ) : (
              <div className="flex items-center justify-between pb-2 border-b border-slate-100">
                <span className="font-bold text-slate-900 uppercase tracking-wider text-[11px]">Tipo de Comprador:</span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setCustomerData(prev => ({ ...prev, type: 'PJ', document: prev.type === 'PJ' ? prev.document : '' }));
                      setErrors(prev => {
                        const next = { ...prev };
                        delete next.document;
                        return next;
                      });
                      setSubmitError(null);
                    }}
                    className={`px-3 py-1 rounded-lg font-bold cursor-pointer transition-colors ${
                      customerData.type === 'PJ' ? 'bg-[#0F172A] text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                    }`}
                  >
                    Pessoa Jurídica (CNPJ)
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setCustomerData(prev => ({ ...prev, type: 'PF', document: prev.type === 'PF' ? prev.document : '', companyName: '' }));
                      setErrors(prev => {
                        const next = { ...prev };
                        delete next.document;
                        delete next.companyName;
                        return next;
                      });
                      setSubmitError(null);
                    }}
                    className={`px-3 py-1 rounded-lg font-bold cursor-pointer transition-colors ${
                      customerData.type === 'PF' ? 'bg-[#0F172A] text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                    }`}
                  >
                    Pessoa Física (CPF)
                  </button>
                </div>
              </div>
            )}

            {/* Campos de Contato do Comprador */}
            <div className="space-y-3">
              {!isWholesale && (
                <div>
                  <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1">
                    Nome do Comprador / Contato *
                  </label>
                  <input
                    type="text"
                    required
                    value={customerData.name}
                    onChange={e => {
                      setCustomerData(prev => ({ ...prev, name: e.target.value }));
                      setSubmitError(null);
                    }}
                    placeholder="Nome completo"
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs focus:ring-2 focus:ring-[#FF5A00] focus:outline-none"
                  />
                  {errors.name && <p className="text-red-500 text-[10px] mt-0.5">{errors.name}</p>}
                </div>
              )}

              {!isWholesale && (
                <div>
                  <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1">
                    {customerData.type === 'PJ' ? 'CNPJ *' : 'CPF *'}
                  </label>
                  <input
                    type="text"
                    required
                    value={customerData.document}
                    onChange={e => {
                      setCustomerData(prev => ({ ...prev, document: e.target.value }));
                      setSubmitError(null);
                    }}
                    placeholder={customerData.type === 'PJ' ? '00.000.000/0001-00' : '000.000.000-00'}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs font-mono focus:ring-2 focus:ring-[#FF5A00] focus:outline-none"
                  />
                  {errors.document && <p className="text-red-500 text-[10px] mt-0.5">{errors.document}</p>}
                </div>
              )}

              {!isWholesale && customerData.type === 'PJ' && checkoutFields.companyName.visible && (
                <div>
                  <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1">
                    Razão Social / Nome da Empresa
                  {checkoutFields.companyName.required && ' *'}</label>
                  <input
                    required={checkoutFields.companyName.required}
                    aria-label={CHECKOUT_FIELDS.companyName}
                    type="text"
                    value={customerData.companyName}
                    onChange={e => {
                      setCustomerData(prev => ({ ...prev, companyName: e.target.value }));
                      setSubmitError(null);
                    }}
                    placeholder="Supermercado Silva Ltda"
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs focus:ring-2 focus:ring-[#FF5A00] focus:outline-none"
                  />
                  {errors.companyName && <p role="alert" className="text-red-500 text-xs">{errors.companyName}</p>}
                </div>
              )}

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1">
                    {isWholesale ? 'WhatsApp / Contato Operacional' : 'WhatsApp para Confirmação *'}
                  </label>
                  <input
                    type="text"
                    required={!isWholesale}
                    value={customerData.phone}
                    onChange={e => {
                      setCustomerData(prev => ({ ...prev, phone: e.target.value }));
                      setSubmitError(null);
                    }}
                    placeholder="Ex: 41987654321"
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs font-mono focus:ring-2 focus:ring-[#FF5A00] focus:outline-none"
                  />
                  {errors.phone && <p className="text-red-500 text-[10px] mt-0.5">{errors.phone}</p>}
                </div>

                {checkoutFields.email.visible && (
                <div>
                  <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1">
                    E-mail
                  {checkoutFields.email.required && ' *'}</label>
                  <input
                    required={checkoutFields.email.required}
                    aria-label={CHECKOUT_FIELDS.email}
                    type="email"
                    value={customerData.email}
                    onChange={e => {
                      setCustomerData(prev => ({ ...prev, email: e.target.value }));
                      setSubmitError(null);
                    }}
                    placeholder="seuemail@empresa.com.br"
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs focus:ring-2 focus:ring-[#FF5A00] focus:outline-none"
                  />
                  {errors.email && <p role="alert" className="text-red-500 text-xs">{errors.email}</p>}
                </div>
              )}
              </div>

              {/* Método de Entrega Oficial */}
              <div className="pt-2 border-t border-slate-100">
                <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                  Método de Entrega Disponível *
                </label>
                {availableDeliveryMethods.length > 0 ? (
                  <div className="grid grid-cols-2 gap-2">
                    {availableDeliveryMethods.map(m => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => {
                          setDeliveryMethod(m);
                          setSubmitError(null);
                        }}
                        className={`p-2.5 rounded-xl border text-left flex items-center justify-between cursor-pointer transition-colors ${
                          deliveryMethod === m
                            ? 'border-[#0F172A] bg-slate-900 text-white font-bold'
                            : 'border-slate-200 hover:border-slate-300 bg-white text-slate-800'
                        }`}
                      >
                        <span className="truncate">{getDeliveryMethodLabel(m)}</span>
                        <Truck className={`w-4 h-4 shrink-0 ${deliveryMethod === m ? 'text-white' : 'text-slate-400'}`} />
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="text-amber-800 text-[11px]">Nenhum método de entrega configurado pela loja.</p>
                )}
              </div>

              {/* Endereço: logradouro permanece obrigatório em qualquer método. */}
              {settings && import.meta.env.VITE_GOOGLE_ROUTES_UI_ENABLED === 'true' && ['uber_moto', 'uber_carro'].includes(deliveryMethod) && <AutomaticDeliveryEstimate
                slug={settings.slug} method={deliveryMethod}
                address={{ street: customerData.street, number: customerData.number, neighborhood: customerData.neighborhood,
                  city: customerData.city, state: customerData.state, zipCode: customerData.zipCode.replace(/\D/g, '') }} />}
              <div className="pt-2 border-t border-slate-100 space-y-2">
                <p className="font-bold text-slate-700">Endereço do comprador / entrega</p>
                <div className="grid grid-cols-2 gap-2">
                  {(['street', 'number', 'complement', 'neighborhood', 'city', 'state', 'zipCode'] as CheckoutField[]).map(field =>
                    checkoutFields[field].visible && <label key={field} className="text-xs text-slate-700">
                      {CHECKOUT_FIELDS[field]}{checkoutFields[field].required && ' *'}
                      <input type="text" aria-label={CHECKOUT_FIELDS[field]} required={checkoutFields[field].required}
                        maxLength={field === 'state' ? 2 : undefined}
                        value={customerData[field as keyof typeof customerData]}
                        onChange={e => {
                          const value = field === 'state' ? e.target.value.toUpperCase() : e.target.value;
                          setCustomerData(prev => ({ ...prev, [field]: value })); setSubmitError(null);
                        }}
                        className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs focus:ring-2 focus:ring-[#FF5A00] focus:outline-none" />
                      {errors[field] && <span role="alert" className="block text-red-500 text-xs">{errors[field]}</span>}
                    </label>
                  )}
                </div>
              </div>

              {/* Forma de Pagamento Pretendida */}
              <div className="pt-2 border-t border-slate-100">
                <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                  Forma de Pagamento Pretendida
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setCustomerData(prev => ({ ...prev, paymentMethod: 'pix' }));
                      setSubmitError(null);
                    }}
                    className={`p-2.5 rounded-xl border text-left flex items-center justify-between cursor-pointer transition-colors ${
                      customerData.paymentMethod === 'pix' ? 'border-[#16A34A] bg-emerald-50 text-emerald-900 font-bold' : 'border-slate-200 bg-white'
                    }`}
                  >
                    <span>PIX Instantâneo</span>
                    <QrCode className="w-4 h-4 text-[#16A34A]" />
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setCustomerData(prev => ({ ...prev, paymentMethod: 'boleto' }));
                      setSubmitError(null);
                    }}
                    className={`p-2.5 rounded-xl border text-left flex items-center justify-between cursor-pointer transition-colors ${
                      customerData.paymentMethod === 'boleto' ? 'border-[#0F172A] bg-slate-100 text-[#0F172A] font-bold' : 'border-slate-200 bg-white'
                    }`}
                  >
                    <span>Boleto Bancário</span>
                    <CreditCard className="w-4 h-4 text-slate-700" />
                  </button>
                </div>
                <p className="text-[11px] text-slate-500 mt-1.5">
                  {customerData.paymentMethod === 'pix'
                    ? 'Aguarde as instruções ou link de pagamento pelo WhatsApp após o envio do pedido.'
                    : 'Aguarde o boleto ou link de pagamento pelo WhatsApp.'}
                </p>
              </div>

              {/* Código de Vendedor / Representante */}
              {checkoutFields.sellerCode.visible && (
                <div>
                <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Código do Vendedor / Representante
                {checkoutFields.sellerCode.required && ' *'}</label>
                <input
                    required={checkoutFields.sellerCode.required}
                    aria-label={CHECKOUT_FIELDS.sellerCode}
                  type="text"
                  value={customerData.sellerCode}
                  onChange={e => {
                    setCustomerData(prev => ({ ...prev, sellerCode: e.target.value.toUpperCase() }));
                    setSubmitError(null);
                  }}
                  placeholder="Ex: CARLOS10"
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs font-mono uppercase focus:ring-2 focus:ring-[#FF5A00] focus:outline-none"
                />
                {errors.sellerCode && <p role="alert" className="text-red-500 text-xs">{errors.sellerCode}</p>}
                </div>
              )}

              {/* Observações */}
              {checkoutFields.notes.visible && (
                <div>
                <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Observações para a Loja
                {checkoutFields.notes.required && ' *'}</label>
                <textarea
                    required={checkoutFields.notes.required}
                    aria-label={CHECKOUT_FIELDS.notes}
                  value={customerData.notes}
                  onChange={e => {
                    setCustomerData(prev => ({ ...prev, notes: e.target.value }));
                    setSubmitError(null);
                  }}
                  rows={2}
                  placeholder="Instruções de horário, faturamento ou transporte..."
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs focus:ring-2 focus:ring-[#FF5A00] focus:outline-none"
                />
                {errors.notes && <p role="alert" className="text-red-500 text-xs">{errors.notes}</p>}
                </div>
              )}

            </div>
          </div>
        )}

        {/* STEP 3: REVIEW / ORÇAMENTO SUMMARY (UX MARKETPLACE) */}
        {checkoutStep === 'review' && (
          <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4 text-xs">

            {/* Feedback de Erro Inline */}
            {submitError && (
              <div
                role="alert"
                className="p-3.5 bg-red-50 border border-red-200 rounded-xl text-xs text-red-800 flex items-start gap-2.5 animate-shake"
              >
                <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                <div className="flex-1 font-semibold leading-relaxed">
                  {submitError}
                </div>
              </div>
            )}

            {/* Disclaimer de Revisão */}
            <div className="p-3 bg-amber-50/80 border border-amber-200 rounded-2xl flex items-start gap-2.5 text-amber-900">
              <Info className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <div className="text-[11px] leading-relaxed">
                <strong>Revise os dados antes de confirmar.</strong> Preços, estoque e regras comerciais serão validados novamente pelo servidor.
              </div>
            </div>

            {/* Itens do Pedido */}
            <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200 space-y-3">
              <div className="flex items-center justify-between border-b border-slate-200 pb-2">
                <span className="font-bold text-slate-800 uppercase tracking-wider text-[11px] flex items-center gap-1.5">
                  <ShoppingCart className="w-3.5 h-3.5 text-slate-600" />
                  Itens do Pedido ({cart.length})
                </span>
                <span className="text-[11px] font-bold text-slate-600">
                  {isWholesale ? 'Modalidade Atacado' : 'Modalidade Varejo'}
                </span>
              </div>

              <div className="space-y-2.5 max-h-48 overflow-y-auto pr-1">
                {cart.map((item, idx) => (
                  <div key={`${item.product.id}-${idx}`} className="flex items-center justify-between gap-2.5 py-1.5 border-b border-slate-200/60 last:border-0">
                    <img
                      src={getSafeProductImage(item.product.images[0], item.product.category)}
                      alt={item.product.name}
                      className="w-10 h-10 rounded-lg object-cover border border-slate-200 shrink-0"
                      onError={(e) => handleProductImageError(e, item.product.category)}
                    />
                    <div className="flex-1 min-w-0">
                      <h5 className="font-bold text-slate-900 truncate text-[11px]">{item.product.name}</h5>
                      <div className="text-[10px] text-slate-500 flex items-center gap-1.5">
                        <span className="font-mono">SKU: {item.product.sku}</span>
                        {item.selectedVariant && (
                          <span className="bg-slate-200 text-slate-700 px-1 py-0.2 rounded text-[9px] font-medium truncate max-w-[120px]">
                            {item.selectedVariant}
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] text-slate-600">
                        {item.quantity} {item.product.unit} × R$ {item.unitPrice.toFixed(2).replace('.', ',')}
                      </div>
                    </div>
                    <div className="text-right font-extrabold text-slate-900 text-xs">
                      R$ {(item.unitPrice * item.quantity).toFixed(2).replace('.', ',')}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Resumo Financeiro Estimado */}
            <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200 space-y-2 text-xs">
              <div className="font-bold text-slate-800 uppercase tracking-wider text-[11px] border-b border-slate-200 pb-1.5">
                Resumo Estimado
              </div>
              <div className="flex justify-between text-slate-600">
                <span>Subtotal Estimado:</span>
                <span className="font-medium text-slate-900">R$ {cartSubtotal.toFixed(2).replace('.', ',')}</span>
              </div>
              <div className="flex justify-between text-slate-600">
                <span>Frete:</span>
                <span className="text-amber-800 font-medium">A combinar / Calculado pela loja</span>
              </div>
              <div className="flex justify-between text-sm font-extrabold text-[#0F172A] pt-2 border-t border-slate-200">
                <span>Total Estimado:</span>
                <span className="text-[#0F172A]">R$ {cartSubtotal.toFixed(2).replace('.', ',')}</span>
              </div>
              <div className="pt-2 border-t border-slate-200/80 text-[11px] text-slate-600 space-y-1">
                <div><strong>Forma de Pagamento Pretendida:</strong> {getPaymentMethodLabel(formValues.paymentMethod)}</div>
                <div className="text-[10px] text-amber-800">
                  {formValues.paymentMethod === 'pix'
                    ? 'Aguarde as instruções ou link de pagamento pelo WhatsApp após o envio do pedido.'
                    : 'Aguarde o boleto ou link de pagamento pelo WhatsApp.'}
                </div>
                <div><strong>Método de Entrega:</strong> {getDeliveryMethodLabel(deliveryMethod)}</div>
              </div>
            </div>

            {/* Dados do Cliente */}
            <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200 space-y-2 text-[11px]">
              <div className="font-bold text-slate-800 uppercase tracking-wider text-[11px] border-b border-slate-200 pb-1.5 flex items-center gap-1.5">
                <User className="w-3.5 h-3.5 text-slate-600" />
                Dados do Comprador
              </div>
              {isWholesale ? (
                <div className="space-y-1 text-slate-700">
                  <div><strong>Razão Social:</strong> {wholesaleCompany?.legalName || 'Empresa B2B'}</div>
                  {wholesaleCompany?.tradeName && <div><strong>Fantasia:</strong> {wholesaleCompany.tradeName}</div>}
                  <div><strong>CNPJ:</strong> {wholesaleCompany?.cnpj || '—'}</div>
                  {formValues.phone && <div><strong>WhatsApp:</strong> {formValues.phone}</div>}
                  {formValues.email && <div><strong>E-mail:</strong> {formValues.email}</div>}
                </div>
              ) : (
                <div className="space-y-1 text-slate-700">
                  <div><strong>Tipo:</strong> {formValues.type === 'PJ' ? 'Pessoa Jurídica (PJ)' : 'Pessoa Física (PF)'}</div>
                  <div><strong>Nome:</strong> {formValues.name}</div>
                  <div><strong>{formValues.type === 'PJ' ? 'CNPJ' : 'CPF'}:</strong> {formValues.document}</div>
                  {formValues.companyName && <div><strong>Empresa:</strong> {formValues.companyName}</div>}
                  <div><strong>WhatsApp:</strong> {formValues.phone}</div>
                  {formValues.email && <div><strong>E-mail:</strong> {formValues.email}</div>}
                </div>
              )}
            </div>

            {/* Endereço de Entrega */}
            <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200 space-y-1 text-[11px]">
              <div className="font-bold text-slate-800 uppercase tracking-wider text-[11px] border-b border-slate-200 pb-1.5 flex items-center gap-1.5">
                <MapPin className="w-3.5 h-3.5 text-slate-600" />
                Endereço de Entrega
              </div>
              <div className="text-slate-700 pt-1">
                <div>
                  {formValues.street}{formValues.number ? `, Nº ${formValues.number}` : ''}
                  {formValues.complement ? ` - ${formValues.complement}` : ''}
                </div>
                <div>
                  {formValues.neighborhood ? `${formValues.neighborhood}, ` : ''}
                  {formValues.city ? `${formValues.city}` : ''}
                  {formValues.state ? `/${formValues.state}` : ''}
                  {formValues.zipCode ? ` - CEP ${formValues.zipCode}` : ''}
                </div>
              </div>
            </div>

            {/* Observações e Vendedor (quando preenchidos) */}
            {(formValues.sellerCode || formValues.notes) && (
              <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200 space-y-1 text-[11px]">
                <div className="font-bold text-slate-800 uppercase tracking-wider text-[11px] border-b border-slate-200 pb-1.5 flex items-center gap-1.5">
                  <FileText className="w-3.5 h-3.5 text-slate-600" />
                  Informações Adicionais
                </div>
                {formValues.sellerCode && (
                  <div className="text-slate-700 pt-1">
                    <strong>Código do Vendedor:</strong> {formValues.sellerCode}
                  </div>
                )}
                {formValues.notes && (
                  <div className="text-slate-700 pt-1">
                    <strong>Observações:</strong> {formValues.notes}
                  </div>
                )}
              </div>
            )}

          </div>
        )}

        {/* Footer Actions for Steps: Cart, Details & Review */}
        {cart.length > 0 && (
          <div className="p-4 sm:p-5 border-t border-[#E2E8F0] bg-slate-50 space-y-3">

            {/* Totals Summary */}
            <div className="space-y-1 text-xs">
              <div className="flex justify-between text-slate-600">
                <span>Subtotal Estimado ({isWholesale ? 'Atacado' : 'Varejo'}):</span>
                <span>R$ {cartSubtotal.toFixed(2).replace('.', ',')}</span>
              </div>
              <div className="flex justify-between text-slate-600">
                <span>Frete Estimado:</span>
                <span className="text-emerald-700 font-medium">A combinar</span>
              </div>
              <div className="flex justify-between text-sm font-extrabold text-[#0F172A] pt-1 border-t border-[#E2E8F0]">
                <span>Total Estimado:</span>
                <span className="text-[#0F172A]">R$ {cartSubtotal.toFixed(2).replace('.', ',')}</span>
              </div>
            </div>

            {/* Buttons based on step */}
            {checkoutStep === 'cart' && (
              <button
                type="button"
                onClick={handleProceedToDetails}
                disabled={isBelowMinOrder || hasInsufficientWholesaleItem}
                className={`w-full py-3 rounded-2xl font-bold text-xs flex items-center justify-center gap-2 shadow-lg transition-all ${
                  (isBelowMinOrder || hasInsufficientWholesaleItem)
                    ? 'bg-slate-300 text-slate-500 cursor-not-allowed shadow-none'
                    : 'bg-[#FF5A00] hover:bg-[#D94E00] text-white cursor-pointer'
                }`}
                id="btn-cart-proceed"
              >
                <span>Avançar para Entrega e Pagamento</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            )}

            {checkoutStep === 'details' && (
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  disabled={isSubmittingOrder}
                  onClick={() => {
                    setCheckoutStep('cart');
                    setSubmitError(null);
                  }}
                  className="py-2.5 rounded-xl border border-slate-300 text-slate-700 font-bold text-xs hover:bg-slate-100 disabled:opacity-50 cursor-pointer transition-colors flex items-center justify-center gap-1.5"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  <span>Voltar</span>
                </button>
                <button
                  type="button"
                  disabled={isSubmittingOrder || isBelowMinOrder}
                  onClick={handleValidateDetails}
                  className="py-2.5 rounded-xl bg-[#0F172A] hover:bg-slate-800 disabled:bg-slate-300 disabled:text-slate-500 text-white font-bold text-xs flex items-center justify-center gap-1.5 shadow-md cursor-pointer transition-colors disabled:cursor-not-allowed"
                  id="btn-validate-quote"
                >
                  <span>Validar orçamento</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            {checkoutStep === 'review' && (
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  disabled={isSubmittingOrder}
                  onClick={() => {
                    setCheckoutStep('details');
                    setSubmitError(null);
                  }}
                  className="py-2.5 rounded-xl border border-slate-300 text-slate-700 font-bold text-xs hover:bg-slate-100 disabled:opacity-50 cursor-pointer transition-colors flex items-center justify-center gap-1.5"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  <span>Voltar e editar</span>
                </button>
                <button
                  type="button"
                  disabled={isSubmittingOrder || isBelowMinOrder}
                  onClick={handleFinishOrder}
                  className="py-2.5 rounded-xl bg-[#16A34A] hover:bg-emerald-700 disabled:bg-slate-300 disabled:text-slate-500 text-white font-bold text-xs flex items-center justify-center gap-1.5 shadow-md shadow-emerald-600/20 cursor-pointer transition-colors disabled:cursor-not-allowed"
                  id="btn-submit-order"
                >
                  {isSubmittingOrder ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      <span>{submittingStateText || 'Validando pedido...'}</span>
                    </>
                  ) : (
                    <>
                      <MessageSquare className="w-3.5 h-3.5" />
                      <span>Enviar pedido pelo WhatsApp</span>
                    </>
                  )}
                </button>
              </div>
            )}

          </div>
        )}

      </div>
    </div>
  );
};
