import { Tenant, Product, TenantUser, TenantPlan, Order } from '../types';
import { MC_CATALOG_PRODUCTS } from './mcCatalogProducts';

export const SAAS_PLANS: TenantPlan[] = [
  {
    id: 'starter',
    name: 'Starter Vendedor',
    priceMonthly: 79.90,
    maxProducts: 80,
    maxUsers: 2,
    maxMonthlyOrders: 150,
    features: [
      'Catálogo online com link personalizado',
      'Pedidos direto no WhatsApp formatados',
      'Até 80 produtos cadastrados',
      'Até 2 usuários/vendedores',
      'Gestão de estoque básica',
      'Suporte via e-mail e WhatsApp'
    ],
    customDomainAllowed: false,
    b2bPortalAllowed: false,
    commissionTracking: false,
  },
  {
    id: 'pro',
    name: 'Pro Distribuição & Loja',
    priceMonthly: 189.90,
    maxProducts: 1000,
    maxUsers: 8,
    maxMonthlyOrders: 1000,
    features: [
      'Tudo do plano Starter',
      'Tabela de Preço Atacado e Varejo com descontos progressivos',
      'Controle de Vendedores e Comissões',
      'Grade de Pedido Rápido B2B',
      'Integração de Notificações com Resend (E-mail transacional)',
      'Gestão de Pedidos em Kanban',
      'Exportação e Importação Excel/CSV',
      'Suporte Prioritário'
    ],
    customDomainAllowed: true,
    b2bPortalAllowed: true,
    commissionTracking: true,
  },
  {
    id: 'enterprise',
    name: 'Enterprise Multilojas',
    priceMonthly: 399.90,
    maxProducts: 10000,
    maxUsers: 30,
    maxMonthlyOrders: 99999,
    features: [
      'Tudo do plano Pro sem limites',
      'Domínio próprio personalizado (ex: catalogo.sualoja.com.br)',
      'Multi-tabelas de preços VIP / Atacado Ouro',
      'Webhook & API para ERP / Supabase dedicado',
      'Gerente de Contas Dedicado',
      'Whitelabel total (sem logo do SaaS)',
      'Relatórios avançados de margem e faturamento'
    ],
    customDomainAllowed: true,
    b2bPortalAllowed: true,
    commissionTracking: true,
  }
];

export const INITIAL_TENANTS: Tenant[] = [
  {
    id: 'tenant-mc-distribuicao',
    name: 'MC Distribuição',
    slug: 'mc-distribuicao',
    ownerEmail: 'michael.c.carvalho@gmail.com',
    ownerName: 'Michael Carvalho',
    ownerPhone: '11987654321',
    plan: 'pro',
    status: 'active',
    createdAt: '2025-01-10T10:00:00Z',
    customization: {
      businessName: 'MC Distribuição e Logística Ltda',
      tradeName: 'MC Distribuição',
      cnpjCpf: '34.567.890/0001-12',
      segment: 'Ferramentas, Abrasivos, Brocas e Marmoraria',
      slug: 'mc-distribuicao',
      customDomain: 'catalogo.mcdistribuicao.com.br',
      logoUrl: 'https://images.unsplash.com/photo-1581244277943-fe4a9c777189?w=200&auto=format&fit=crop&q=80',
      bannerUrl: 'https://images.unsplash.com/photo-1504917599217-d4dc5ebe6122?w=1200&auto=format&fit=crop&q=80',
      primaryColor: '#0284c7', // Sky-600
      accentColor: '#0f172a',
      whatsappNumber: '5511987654321',
      emailContact: 'vendas@mcdistribuicao.com.br',
      address: 'Av. Industrial, 1500 - Galpão 4',
      cityState: 'São Paulo - SP',
      pixKey: '34567890000112',
      pixKeyType: 'cnpj',
      minOrderValue: 250.00,
      allowB2BMode: true,
      hidePricesWithoutLogin: false,
      enableResendEmail: true,
      resendSenderEmail: 'pedidos@mcdistribuicao.com.br',
      deliveryMethods: {
        pickup: true,
        carrierDelivery: true,
        fixedFreight: true,
        fixedFreightValue: 35.00,
        freeFreightThreshold: 1000.00
      },
      announcementText: '📦 ATACADO DIRETO DE FÁBRICA: Brocas HSS, Discos Diamantados, Rebolos, Lixas e Cubas | Frete Grátis acima de R$ 1.000,00!'
    },
    stats: {
      totalProducts: 92,
      totalOrders: 142,
      totalRevenue: 58940.00,
      monthVisits: 3240
    }
  },
  {
    id: 'tenant-moda-estilo',
    name: 'Vogue & Estilo Confecções',
    slug: 'vogue-estilo',
    ownerEmail: 'vendas@vogueestilo.com.br',
    ownerName: 'Fernanda Lima',
    ownerPhone: '11991234567',
    plan: 'starter',
    status: 'active',
    createdAt: '2025-02-01T14:30:00Z',
    customization: {
      businessName: 'Vogue & Estilo Moda Ltda',
      tradeName: 'Vogue & Estilo',
      cnpjCpf: '12.345.678/0001-90',
      segment: 'Moda Feminina e Acessórios',
      slug: 'vogue-estilo',
      logoUrl: 'https://images.unsplash.com/photo-1490481651871-ab68de25d43d?w=200&auto=format&fit=crop&q=80',
      bannerUrl: 'https://images.unsplash.com/photo-1441986300917-64674bd600d8?w=1200&auto=format&fit=crop&q=80',
      primaryColor: '#e11d48', // Rose-600
      accentColor: '#4c0519',
      whatsappNumber: '5511991234567',
      emailContact: 'contato@vogueestilo.com.br',
      address: 'Rua Oscar Freire, 800',
      cityState: 'São Paulo - SP',
      pixKey: 'vendas@vogueestilo.com.br',
      pixKeyType: 'email',
      minOrderValue: 80.00,
      allowB2BMode: false,
      hidePricesWithoutLogin: false,
      enableResendEmail: true,
      resendSenderEmail: 'loja@vogueestilo.com.br',
      deliveryMethods: {
        pickup: true,
        carrierDelivery: true,
        fixedFreight: true,
        fixedFreightValue: 20.00,
        freeFreightThreshold: 300.00
      },
      announcementText: '✨ Coleção Outono/Inverno 2026 com 10% OFF no PIX! Enviamos para todo o Brasil.'
    },
    stats: {
      totalProducts: 24,
      totalOrders: 68,
      totalRevenue: 14200.00,
      monthVisits: 1450
    }
  },
  {
    id: 'tenant-tecno-suprimentos',
    name: 'TecnoSupply Distribuidora',
    slug: 'tecnosupply',
    ownerEmail: 'comercial@tecnosupply.com.br',
    ownerName: 'Rodrigo Alves',
    ownerPhone: '19988776655',
    plan: 'enterprise',
    status: 'active',
    createdAt: '2024-11-20T08:00:00Z',
    customization: {
      businessName: 'TecnoSupply Componentes e Equipamentos S/A',
      tradeName: 'TecnoSupply',
      cnpjCpf: '98.765.432/0001-01',
      segment: 'Informática, Cabos e Automação',
      slug: 'tecnosupply',
      customDomain: 'b2b.tecnosupply.com.br',
      logoUrl: 'https://images.unsplash.com/photo-1550009158-9ebf69173e03?w=200&auto=format&fit=crop&q=80',
      bannerUrl: 'https://images.unsplash.com/photo-1518770660439-4636190af475?w=1200&auto=format&fit=crop&q=80',
      primaryColor: '#059669', // Emerald-600
      accentColor: '#064e3b',
      whatsappNumber: '5519988776655',
      emailContact: 'pedidos@tecnosupply.com.br',
      address: 'Rodovia Santos Dumont, Km 72',
      cityState: 'Campinas - SP',
      pixKey: '98765432000101',
      pixKeyType: 'cnpj',
      minOrderValue: 500.00,
      allowB2BMode: true,
      hidePricesWithoutLogin: false,
      enableResendEmail: true,
      resendSenderEmail: 'notificacoes@tecnosupply.com.br',
      deliveryMethods: {
        pickup: true,
        carrierDelivery: true,
        fixedFreight: true,
        fixedFreightValue: 50.00,
        freeFreightThreshold: 2500.00
      },
      announcementText: '⚡ Preços especiais para revendas e integradores com CNPJ. Faturamento em até 28 DDL sob consulta.'
    },
    stats: {
      totalProducts: 110,
      totalOrders: 310,
      totalRevenue: 184500.00,
      monthVisits: 6800
    }
  }
];

export const INITIAL_USERS: TenantUser[] = [
  // MC Distribuição Users
  {
    id: 'user-mc-admin',
    tenantId: 'tenant-mc-distribuicao',
    name: 'Michael Carvalho (Proprietário)',
    email: 'michael.c.carvalho@gmail.com',
    role: 'tenant_admin',
    phone: '11987654321',
    permissions: {
      canEditProducts: true,
      canViewCostPrice: true,
      canManageOrders: true,
      canAccessSettings: true,
      canManageTeam: true,
      canExportData: true
    },
    status: 'active',
    createdAt: '2025-01-10T10:00:00Z'
  },
  {
    id: 'user-mc-vendedor-1',
    tenantId: 'tenant-mc-distribuicao',
    name: 'Carlos Representante (Vendas Interior)',
    email: 'carlos.vendas@mcdistribuicao.com.br',
    role: 'sales_rep',
    sellerCode: 'CARLOS10',
    commissionRate: 4.5,
    phone: '11977778888',
    permissions: {
      canEditProducts: false,
      canViewCostPrice: false,
      canManageOrders: true,
      canAccessSettings: false,
      canManageTeam: false,
      canExportData: false
    },
    status: 'active',
    createdAt: '2025-01-15T11:00:00Z'
  },
  {
    id: 'user-mc-estoque',
    tenantId: 'tenant-mc-distribuicao',
    name: 'Lucas Expedição',
    email: 'expedicao@mcdistribuicao.com.br',
    role: 'stock_manager',
    phone: '11966665555',
    permissions: {
      canEditProducts: true,
      canViewCostPrice: false,
      canManageOrders: true,
      canAccessSettings: false,
      canManageTeam: false,
      canExportData: false
    },
    status: 'active',
    createdAt: '2025-01-20T09:00:00Z'
  },

  // Vogue Estilo User
  {
    id: 'user-vogue-admin',
    tenantId: 'tenant-moda-estilo',
    name: 'Fernanda Lima',
    email: 'vendas@vogueestilo.com.br',
    role: 'tenant_admin',
    phone: '11991234567',
    permissions: {
      canEditProducts: true,
      canViewCostPrice: true,
      canManageOrders: true,
      canAccessSettings: true,
      canManageTeam: true,
      canExportData: true
    },
    status: 'active',
    createdAt: '2025-02-01T14:30:00Z'
  }
];

export const INITIAL_PRODUCTS: Product[] = [
  // Products for MC Ferramentas & Distribuição (Imported from user's Supabase dataset)
  ...MC_CATALOG_PRODUCTS,

  // Products for Vogue & Estilo (Demo multi-tenant tenant)
  {
    id: 'prod-vogue-1',
    tenantId: 'tenant-moda-estilo',
    name: 'Vestido Midi Canelado Elegance com Fenda Lateral',
    sku: 'VOG-VES-001',
    category: 'Vestidos',
    brand: 'Vogue & Estilo',
    description: 'Vestido tecido canelado premium com elastano de alta densidade. Não marca e modela o corpo com sofisticação.',
    costPrice: 45.00,
    price: 139.90,
    promotionalPrice: 119.90,
    wholesalePrice: 69.90,
    wholesaleTiers: [
      { minQuantity: 6, price: 62.00, discountPercentage: 11 }
    ],
    minOrderQuantity: 1,
    stock: 35,
    unit: 'un',
    images: [
      'https://images.unsplash.com/photo-1539109136881-3be0616acf4b?w=600&auto=format&fit=crop&q=80'
    ],
    featured: true,
    isNew: true,
    active: true,
    tags: ['Lançamento', 'Tendência']
  }
];

export const INITIAL_ORDERS: Order[] = [
  {
    id: 'order-mc-101',
    orderNumber: 'PED-2025-0841',
    tenantId: 'tenant-mc-distribuicao',
    sellerId: 'user-mc-vendedor-1',
    sellerCode: 'CARLOS10',
    customer: {
      name: 'Marmoraria e Granitos Arte Real Ltda',
      document: '23.888.999/0001-44',
      email: 'compras@artereal.com.br',
      phone: '11981112233',
      companyName: 'Arte Real Marmoraria',
      type: 'PJ'
    },
    shippingAddress: {
      street: 'Av. dos Estados',
      number: '3400',
      complement: 'Galpão B',
      neighborhood: 'Tamanduateí',
      city: 'Santo André',
      state: 'SP',
      zipCode: '09220-570'
    },
    items: [
      {
        productId: 'prod-mc-fl004',
        productName: 'Flap Diamantado 115mm Grão 200 Linha Prata',
        productSku: 'FL004',
        productImage: 'https://oysznehftuovxchrfmfx.supabase.co/storage/v1/object/public/product-images/seed/disco-flap.jpg',
        unitPrice: 56.50,
        quantity: 10,
        unit: 'un',
        totalPrice: 565.00
      },
      {
        productId: 'prod-mc-sr001',
        productName: 'Serra Mármore Turbo 110mm Furo 20mm Master',
        productSku: 'SR001',
        productImage: 'https://oysznehftuovxchrfmfx.supabase.co/storage/v1/object/public/product-images/seed/serra-ouro-silenciosa-350mm.jpg',
        unitPrice: 28.90,
        quantity: 20,
        unit: 'un',
        totalPrice: 578.00
      },
      {
        productId: 'prod-mc-cu010',
        productName: 'Cuba Inox Retangular Embutir Nº 01 Polida (47x30cm)',
        productSku: 'CU010',
        productImage: 'https://oysznehftuovxchrfmfx.supabase.co/storage/v1/object/public/product-images/seed/cuba-gourmet-5040.jpg',
        unitPrice: 112.00,
        quantity: 4,
        unit: 'un',
        totalPrice: 448.00
      }
    ],
    subtotal: 1591.00,
    discount: 0.00,
    shippingFee: 0.00, // Frete grátis por valor acima de R$ 1.000,00
    total: 1591.00,
    status: 'approved',
    paymentMethod: 'pix',
    notes: 'Entregar na marmoraria no período da manhã.',
    createdAt: '2025-02-28T09:15:00Z',
    updatedAt: '2025-02-28T09:30:00Z',
    source: 'sales_rep'
  },
  {
    id: 'order-mc-102',
    orderNumber: 'PED-2025-0842',
    tenantId: 'tenant-mc-distribuicao',
    customer: {
      name: 'Construtora e Engenharia Alpha SP',
      document: '45.111.222/0001-33',
      email: 'suprimentos@alphasp.com.br',
      phone: '11972223344',
      companyName: 'Alpha SP Engenharia',
      type: 'PJ'
    },
    shippingAddress: {
      street: 'Rua Domingos de Morais',
      number: '450',
      neighborhood: 'Vila Mariana',
      city: 'São Paulo',
      state: 'SP',
      zipCode: '04010-000'
    },
    items: [
      {
        productId: 'prod-mc-ds013',
        productName: 'Disco Diamantado Segmentado 350mm P/ Granito e Concreto',
        productSku: 'DS013',
        productImage: 'https://oysznehftuovxchrfmfx.supabase.co/storage/v1/object/public/product-images/seed/disco-segmentado-ouro.jpg',
        unitPrice: 185.00,
        quantity: 5,
        unit: 'un',
        totalPrice: 925.00
      }
    ],
    subtotal: 925.00,
    discount: 0.00,
    shippingFee: 35.00,
    total: 960.00,
    status: 'pending',
    paymentMethod: 'boleto',
    notes: 'Boleto faturado para 30 dias após conferência do material.',
    createdAt: '2025-03-01T14:20:00Z',
    updatedAt: '2025-03-01T14:20:00Z',
    source: 'web_checkout'
  }
];
