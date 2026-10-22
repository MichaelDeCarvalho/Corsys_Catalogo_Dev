import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useAuth } from './AuthContext';
import { useApp } from './AppContext';
import { WholesaleItemData, WholesaleCustomerStatus } from '../types';
import { fetchMyWholesaleStatus, fetchWholesaleCatalog } from '../services/wholesaleService';
import { PUBLIC_TENANT_SLUG } from '../config/tenant';
import { createWholesaleRequestGate } from '../utils/wholesaleRequestGate';

export type PurchaseMode = 'retail' | 'wholesale';
export type WholesaleAccessStatus = 'unauthenticated' | WholesaleCustomerStatus;

export interface WholesaleCompanyInfo {
  legalName: string;
  tradeName?: string | null;
  cnpj: string;
  contactName: string;
  email: string;
  phone: string;
}

export interface WholesaleAccessContextType {
  // Modalidade de Compra
  purchaseMode: PurchaseMode;
  requestSwitchPurchaseMode: (mode: PurchaseMode) => void;

  // Estado de Autorização B2B
  wholesaleStatus: WholesaleAccessStatus;
  isApproved: boolean;
  isPending: boolean;
  isSuspended: boolean;
  isRejected: boolean;
  wholesaleCompany: WholesaleCompanyInfo | null;
  loadingStatus: boolean;

  // Catálogo Atacadista Autorizado (Map productId -> WholesaleItemData)
  wholesaleCatalogMap: Map<string, WholesaleItemData>;
  isLoadingWholesaleCatalog: boolean;
  wholesaleCatalogError: string | null;
  getWholesaleItem: (productId: string) => WholesaleItemData | undefined;

  // Ações de Atualização
  refreshWholesaleStatus: () => Promise<void>;
  loadWholesaleCatalog: () => Promise<void>;
  clearWholesaleSession: () => void;

  // Controle de Modais B2B
  isB2BGateModalOpen: boolean;
  openB2BGateModal: () => void;
  closeB2BGateModal: () => void;

  isB2BRegisterModalOpen: boolean;
  openB2BRegisterModal: () => void;
  closeB2BRegisterModal: () => void;

  isSwitchModeDialogOpen: boolean;
  targetPendingMode: PurchaseMode | null;
  confirmSwitchPurchaseMode: () => void;
  cancelSwitchPurchaseMode: () => void;
}

const WholesaleAccessContext = createContext<WholesaleAccessContextType | undefined>(undefined);
const EMPTY_WHOLESALE_CATALOG = new Map<string, WholesaleItemData>();

export const WholesaleAccessProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  const { cart, clearCart, showToast, setShoppingMode } = useApp();
  // AppContext expõe ações recriadas em renders; seus callbacks atuais ficam em ref
  // para não reiniciar as consultas de autorização ao mudar carrinho/toast/modo.
  const appActionsRef = React.useRef({ clearCart, showToast, setShoppingMode });
  appActionsRef.current = { clearCart, showToast, setShoppingMode };

  const [purchaseMode, setPurchaseModeState] = useState<PurchaseMode>('retail');
  const [wholesaleStatus, setWholesaleStatus] = useState<WholesaleAccessStatus>('unauthenticated');
  const [wholesaleCompany, setWholesaleCompany] = useState<WholesaleCompanyInfo | null>(null);
  const [wholesaleOwnerId, setWholesaleOwnerId] = useState<string | null>(null);
  const [loadingStatus, setLoadingStatus] = useState<boolean>(false);

  // Projeção autorizada de atacado (mantida estritamente em memória de sessão)
  const [wholesaleCatalogMap, setWholesaleCatalogMap] = useState<Map<string, WholesaleItemData>>(new Map());
  const [isLoadingWholesaleCatalog, setIsLoadingWholesaleCatalog] = useState<boolean>(false);
  const [wholesaleCatalogError, setWholesaleCatalogError] = useState<string | null>(null);

  // Modais de Acesso B2B
  const [isB2BGateModalOpen, setIsB2BGateModalOpen] = useState(false);
  const [isB2BRegisterModalOpen, setIsB2BRegisterModalOpen] = useState(false);
  const [isSwitchModeDialogOpen, setIsSwitchModeDialogOpen] = useState(false);
  const [targetPendingMode, setTargetPendingMode] = useState<PurchaseMode | null>(null);

  // Tenant canônico oficial para B2B
  const activeTenantSlug = PUBLIC_TENANT_SLUG;
  const currentUserIdRef = React.useRef<string | null>(user?.id ?? null);
  currentUserIdRef.current = user?.id ?? null;
  const sessionUserIdRef = React.useRef<string | null>(user?.id ?? null);
  const statusRequestGateRef = React.useRef(createWholesaleRequestGate());
  const catalogRequestGateRef = React.useRef(createWholesaleRequestGate());
  const catalogLoadedUserIdRef = React.useRef<string | null>(null);
  const confirmationRef = React.useRef(0);
  const confirmingRef = React.useRef(false);

  // Sincronização estrita entre purchaseMode autoritativo e shoppingMode legado do AppContext
  const setPurchaseModeSynchronized = useCallback((mode: PurchaseMode) => {
    setPurchaseModeState(mode);
    appActionsRef.current.setShoppingMode(mode);
  }, []);

  const cartRef = React.useRef(cart);
  cartRef.current = cart;
  const purchaseModeRef = React.useRef(purchaseMode);
  purchaseModeRef.current = purchaseMode;

  // Fallback seguro para retail com limpeza de carrinho fora de state updater
  const resetToRetail = useCallback(() => {
    if (purchaseModeRef.current === 'wholesale' && cartRef.current.length > 0) {
      appActionsRef.current.clearCart();
    }
    setPurchaseModeState('retail');
    appActionsRef.current.setShoppingMode('retail');
  }, []);

  // Invalida respostas pendentes sempre que sessão B2B for limpa.
  const clearWholesaleSession = useCallback(() => {
    confirmationRef.current++;
    confirmingRef.current = false;
    statusRequestGateRef.current.invalidate();
    catalogRequestGateRef.current.invalidate();
    catalogLoadedUserIdRef.current = null;
    resetToRetail();
    setWholesaleStatus('unauthenticated');
    setWholesaleOwnerId(null);
    setWholesaleCompany(null);
    setWholesaleCatalogMap(new Map());
    setWholesaleCatalogError(null);
    setLoadingStatus(false);
    setIsLoadingWholesaleCatalog(false);
    setIsSwitchModeDialogOpen(false);
    setTargetPendingMode(null);
  }, [resetToRetail]);

  // Só a resposta mais recente do usuário ainda autenticado pode alterar status.
  const refreshWholesaleStatus = useCallback(async () => {
    if (!user?.id) {
      clearWholesaleSession();
      return;
    }

    const request = statusRequestGateRef.current.begin(user.id);
    catalogRequestGateRef.current.invalidate();
    catalogLoadedUserIdRef.current = null;
    setWholesaleOwnerId(null);
    setWholesaleStatus('unauthenticated');
    setWholesaleCompany(null);
    setWholesaleCatalogMap(new Map());
    setWholesaleCatalogError(null);
    setIsLoadingWholesaleCatalog(false);
    setLoadingStatus(true);
    try {
      const res = await fetchMyWholesaleStatus(activeTenantSlug);
      if (!statusRequestGateRef.current.isCurrent(request, currentUserIdRef.current)) return;

      setWholesaleOwnerId(request.userId);
      if (res.status === 'approved') {
        setWholesaleStatus('approved');
        setWholesaleCompany({
          legalName: res.legalName || 'Empresa Cadastrada',
          tradeName: res.tradeName,
          cnpj: res.cnpj || '',
          contactName: res.contactName || '',
          email: res.email || user.email || '',
          phone: res.phone || ''
        });
      } else if (res.status === 'pending') {
        resetToRetail();
        setWholesaleStatus('pending');
        setWholesaleCompany({
          legalName: res.legalName || 'Empresa em Análise',
          tradeName: res.tradeName,
          cnpj: res.cnpj || '',
          contactName: res.contactName || '',
          email: res.email || user.email || '',
          phone: res.phone || ''
        });
      } else if (res.status === 'suspended') {
        resetToRetail();
        setWholesaleStatus('suspended');
      } else if (res.status === 'rejected') {
        resetToRetail();
        setWholesaleStatus('rejected');
      } else {
        resetToRetail();
        setWholesaleStatus('unauthenticated');
      }
      return res.status;
    } catch (err) {
      if (!statusRequestGateRef.current.isCurrent(request, currentUserIdRef.current)) return;
      console.warn('[WholesaleAccessContext] Erro ao carregar status:', err);
      resetToRetail();
      setWholesaleStatus('unauthenticated');
      setWholesaleOwnerId(null);
      setWholesaleCompany(null);
      setWholesaleCatalogMap(new Map());
    } finally {
      if (statusRequestGateRef.current.isCurrent(request, currentUserIdRef.current)) {
        setLoadingStatus(false);
      }
    }
  }, [user, activeTenantSlug, clearWholesaleSession, resetToRetail]);

  // Catálogo privado da sessão aprovada atual; respostas obsoletas são descartadas.
  const loadWholesaleCatalog = useCallback(async () => {
    if (!user?.id || wholesaleOwnerId !== user.id || wholesaleStatus !== 'approved') return;

    const request = catalogRequestGateRef.current.begin(user.id);
    setIsLoadingWholesaleCatalog(true);
    setWholesaleCatalogError(null);
    try {
      const items = await fetchWholesaleCatalog(activeTenantSlug);
      if (!catalogRequestGateRef.current.isCurrent(request, currentUserIdRef.current)) return;
      const newMap = new Map<string, WholesaleItemData>();
      for (const it of items) newMap.set(it.productId, it);
      catalogLoadedUserIdRef.current = request.userId;
      setWholesaleCatalogMap(newMap);
    } catch (err: unknown) {
      if (!catalogRequestGateRef.current.isCurrent(request, currentUserIdRef.current)) return;
      const msg = err instanceof Error ? err.message : 'Falha ao carregar catálogo B2B';
      console.error('[WholesaleAccessContext] Erro no catálogo atacadista:', err);
      setWholesaleCatalogError(msg);
      appActionsRef.current.showToast(`Acesso ao atacado: ${msg}`);
      setWholesaleCatalogMap(new Map());
      resetToRetail();
    } finally {
      if (catalogRequestGateRef.current.isCurrent(request, currentUserIdRef.current)) {
        setIsLoadingWholesaleCatalog(false);
      }
    }
  }, [user?.id, wholesaleOwnerId, wholesaleStatus, activeTenantSlug, resetToRetail]);

  // Observa mudanças na autenticação do usuário
  useEffect(() => {
    // Troca direta A -> B também encerra a sessão comercial anterior.
    // Renovação do token do mesmo comprador preserva modalidade e carrinho.
    if (sessionUserIdRef.current !== (user?.id ?? null)) {
      sessionUserIdRef.current = user?.id ?? null;
      clearWholesaleSession();
    }
    if (user) {
      refreshWholesaleStatus();
    } else {
      clearWholesaleSession();
    }
    return () => {
      statusRequestGateRef.current.invalidate();
      catalogRequestGateRef.current.invalidate();
    };
  }, [user, refreshWholesaleStatus, clearWholesaleSession]);

  // Quando o status passa para approved e o usuário está no modo atacado, carrega o catálogo
  useEffect(() => {
    if (wholesaleStatus === 'approved' && wholesaleOwnerId === user?.id && purchaseMode === 'wholesale' && wholesaleCatalogMap.size === 0 && !isLoadingWholesaleCatalog && catalogLoadedUserIdRef.current !== user?.id) {
      loadWholesaleCatalog();
    }
  }, [wholesaleStatus, wholesaleOwnerId, user?.id, purchaseMode, wholesaleCatalogMap.size, isLoadingWholesaleCatalog, loadWholesaleCatalog]);

  // Nunca expor status/identidade privados de uma sessão anterior nem por um render.
  const visibleWholesaleStatus: WholesaleAccessStatus =
    wholesaleOwnerId !== null && wholesaleOwnerId === user?.id ? wholesaleStatus : 'unauthenticated';
  const isApproved = visibleWholesaleStatus === 'approved';
  const isPending = visibleWholesaleStatus === 'pending';
  const isSuspended = visibleWholesaleStatus === 'suspended';
  const isRejected = visibleWholesaleStatus === 'rejected';
  const visibleWholesaleCatalogMap = isApproved ? wholesaleCatalogMap : EMPTY_WHOLESALE_CATALOG;

  // Solicitação de mudança de modalidade com verificação de autorização e proteção de carrinho
  const requestSwitchPurchaseMode = (targetMode: PurchaseMode) => {
    if (targetMode === purchaseMode) return;

    if (targetMode === 'wholesale') {
      // 1. Não autenticado: abre modal gate B2B
      if (!user) {
        setIsB2BGateModalOpen(true);
        return;
      }

      // 2. Status pendente: feedback informativo
      if (isPending) {
        showToast('Cadastro atacadista em análise. Aguarde a validação da nossa equipe comercial.');
        return;
      }

      // 3. Status suspenso
      if (isSuspended) {
        showToast('Acesso atacadista temporariamente indisponível. Entre em contato com a loja.');
        return;
      }

      // 4. Status rejeitado
      if (isRejected) {
        showToast('Cadastro atacadista não aprovado. Entre em contato com o suporte para mais informações.');
        return;
      }

      // 5. Usuário sem cadastro B2B
      if (!isApproved) {
        setIsB2BGateModalOpen(true);
        return;
      }
    }

    // Se o carrinho possui itens, exige confirmação para não misturar modalidades
    if (cart.length > 0) {
      setTargetPendingMode(targetMode);
      setIsSwitchModeDialogOpen(true);
      return;
    }

    // Troca direta com carrinho vazio
    setPurchaseModeSynchronized(targetMode);
    if (targetMode === 'wholesale') {
      loadWholesaleCatalog();
      showToast('Modalidade ATACADO ativada.');
    } else {
      showToast('Modalidade VAREJO ativada.');
    }
  };

  const confirmSwitchPurchaseMode = async () => {
    if (!targetPendingMode || confirmingRef.current) return;
    const target = targetPendingMode;
    // A aprovação pode mudar enquanto o modal de troca está aberto.
    if (targetPendingMode === 'wholesale' && (!user || !isApproved || loadingStatus)) {
      setIsSwitchModeDialogOpen(false);
      setTargetPendingMode(null);
      showToast('Acesso ao atacado não está aprovado para a sessão atual.');
      return;
    }
    if (target === 'wholesale') {
      const buyer = user!.id;
      const confirmation = ++confirmationRef.current;
      confirmingRef.current = true;
      const status = await refreshWholesaleStatus();
      if (confirmation !== confirmationRef.current || currentUserIdRef.current !== buyer) return;
      confirmingRef.current = false;
      if (status !== 'approved') {
        setIsSwitchModeDialogOpen(false);
        setTargetPendingMode(null);
        showToast('Acesso ao atacado não confirmado. Seu carrinho de varejo foi preservado.');
        return;
      }
    }
    clearCart();
    setPurchaseModeSynchronized(target);
    if (target === 'wholesale') {
      loadWholesaleCatalog();
    }
    showToast(`Modalidade alterada para ${target === 'wholesale' ? 'ATACADO' : 'VAREJO'}. Carrinho reiniciado.`);

    setIsSwitchModeDialogOpen(false);
    setTargetPendingMode(null);
  };

  const cancelSwitchPurchaseMode = () => {
    confirmationRef.current++;
    confirmingRef.current = false;
    setIsSwitchModeDialogOpen(false);
    setTargetPendingMode(null);
  };

  const getWholesaleItem = (productId: string): WholesaleItemData | undefined => {
    return visibleWholesaleCatalogMap.get(productId);
  };

  const openB2BGateModal = () => setIsB2BGateModalOpen(true);
  const closeB2BGateModal = () => setIsB2BGateModalOpen(false);
  const openB2BRegisterModal = () => {
    setIsB2BGateModalOpen(false);
    setIsB2BRegisterModalOpen(true);
  };
  const closeB2BRegisterModal = () => setIsB2BRegisterModalOpen(false);

  return (
    <WholesaleAccessContext.Provider
      value={{
        purchaseMode,
        requestSwitchPurchaseMode,
        wholesaleStatus: visibleWholesaleStatus,
        isApproved,
        isPending,
        isSuspended,
        isRejected,
        wholesaleCompany: wholesaleOwnerId === user?.id ? wholesaleCompany : null,
        loadingStatus,
        wholesaleCatalogMap: visibleWholesaleCatalogMap,
        isLoadingWholesaleCatalog,
        wholesaleCatalogError,
        getWholesaleItem,
        refreshWholesaleStatus,
        loadWholesaleCatalog,
        clearWholesaleSession,
        isB2BGateModalOpen,
        openB2BGateModal,
        closeB2BGateModal,
        isB2BRegisterModalOpen,
        openB2BRegisterModal,
        closeB2BRegisterModal,
        isSwitchModeDialogOpen,
        targetPendingMode,
        confirmSwitchPurchaseMode,
        cancelSwitchPurchaseMode,
      }}
    >
      {children}
    </WholesaleAccessContext.Provider>
  );
};

export const useWholesaleAccess = (): WholesaleAccessContextType => {
  const context = useContext(WholesaleAccessContext);
  if (!context) {
    throw new Error('useWholesaleAccess deve ser utilizado dentro de um WholesaleAccessProvider');
  }
  return context;
};
