import React, { createContext, useContext, useState, useEffect } from 'react';
import { 
  Tenant, 
  Product, 
  TenantUser, 
  Order, 
  CartItem, 
  UserRole, 
  PlanType,
  OrderStatus,
  TenantCustomization
} from '../types';
import { 
  INITIAL_TENANTS, 
  INITIAL_PRODUCTS, 
  INITIAL_USERS, 
  INITIAL_ORDERS,
  SAAS_PLANS 
} from '../data/initialData';

export type AppViewMode = 'superadmin' | 'tenant_admin' | 'storefront' | 'blueprint_guide' | 'my_orders';
export type ShoppingMode = 'retail' | 'wholesale';

interface AppContextType {
  viewMode: AppViewMode;
  setViewMode: (mode: AppViewMode) => void;
  
  // Shopping Mode (Varejo / Atacado)
  shoppingMode: ShoppingMode;
  setShoppingMode: (mode: ShoppingMode) => void;
  requestShoppingModeChange: (newMode: ShoppingMode) => void;
  confirmShoppingModeChange: (action: 'recalculate' | 'clear' | 'remove_incompatible') => void;
  cancelShoppingModeChange: () => void;
  pendingShoppingMode: ShoppingMode | null;
  minOrderValue: number;
  isBelowMinOrder: boolean;
  missingAmount: number;
  
  // Current Tenant
  currentTenantId: string;
  setCurrentTenantId: (id: string) => void;
  currentTenant: Tenant;
  tenants: Tenant[];
  addTenant: (tenantData: Omit<Tenant, 'id' | 'createdAt' | 'stats'>) => Tenant;
  updateTenant: (id: string, updates: Partial<Tenant>) => void;
  updateTenantCustomization: (id: string, customization: Partial<TenantCustomization>) => void;
  deleteTenant: (id: string) => void;

  // Products
  products: Product[];
  currentTenantProducts: Product[];
  addProduct: (productData: Omit<Product, 'id'>) => Product;
  updateProduct: (id: string, updates: Partial<Product>) => void;
  deleteProduct: (id: string) => void;
  toggleProductStatus: (id: string) => void;

  // Orders
  orders: Order[];
  currentTenantOrders: Order[];
  createOrder: (orderData: Omit<Order, 'id' | 'orderNumber' | 'createdAt' | 'updatedAt'>) => Order;
  updateOrderStatus: (orderId: string, status: OrderStatus) => void;
  deleteOrder: (orderId: string) => void;

  // Team & RBAC
  users: TenantUser[];
  currentTenantUsers: TenantUser[];
  currentUser: TenantUser | null;
  setCurrentUser: (user: TenantUser | null) => void;
  addUser: (userData: Omit<TenantUser, 'id' | 'createdAt'>) => TenantUser;
  updateUser: (id: string, updates: Partial<TenantUser>) => void;
  deleteUser: (id: string) => void;

  // Cart (for Storefront)
  cart: CartItem[];
  addToCart: (product: Product, quantity?: number, selectedVariant?: string) => void;
  updateCartQuantity: (productId: string, quantity: number, selectedVariant?: string) => void;
  removeFromCart: (productId: string, selectedVariant?: string) => void;
  clearCart: () => void;
  isCartOpen: boolean;
  setIsCartOpen: (open: boolean) => void;
  cartSubtotal: number;
  cartItemsCount: number;

  // Toast / Feedback
  toastMessage: string | null;
  showToast: (msg: string) => void;

  // Filter / Search in Storefront
  storefrontSearch: string;
  setStorefrontSearch: (q: string) => void;
  selectedCategory: string;
  setSelectedCategory: (cat: string) => void;
  b2bQuickMode: boolean;
  setB2bQuickMode: (b2b: boolean) => void;

  // Reset to Demo Data
  resetToDefaultData: () => void;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

const LOCAL_STORAGE_KEY = 'omnicatalogo_saas_data_v3';

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [viewMode, setViewMode] = useState<AppViewMode>('storefront');
  const [currentTenantId, setCurrentTenantId] = useState<string>('tenant-mc-distribuicao');
  
  // State lists
  const [tenants, setTenants] = useState<Tenant[]>(() => {
    try {
      const saved = localStorage.getItem(`${LOCAL_STORAGE_KEY}_tenants`);
      return saved ? JSON.parse(saved) : INITIAL_TENANTS;
    } catch {
      return INITIAL_TENANTS;
    }
  });

  const [products, setProducts] = useState<Product[]>(() => {
    try {
      const saved = localStorage.getItem(`${LOCAL_STORAGE_KEY}_products`);
      if (saved) {
        const parsed: Product[] = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          // Sanitizador estritamente cirúrgico e defensivo:
          // Atua SOMENTE sobre itens de imagem que contenham comprovadamente o domínio de fotos fake
          // ('images.unsplash.com') introduzido na intervenção anterior, preservando 100% de todos os outros
          // campos (preço, estoque, SKU, nome, categoria, etc.), novos produtos e imagens customizadas do usuário.
          // NUNCA modifica dados legítimos, pedidos, tenants ou URLs do Supabase V1.
          const initialMap = new Map(INITIAL_PRODUCTS.map(p => [p.id, p]));
          let hadCorruptedFakeImages = false;

          const sanitized = parsed.map(p => {
            if (!Array.isArray(p.images) || p.images.length === 0) {
              return p;
            }

            const hasUnsplash = p.images.some(img => typeof img === 'string' && img.includes('images.unsplash.com'));
            if (!hasUnsplash) {
              return p;
            }

            hadCorruptedFakeImages = true;
            const official = initialMap.get(p.id);

            if (official && Array.isArray(official.images)) {
              // Produto oficial do catálogo: substitui cirurgicamente apenas as URLs fake do Unsplash
              // pela respectiva referência oficial histórica preservada, mantendo quaisquer outras fotos
              const restoredImages = p.images.map((img, idx) => {
                if (typeof img === 'string' && img.includes('images.unsplash.com')) {
                  return official.images[idx] || official.images[0] || '';
                }
                return img;
              }).filter(Boolean);

              return { ...p, images: restoredImages };
            }

            // Produto customizado criado pelo usuário: remove estritamente o link fake sem alterar nada mais
            const filteredImages = p.images.filter(img => !(typeof img === 'string' && img.includes('images.unsplash.com')));
            return { ...p, images: filteredImages };
          });

          if (hadCorruptedFakeImages) {
            localStorage.setItem(`${LOCAL_STORAGE_KEY}_products`, JSON.stringify(sanitized));
            return sanitized;
          }

          return parsed;
        }
      }
      return INITIAL_PRODUCTS;
    } catch {
      return INITIAL_PRODUCTS;
    }
  });

  // LEGACY DEMO ORDER STATE — NOT AUTHORITATIVE FOR ADMIN ORDERS.
  const [orders, setOrders] = useState<Order[]>(() => {
    try {
      const saved = localStorage.getItem(`${LOCAL_STORAGE_KEY}_orders`);
      return saved ? JSON.parse(saved) : INITIAL_ORDERS;
    } catch {
      return INITIAL_ORDERS;
    }
  });

  const [users, setUsers] = useState<TenantUser[]>(() => {
    try {
      const saved = localStorage.getItem(`${LOCAL_STORAGE_KEY}_users`);
      return saved ? JSON.parse(saved) : INITIAL_USERS;
    } catch {
      return INITIAL_USERS;
    }
  });

  // Current logged-in user in the context of the active tenant
  const [currentUser, setCurrentUser] = useState<TenantUser | null>(null);

  // Cart
  const [cart, setCart] = useState<CartItem[]>([]);
  const [isCartOpen, setIsCartOpen] = useState(false);

  // Shopping Mode (Varejo / Atacado)
  const [shoppingMode, setShoppingModeState] = useState<ShoppingMode>('retail');
  const [pendingShoppingMode, setPendingShoppingMode] = useState<ShoppingMode | null>(null);

  // Storefront search & filters
  const [storefrontSearch, setStorefrontSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('Todos');
  const [b2bQuickMode, setB2bQuickMode] = useState(false);

  // Toast
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage((current) => (current === msg ? null : current));
    }, 4000);
  };

  // Sync to LocalStorage
  useEffect(() => {
    try {
      localStorage.setItem(`${LOCAL_STORAGE_KEY}_tenants`, JSON.stringify(tenants));
    } catch (e) {
      console.warn('Storage save failed', e);
    }
  }, [tenants]);

  useEffect(() => {
    try {
      localStorage.setItem(`${LOCAL_STORAGE_KEY}_products`, JSON.stringify(products));
    } catch (e) {
      console.warn('Storage save failed', e);
    }
  }, [products]);

  useEffect(() => {
    try {
      localStorage.setItem(`${LOCAL_STORAGE_KEY}_orders`, JSON.stringify(orders));
    } catch (e) {
      console.warn('Storage save failed', e);
    }
  }, [orders]);

  useEffect(() => {
    try {
      localStorage.setItem(`${LOCAL_STORAGE_KEY}_users`, JSON.stringify(users));
    } catch (e) {
      console.warn('Storage save failed', e);
    }
  }, [users]);

  // Derived current tenant
  const currentTenant = tenants.find(t => t.id === currentTenantId) || tenants[0] || INITIAL_TENANTS[0];

  // Limpa carrinho ao trocar de tenant (troca livre de papéis removida - autenticação real via AuthContext)
  useEffect(() => {
    setCart([]);
  }, [currentTenantId]);

  // Tenant filtered items
  const currentTenantProducts = products.filter(p => p.tenantId === currentTenantId);
  const currentTenantOrders = orders.filter(o => o.tenantId === currentTenantId);
  const currentTenantUsers = users.filter(u => u.tenantId === currentTenantId);

  // Shopping Mode Handlers
  const requestShoppingModeChange = (newMode: ShoppingMode) => {
    if (newMode === shoppingMode) return;
    if (cart.length === 0) {
      setShoppingModeState(newMode);
      showToast(`Modalidade alterada para ${newMode === 'wholesale' ? 'Atacado (Mínimo R$ 1.000)' : 'Varejo (Mínimo R$ 400)'}`);
    } else {
      setPendingShoppingMode(newMode);
    }
  };

  const confirmShoppingModeChange = (action: 'recalculate' | 'clear' | 'remove_incompatible') => {
    if (!pendingShoppingMode) return;
    const targetMode = pendingShoppingMode;

    if (action === 'clear') {
      setCart([]);
      setShoppingModeState(targetMode);
      setPendingShoppingMode(null);
      showToast(`Carrinho esvaziado. Modalidade alterada para ${targetMode === 'wholesale' ? 'Atacado' : 'Varejo'}.`);
    } else {
      // Verifica se existem produtos incompatíveis com o modo atacadista
      if (targetMode === 'wholesale') {
        const incompatibleItems = cart.filter(item => {
          const participatesWholesale = Boolean(
            item.product.wholesaleEnabled &&
            item.product.wholesalePrice !== null &&
            item.product.wholesalePrice !== undefined &&
            item.product.wholesalePrice > 0
          );
          if (!participatesWholesale) return true;
          const minQty = item.product.wholesaleMinQuantity || 1;
          if (item.product.stock < minQty) return true;
          return false;
        });

        // Se houver incompatíveis e a ação for apenas recalcular sem consentimento explícito, NÃO remove e bloqueia
        if (incompatibleItems.length > 0 && action !== 'remove_incompatible') {
          showToast(`Existem ${incompatibleItems.length} item(ns) incompatível(is) no carrinho. Remova-os ou autorize a remoção para alterar.`);
          return;
        }
      }

      let removedIncompatibleCount = 0;
      const updatedCart: CartItem[] = [];

      for (const item of cart) {
        if (targetMode === 'wholesale') {
          const participatesWholesale = Boolean(
            item.product.wholesaleEnabled &&
            item.product.wholesalePrice !== null &&
            item.product.wholesalePrice !== undefined &&
            item.product.wholesalePrice > 0
          );

          const minQty = item.product.wholesaleMinQuantity || 1;
          const isIncompatible = !participatesWholesale || item.product.stock < minQty;

          if (isIncompatible) {
            if (action === 'remove_incompatible') {
              removedIncompatibleCount++;
              continue; // Removido somente com autorização explícita
            } else {
              // Não remove silenciosamente
              return;
            }
          }

          const unitPrice = item.product.wholesalePrice!;
          const quantity = Math.max(item.quantity, minQty);

          updatedCart.push({
            ...item,
            quantity,
            unitPrice
          });
        } else {
          // Voltando para varejo
          const unitPrice = item.product.promotionalPrice || item.product.price;
          updatedCart.push({
            ...item,
            unitPrice
          });
        }
      }

      setCart(updatedCart);
      setShoppingModeState(targetMode);
      setPendingShoppingMode(null);

      if (removedIncompatibleCount > 0) {
        showToast(`Modalidade alterada para Atacado. ${removedIncompatibleCount} item(ns) incompatível(is) foram removido(s) com sua confirmação.`);
      } else {
        showToast(`Modalidade alterada para ${targetMode === 'wholesale' ? 'Atacado' : 'Varejo'}. Preços e quantidades recalculados!`);
      }
    }
  };

  const cancelShoppingModeChange = () => {
    setPendingShoppingMode(null);
  };

  // Cart operations
  const addToCart = (product: Product, quantity = 1, selectedVariant?: string) => {
    let appliedPrice = product.promotionalPrice || product.price;
    let effectiveQty = quantity;

    if (shoppingMode === 'wholesale') {
      const isWholesale = Boolean(
        product.wholesaleEnabled &&
        product.wholesalePrice !== null &&
        product.wholesalePrice !== undefined &&
        product.wholesalePrice > 0
      );

      if (isWholesale) {
        const wholesaleMin = product.wholesaleMinQuantity || 1;
        // Validação: se estoque < mínimo, bloqueia adição no atacado
        if (product.stock < wholesaleMin) {
          showToast(`Estoque insuficiente para o mínimo de atacado (Disponível: ${product.stock}, Mínimo: ${wholesaleMin} ${product.unit}).`);
          return;
        }
        effectiveQty = Math.max(quantity, wholesaleMin);
        appliedPrice = product.wholesalePrice!;
      } else {
        // Bloqueio de itens somente varejo no atacado (Regra 48)
        showToast(`"${product.name}" está disponível apenas no Varejo e não pode ser adicionado ao pedido de Atacado.`);
        return;
      }
    } else {
      effectiveQty = Math.max(1, quantity);
    }

    setCart(prev => {
      const existingIndex = prev.findIndex(item => 
        item.product.id === product.id && item.selectedVariant === selectedVariant
      );
      
      const newQty = existingIndex > -1 ? prev[existingIndex].quantity + effectiveQty : effectiveQty;

      if (existingIndex > -1) {
        const updated = [...prev];
        updated[existingIndex] = {
          ...updated[existingIndex],
          quantity: newQty,
          unitPrice: appliedPrice
        };
        return updated;
      } else {
        return [...prev, {
          product,
          quantity: effectiveQty,
          selectedVariant,
          unitPrice: appliedPrice
        }];
      }
    });

    showToast(`Adicionado ao pedido: ${product.name.slice(0, 30)}...`);
  };

  const updateCartQuantity = (productId: string, quantity: number, selectedVariant?: string) => {
    if (quantity <= 0) {
      removeFromCart(productId, selectedVariant);
      return;
    }

    setCart(prev => prev.map(item => {
      if (item.product.id === productId && item.selectedVariant === selectedVariant) {
        let finalQty = quantity;

        if (shoppingMode === 'wholesale') {
          const isWholesale = Boolean(
            item.product.wholesaleEnabled &&
            item.product.wholesalePrice !== null &&
            item.product.wholesalePrice !== undefined &&
            item.product.wholesalePrice > 0
          );
          if (isWholesale) {
            const minQty = item.product.wholesaleMinQuantity || 1;
            if (finalQty < minQty) {
              finalQty = minQty;
              showToast(`Quantidade mínima de atacado para este item é ${minQty} ${item.product.unit}.`);
            }
          }
        }

        return { ...item, quantity: finalQty };
      }
      return item;
    }));
  };

  const removeFromCart = (productId: string, selectedVariant?: string) => {
    setCart(prev => prev.filter(item => 
      !(item.product.id === productId && item.selectedVariant === selectedVariant)
    ));
  };

  const clearCart = () => setCart([]);

  const cartSubtotal = cart.reduce((sum, item) => sum + (item.unitPrice * item.quantity), 0);
  const cartItemsCount = cart.reduce((sum, item) => sum + item.quantity, 0);

  // Mínimo de Pedido Oficial por Modalidade: Varejo R$ 400,00 | Atacado R$ 1.000,00
  const minOrderValue = shoppingMode === 'wholesale' ? 1000 : 400;
  const isBelowMinOrder = cartSubtotal < minOrderValue;
  const missingAmount = Math.max(0, minOrderValue - cartSubtotal);

  // Tenant Handlers
  const addTenant = (tenantData: Omit<Tenant, 'id' | 'createdAt' | 'stats'>): Tenant => {
    const newId = `tenant-${tenantData.slug.toLowerCase().replace(/[^a-z0-9]/g, '-')}-${Date.now().toString().slice(-4)}`;
    const newTenant: Tenant = {
      ...tenantData,
      id: newId,
      createdAt: new Date().toISOString(),
      stats: {
        totalProducts: 0,
        totalOrders: 0,
        totalRevenue: 0,
        monthVisits: 10
      }
    };

    setTenants(prev => [newTenant, ...prev]);

    // Create default owner user for this tenant
    const defaultUser: TenantUser = {
      id: `user-${newId}-owner`,
      tenantId: newId,
      name: tenantData.ownerName,
      email: tenantData.ownerEmail,
      role: 'tenant_admin',
      phone: tenantData.ownerPhone,
      permissions: {
        canEditProducts: true,
        canViewCostPrice: true,
        canManageOrders: true,
        canAccessSettings: true,
        canManageTeam: true,
        canExportData: true
      },
      status: 'active',
      createdAt: new Date().toISOString()
    };

    setUsers(prev => [defaultUser, ...prev]);
    setCurrentTenantId(newId);
    showToast(`Loja/Empresa "${newTenant.name}" criada com sucesso!`);
    return newTenant;
  };

  const updateTenant = (id: string, updates: Partial<Tenant>) => {
    setTenants(prev => prev.map(t => t.id === id ? { ...t, ...updates } : t));
    showToast('Configurações da empresa atualizadas!');
  };

  const updateTenantCustomization = (id: string, customization: Partial<TenantCustomization>) => {
    setTenants(prev => prev.map(t => {
      if (t.id === id) {
        return {
          ...t,
          customization: {
            ...t.customization,
            ...customization
          }
        };
      }
      return t;
    }));
    showToast('Identidade visual e dados de contato salvos!');
  };

  const deleteTenant = (id: string) => {
    if (tenants.length <= 1) {
      showToast('Não é possível remover a única empresa cadastrada.');
      return;
    }
    setTenants(prev => prev.filter(t => t.id !== id));
    setProducts(prev => prev.filter(p => p.tenantId !== id));
    setOrders(prev => prev.filter(o => o.tenantId !== id));
    setUsers(prev => prev.filter(u => u.tenantId !== id));
    
    const remaining = tenants.filter(t => t.id !== id);
    if (remaining.length > 0) {
      setCurrentTenantId(remaining[0].id);
    }
    showToast('Empresa e catálogo removidos com sucesso.');
  };

  // Product Handlers
  const addProduct = (productData: Omit<Product, 'id'>): Product => {
    const newId = `prod-${Date.now().toString()}`;
    const newProduct: Product = {
      ...productData,
      id: newId
    };

    setProducts(prev => [newProduct, ...prev]);
    
    // Update tenant stats
    setTenants(prev => prev.map(t => {
      if (t.id === productData.tenantId) {
        return {
          ...t,
          stats: {
            ...t.stats,
            totalProducts: t.stats.totalProducts + 1
          }
        };
      }
      return t;
    }));

    showToast(`Produto "${newProduct.name}" cadastrado!`);
    return newProduct;
  };

  const updateProduct = (id: string, updates: Partial<Product>) => {
    setProducts(prev => prev.map(p => p.id === id ? { ...p, ...updates } : p));
    showToast('Produto atualizado com sucesso!');
  };

  const deleteProduct = (id: string) => {
    const prod = products.find(p => p.id === id);
    if (prod) {
      setProducts(prev => prev.filter(p => p.id !== id));
      setTenants(prev => prev.map(t => {
        if (t.id === prod.tenantId) {
          return {
            ...t,
            stats: {
              ...t.stats,
              totalProducts: Math.max(0, t.stats.totalProducts - 1)
            }
          };
        }
        return t;
      }));
      showToast('Produto excluído!');
    }
  };

  const toggleProductStatus = (id: string) => {
    setProducts(prev => prev.map(p => {
      if (p.id === id) {
        const nextState = !p.active;
        showToast(nextState ? 'Produto ativado no catálogo' : 'Produto pausado');
        return { ...p, active: nextState };
      }
      return p;
    }));
  };

  // Order Handlers
  const createOrder = (orderData: Omit<Order, 'id' | 'orderNumber' | 'createdAt' | 'updatedAt'>): Order => {
    const now = new Date();
    const orderNumber = `PED-${now.getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;
    const newOrder: Order = {
      ...orderData,
      id: `order-${Date.now()}`,
      orderNumber,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString()
    };

    setOrders(prev => [newOrder, ...prev]);

    // Update tenant revenue stats
    setTenants(prev => prev.map(t => {
      if (t.id === orderData.tenantId) {
        return {
          ...t,
          stats: {
            ...t.stats,
            totalOrders: t.stats.totalOrders + 1,
            totalRevenue: t.stats.totalRevenue + newOrder.total
          }
        };
      }
      return t;
    }));

    clearCart();
    showToast(`Pedido ${orderNumber} gerado com sucesso!`);
    return newOrder;
  };

  const updateOrderStatus = (orderId: string, status: OrderStatus) => {
    setOrders(prev => prev.map(o => {
      if (o.id === orderId) {
        return {
          ...o,
          status,
          updatedAt: new Date().toISOString()
        };
      }
      return o;
    }));
    showToast(`Status do pedido atualizado para: ${status.toUpperCase()}`);
  };

  const deleteOrder = (orderId: string) => {
    setOrders(prev => prev.filter(o => o.id !== orderId));
    showToast('Pedido removido.');
  };

  // Team Handlers
  const addUser = (userData: Omit<TenantUser, 'id' | 'createdAt'>): TenantUser => {
    const newUser: TenantUser = {
      ...userData,
      id: `user-${Date.now()}`,
      createdAt: new Date().toISOString()
    };
    setUsers(prev => [newUser, ...prev]);
    showToast(`Usuário/Vendedor "${newUser.name}" adicionado!`);
    return newUser;
  };

  const updateUser = (id: string, updates: Partial<TenantUser>) => {
    setUsers(prev => prev.map(u => u.id === id ? { ...u, ...updates } : u));
    showToast('Permissões do usuário atualizadas!');
  };

  const deleteUser = (id: string) => {
    setUsers(prev => prev.filter(u => u.id !== id));
    showToast('Usuário removido da equipe.');
  };

  const resetToDefaultData = () => {
    localStorage.removeItem(`${LOCAL_STORAGE_KEY}_tenants`);
    localStorage.removeItem(`${LOCAL_STORAGE_KEY}_products`);
    localStorage.removeItem(`${LOCAL_STORAGE_KEY}_orders`);
    localStorage.removeItem(`${LOCAL_STORAGE_KEY}_users`);
    setTenants(INITIAL_TENANTS);
    setProducts(INITIAL_PRODUCTS);
    setOrders(INITIAL_ORDERS);
    setUsers(INITIAL_USERS);
    setCurrentTenantId('tenant-mc-distribuicao');
    showToast('Dados restaurados para o padrão de demonstração!');
  };

  return (
    <AppContext.Provider
      value={{
        viewMode,
        setViewMode,
        currentTenantId,
        setCurrentTenantId,
        currentTenant,
        tenants,
        addTenant,
        updateTenant,
        updateTenantCustomization,
        deleteTenant,
        products,
        currentTenantProducts,
        addProduct,
        updateProduct,
        deleteProduct,
        toggleProductStatus,
        orders,
        currentTenantOrders,
        createOrder,
        updateOrderStatus,
        deleteOrder,
        users,
        currentTenantUsers,
        currentUser,
        setCurrentUser,
        addUser,
        updateUser,
        deleteUser,
        cart,
        addToCart,
        updateCartQuantity,
        removeFromCart,
        clearCart,
        isCartOpen,
        setIsCartOpen,
        cartSubtotal,
        cartItemsCount,
        shoppingMode,
        setShoppingMode: setShoppingModeState,
        requestShoppingModeChange,
        confirmShoppingModeChange,
        cancelShoppingModeChange,
        pendingShoppingMode,
        minOrderValue,
        isBelowMinOrder,
        missingAmount,
        toastMessage,
        showToast,
        storefrontSearch,
        setStorefrontSearch,
        selectedCategory,
        setSelectedCategory,
        b2bQuickMode,
        setB2bQuickMode,
        resetToDefaultData
      }}
    >
      {children}
    </AppContext.Provider>
  );
};

export const useApp = () => {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useApp must be used within an AppProvider');
  }
  return context;
};
