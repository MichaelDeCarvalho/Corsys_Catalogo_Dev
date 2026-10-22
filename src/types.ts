export type UserRole = 'superadmin' | 'tenant_admin' | 'sales_rep' | 'stock_manager' | 'b2b_client';

export type PlanType = 'starter' | 'pro' | 'enterprise';

export interface TenantPlan {
  id: PlanType;
  name: string;
  priceMonthly: number;
  maxProducts: number;
  maxUsers: number;
  maxMonthlyOrders: number;
  features: string[];
  customDomainAllowed: boolean;
  b2bPortalAllowed: boolean;
  commissionTracking: boolean;
}

export interface TenantUser {
  id: string;
  tenantId: string;
  name: string;
  email: string;
  role: UserRole;
  avatarUrl?: string;
  phone?: string;
  sellerCode?: string;
  commissionRate?: number; // e.g. 5%
  permissions: {
    canEditProducts: boolean;
    canViewCostPrice: boolean;
    canManageOrders: boolean;
    canAccessSettings: boolean;
    canManageTeam: boolean;
    canExportData: boolean;
  };
  status: 'active' | 'pending' | 'blocked';
  createdAt: string;
}

export interface WholesaleTier {
  minQuantity: number;
  price: number;
  discountPercentage?: number;
}

export interface ProductVariant {
  id: string;
  name: string; // e.g. "Tamanho", "Cor", "Voltagem"
  options: string[]; // ["P", "M", "G"]
}

export interface Product {
  id: string;
  tenantId: string;
  name: string;
  sku: string;
  barcode?: string | null;
  category: string;
  subcategory?: string | null;
  brand?: string | null;
  description?: string | null;
  technicalSpecs?: Record<string, unknown>;
  costPrice?: number | null; // Custo (visível apenas para admins)
  price: number; // Preço Varejo
  promotionalPrice?: number | null; // Preço promocional
  wholesalePrice?: number | null; // Preço Atacado base
  wholesaleEnabled?: boolean; // Se o produto participa da modalidade atacado
  wholesaleMinQuantity?: number | null; // Qtd mínima necessária no atacado
  wholesaleTiers?: WholesaleTier[]; // Descontos por escala
  minOrderQuantity: number; // Qtd mínima de compra
  stock: number;
  unit: string; // 'un', 'cx', 'pct', 'kg', 'dz', 'par'
  images: string[];
  featured?: boolean;
  isNew?: boolean;
  active: boolean;
  tags?: string[];
  weightKg?: number;
  dimensions?: {
    height: number;
    width: number;
    depth: number;
  };
  sortOrder?: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface TenantPublicSettings {
  tenantId: string;
  slug: string;
  publicName: string;
  whatsappNumber: string;
  logoUrl: string | null;
  bannerUrl: string | null;
  primaryColor: string;
  accentColor: string;
  minOrderValue: number;
  wholesaleMinOrderValue: number | null;
  allowB2bMode: boolean;
  hidePricesWithoutLogin: boolean;
  checkoutFields?: import('./config/checkoutFields').CheckoutFieldsConfig;
  deliveryMethods: string[];
  createdAt?: string;
  updatedAt?: string;
}

export interface TenantCustomization {
  businessName: string;
  tradeName?: string; // Nome fantasia
  cnpjCpf?: string;
  segment: string;
  slug: string; // e.g. 'mc-distribuicao'
  customDomain?: string; // e.g. 'catalogo.mcdistribuicao.com.br'
  logoUrl: string;
  bannerUrl: string;
  primaryColor: string;
  accentColor: string;
  whatsappNumber: string; // 5511999999999
  emailContact: string;
  address?: string;
  cityState?: string;
  pixKey?: string;
  pixKeyType?: 'cpf' | 'cnpj' | 'email' | 'phone' | 'random';
  minOrderValue: number;
  allowB2BMode: boolean; // Ativa grade de pedidos rápida
  hidePricesWithoutLogin: boolean; // Exigir login para ver preços atacado
  enableResendEmail: boolean;
  resendApiKey?: string;
  resendSenderEmail?: string;
  deliveryMethods: {
    pickup: boolean;
    carrierDelivery: boolean;
    fixedFreight: boolean;
    fixedFreightValue?: number;
    freeFreightThreshold?: number;
  };
  announcementText?: string;
}

export interface Tenant {
  id: string;
  name: string;
  slug: string;
  ownerEmail: string;
  ownerName: string;
  ownerPhone: string;
  plan: PlanType;
  status: 'active' | 'trial' | 'suspended' | 'canceled';
  createdAt: string;
  trialExpiresAt?: string;
  customization: TenantCustomization;
  stats: {
    totalProducts: number;
    totalOrders: number;
    totalRevenue: number;
    monthVisits: number;
  };
}

export interface OrderItem {
  productId: string;
  productName: string;
  productSku: string;
  productImage: string;
  unitPrice: number;
  quantity: number;
  unit: string;
  totalPrice: number;
  selectedVariant?: string;
}

export type OrderStatus = 'pending' | 'approved' | 'preparing' | 'dispatched' | 'delivered' | 'cancelled';
export type PaymentMethod = 'pix' | 'boleto' | 'credit_card' | 'cash_on_delivery';

export interface Order {
  id: string;
  orderNumber: string;
  tenantId: string;
  sellerId?: string;
  sellerCode?: string;
  customer: {
    name: string;
    phone: string;
    type: 'PF' | 'PJ';
    email?: string;
    document?: string; // CPF ou CNPJ
    companyName?: string;
  };
  shippingAddress: {
    street: string;
    number?: string;
    complement?: string;
    neighborhood?: string;
    city?: string;
    state?: string;
    zipCode?: string;
  };
  items: OrderItem[];
  subtotal: number;
  discount: number;
  shippingFee: number;
  total: number;
  status: OrderStatus;
  paymentMethod: PaymentMethod;
  notes?: string;
  createdAt: string;
  updatedAt: string;
  source: 'whatsapp' | 'web_checkout' | 'sales_rep';
  shoppingMode?: 'retail' | 'wholesale';
  deliveryMethod?: string;
}

export interface CartItem {
  product: Product;
  quantity: number;
  selectedVariant?: string;
  unitPrice: number;
}

export type WholesaleCustomerStatus = 'pending' | 'approved' | 'rejected' | 'suspended';

export interface WholesaleCustomer {
  id: string;
  tenantId: string;
  userId?: string | null;
  cnpj: string;
  legalName: string;
  tradeName?: string | null;
  contactName: string;
  email: string;
  phone: string;
  city?: string | null;
  state?: string | null;
  status: WholesaleCustomerStatus;
  approvedAt?: string | null;
  approvedBy?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WholesaleItemData {
  productId: string;
  sku: string;
  wholesalePrice: number;
  wholesaleMinQuantity: number;
}
