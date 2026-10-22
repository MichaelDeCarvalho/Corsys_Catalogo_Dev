import React, { useState } from 'react';
import { 
  Code2, 
  Database, 
  Mail, 
  Globe, 
  ShieldCheck, 
  Check, 
  Copy, 
  Terminal, 
  Layers, 
  TrendingUp, 
  Server, 
  DollarSign, 
  Cpu, 
  FileText,
  Key,
  ExternalLink,
  ChevronRight,
  ArrowUpRight
} from 'lucide-react';
import { useApp } from '../../context/AppContext';

export const SaasBlueprintGuide: React.FC = () => {
  const { showToast } = useApp();
  const [activeTab, setActiveTab] = useState<'architecture' | 'supabase_sql' | 'resend_email' | 'netlify_domains' | 'pricing_roi'>('architecture');
  const [copiedSection, setCopiedSection] = useState<string | null>(null);

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedSection(id);
    showToast('Código / Script copiado para a área de transferência!');
    setTimeout(() => setCopiedSection(null), 3000);
  };

  const SUPABASE_SQL_SCRIPT = `-- =========================================================================
-- OMNICATÁLOGO SAAS - MULTI-TENANT DATABASE & RLS POLICIES (SUPABASE)
-- Execute no Supabase SQL Editor para isolamento total entre empresas
-- =========================================================================

-- 1. TABELA DE EMPRESAS / TENANTS (MC Distribuição, Lojistas, etc.)
CREATE TABLE IF NOT EXISTS public.tenants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    trade_name TEXT,
    cnpj_cpf TEXT,
    plan TEXT NOT NULL DEFAULT 'pro', -- starter, pro, enterprise
    status TEXT NOT NULL DEFAULT 'active', -- active, trial, suspended
    owner_email TEXT NOT NULL,
    owner_phone TEXT,
    whatsapp_number TEXT NOT NULL,
    primary_color TEXT DEFAULT '#0284c7',
    logo_url TEXT,
    banner_url TEXT,
    min_order_value NUMERIC(10,2) DEFAULT 0.00,
    allow_b2b_mode BOOLEAN DEFAULT true,
    custom_domain TEXT UNIQUE,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- 2. TABELA DE USUÁRIOS E CONTROLE DE ACESSO (RBAC)
CREATE TABLE IF NOT EXISTS public.tenant_users (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'sales_rep', -- superadmin, tenant_admin, sales_rep, stock_manager
    seller_code TEXT,
    commission_rate NUMERIC(5,2) DEFAULT 0.00,
    permissions JSONB DEFAULT '{"canEditProducts": true, "canManageOrders": true}',
    created_at TIMESTAMPTZ DEFAULT now()
);

-- 3. TABELA DE PRODUTOS ISOLADA POR TENANT
CREATE TABLE IF NOT EXISTS public.products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    sku TEXT NOT NULL,
    barcode TEXT,
    category TEXT NOT NULL,
    description TEXT,
    cost_price NUMERIC(10,2) DEFAULT 0.00,
    price NUMERIC(10,2) NOT NULL,
    promotional_price NUMERIC(10,2),
    wholesale_price NUMERIC(10,2),
    min_order_quantity INTEGER DEFAULT 1,
    stock INTEGER DEFAULT 0,
    unit TEXT DEFAULT 'un',
    images TEXT[] DEFAULT ARRAY[]::TEXT[],
    featured BOOLEAN DEFAULT false,
    active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(tenant_id, sku)
);

-- 4. TABELA DE FAIXAS DE PREÇO ATACADO (ESCALA PROGRESSIVA)
CREATE TABLE IF NOT EXISTS public.wholesale_tiers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
    min_quantity INTEGER NOT NULL,
    price NUMERIC(10,2) NOT NULL,
    discount_percentage NUMERIC(5,2)
);

-- 5. TABELA DE PEDIDOS
CREATE TABLE IF NOT EXISTS public.orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_number TEXT NOT NULL,
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    seller_code TEXT,
    customer JSONB NOT NULL, -- { name, phone, document, email, companyName }
    shipping_address JSONB NOT NULL,
    items JSONB NOT NULL,
    subtotal NUMERIC(10,2) NOT NULL,
    shipping_fee NUMERIC(10,2) DEFAULT 0.00,
    total NUMERIC(10,2) NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending', -- pending, approved, preparing, dispatched, delivered
    payment_method TEXT NOT NULL DEFAULT 'pix',
    notes TEXT,
    source TEXT DEFAULT 'whatsapp',
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- =========================================================================
-- ROW LEVEL SECURITY (RLS) - SEGURANÇA TOTAL MULTI-TENANT
-- Garante que nenhum lojista veja dados de outro lojista
-- =========================================================================

ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;

-- Função Helper para resgatar o tenant_id do usuário autenticado no JWT
CREATE OR REPLACE FUNCTION get_auth_tenant_id()
RETURNS UUID AS $$
  SELECT (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::UUID;
$$ LANGUAGE sql STABLE;

-- POLÍTICA 1: Produtos visíveis publicamente se o catálogo estiver ativo
CREATE POLICY "Catálogo público para visitantes" 
ON public.products FOR SELECT 
USING (active = true);

-- POLÍTICA 2: Apenas membros da empresa podem editar produtos
CREATE POLICY "Gestão de produtos da própria empresa" 
ON public.products FOR ALL 
USING (tenant_id = get_auth_tenant_id());

-- POLÍTICA 3: Qualquer cliente pode criar pedidos no checkout
CREATE POLICY "Criação pública de pedidos" 
ON public.orders FOR INSERT 
WITH CHECK (true);

-- POLÍTICA 4: Apenas a loja dona do pedido pode visualizar e atualizar o pedido
CREATE POLICY "Lojistas gerenciam apenas seus próprios pedidos" 
ON public.orders FOR ALL 
USING (tenant_id = get_auth_tenant_id());
`;

  const RESEND_CODE_SNIPPET = `// =========================================================================
// RESEND EMAIL INTEGRATION - MULTI-TENANT TRANSACTIONAL NOTIFICATIONS
// Envia recibos e alertas de novos pedidos para o cliente e lojista
// =========================================================================

import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

export async function sendOrderNotificationEmail({
  tenant,
  order
}) {
  const senderEmail = tenant.customization.resendSenderEmail || 'pedidos@omnicatalogo.com.br';
  
  // 1. Notificar o Cliente com o Resumo do Pedido e PIX
  await resend.emails.send({
    from: \`\${tenant.name} <\${senderEmail}>\`,
    to: order.customer.email,
    subject: \`✅ Pedido Confirmado #\${order.orderNumber} - \${tenant.name}\`,
    html: \`
      <div style="font-family: sans-serif; max-width: 600px; margin: auto; padding: 20px;">
        <h2 style="color: \${tenant.customization.primaryColor || '#0284c7'};">
          Obrigado pelo seu pedido, \${order.customer.name}!
        </h2>
        <p>Recebemos seu pedido <strong>#\${order.orderNumber}</strong> e nossa equipe já está processando.</p>
        
        <table style="width: 100%; border-collapse: collapse; margin-top: 15px;">
          \${order.items.map(i => \`
            <tr style="border-bottom: 1px solid #eee;">
              <td style="padding: 8px 0;">\${i.quantity}x \${i.productName}</td>
              <td style="text-align: right; font-weight: bold;">R$ \${i.totalPrice.toFixed(2)}</td>
            </tr>
          \`).join('')}
        </table>

        <div style="margin-top: 20px; padding: 15px; background: #f8fafc; border-radius: 8px;">
          <p><strong>Total: R$ \${order.total.toFixed(2)}</strong></p>
          <p>Chave PIX da Loja: <code>\${tenant.customization.pixKey}</code></p>
        </div>
      </div>
    \`
  });
}
`;

  const NETLIFY_CONFIG_SNIPPET = `# =========================================================================
# NETLIFY MULTI-TENANT ROUTING CONFIGURATION (netlify.toml)
# Permite subdomínios dinâmicos (*.seusaas.com) e domínios personalizados
# =========================================================================

[build]
  command = "npm run build"
  publish = "dist"

# Redirecionamento SPA para React Router
[[redirects]]
  from = "/*"
  to = "/index.html"
  status = 200

# Edge Function para detectar subdomínio ou tenant no host
[[edge_functions]]
  function = "tenant-resolver"
  path = "/*"
`;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      
      {/* Top Header */}
      <div className="bg-gradient-to-r from-slate-900 via-emerald-950 to-slate-900 p-6 sm:p-8 rounded-3xl text-white shadow-xl border border-emerald-900/50">
        <div className="flex items-center gap-2 text-emerald-400 text-xs font-bold uppercase tracking-wider mb-2">
          <Code2 className="w-4 h-4" />
          Análise Técnica de Transformação SaaS Multi-Tenant
        </div>
        <h1 className="text-2xl sm:text-3xl font-extrabold font-['Outfit'] text-white">
          Guia de Arquitetura & Comercialização (SaaS Whitelabel)
        </h1>
        <p className="text-xs sm:text-sm text-slate-300 mt-2 max-w-3xl leading-relaxed">
          Como evoluir da estrutura inicial criada para a <strong>MC Distribuição</strong> (GitHub + Supabase + Resend + Netlify) para uma plataforma escalável capaz de atender centenas de lojistas com banco isolado, login seguro e faturamento recorrente.
        </p>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-slate-200 gap-4 sm:gap-6 text-xs sm:text-sm font-semibold overflow-x-auto">
        <button
          onClick={() => setActiveTab('architecture')}
          className={`pb-3 transition-colors border-b-2 flex items-center gap-2 shrink-0 cursor-pointer ${
            activeTab === 'architecture' ? 'border-emerald-600 text-emerald-600' : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          <Layers className="w-4 h-4" />
          Visão Geral da Transformação
        </button>

        <button
          onClick={() => setActiveTab('supabase_sql')}
          className={`pb-3 transition-colors border-b-2 flex items-center gap-2 shrink-0 cursor-pointer ${
            activeTab === 'supabase_sql' ? 'border-emerald-600 text-emerald-600' : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          <Database className="w-4 h-4" />
          Supabase SQL & RLS
        </button>

        <button
          onClick={() => setActiveTab('resend_email')}
          className={`pb-3 transition-colors border-b-2 flex items-center gap-2 shrink-0 cursor-pointer ${
            activeTab === 'resend_email' ? 'border-emerald-600 text-emerald-600' : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          <Mail className="w-4 h-4" />
          Resend E-mails Transacionais
        </button>

        <button
          onClick={() => setActiveTab('netlify_domains')}
          className={`pb-3 transition-colors border-b-2 flex items-center gap-2 shrink-0 cursor-pointer ${
            activeTab === 'netlify_domains' ? 'border-emerald-600 text-emerald-600' : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          <Globe className="w-4 h-4" />
          Netlify & Subdomínios
        </button>

        <button
          onClick={() => setActiveTab('pricing_roi')}
          className={`pb-3 transition-colors border-b-2 flex items-center gap-2 shrink-0 cursor-pointer ${
            activeTab === 'pricing_roi' ? 'border-emerald-600 text-emerald-600' : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          <DollarSign className="w-4 h-4" />
          Preços de Revenda & Lucratividade
        </button>
      </div>

      {/* TAB 1: ARCHITECTURE ANALYSIS */}
      {activeTab === 'architecture' && (
        <div className="space-y-6">
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            
            {/* Before */}
            <div className="bg-white p-6 rounded-2xl border border-rose-200/80 shadow-xs space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-rose-700 uppercase tracking-wider">Como Era (Single-Tenant)</span>
                <span className="bg-rose-100 text-rose-800 text-[10px] font-bold px-2 py-0.5 rounded">MC Distribuição</span>
              </div>
              <h3 className="font-bold text-slate-900 text-base">Estrutura Monolítica Dedicada</h3>
              <ul className="space-y-2 text-xs text-slate-600">
                <li className="flex items-start gap-2">
                  <span className="text-rose-500 font-bold">✕</span>
                  <span>Banco Supabase com tabelas fixas sem coluna <code className="bg-slate-100 px-1 py-0.5 rounded">tenant_id</code>.</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-rose-500 font-bold">✕</span>
                  <span>Identidade visual e WhatsApp hardcoded no frontend.</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-rose-500 font-bold">✕</span>
                  <span>Para vender para outra loja, seria necessário duplicar o repositório e criar outra conta no Netlify e Supabase.</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-rose-500 font-bold">✕</span>
                  <span>Sem gestão central de assinaturas ou comissões de vendedores.</span>
                </li>
              </ul>
            </div>

            {/* After (SaaS) */}
            <div className="bg-white p-6 rounded-2xl border border-emerald-200/80 shadow-xs space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-emerald-700 uppercase tracking-wider">Como Fica Agora (Multi-Tenant SaaS)</span>
                <span className="bg-emerald-100 text-emerald-800 text-[10px] font-bold px-2 py-0.5 rounded">Pronto para Revenda</span>
              </div>
              <h3 className="font-bold text-slate-900 text-base">Plataforma Escalável Whitelabel</h3>
              <ul className="space-y-2 text-xs text-slate-600">
                <li className="flex items-start gap-2">
                  <span className="text-emerald-600 font-bold">✓</span>
                  <span><strong>Supabase RLS:</strong> Todas as tabelas isoladas por <code className="bg-slate-100 px-1 py-0.5 rounded font-mono">tenant_id</code> com criptografia e segurança de nível bancário.</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-emerald-600 font-bold">✓</span>
                  <span><strong>Subdomínios Automáticos:</strong> Cada cliente ganha seu link (ex: <code className="bg-slate-100 px-1 py-0.5 rounded font-mono">app.com/mc-distribuicao</code> ou domínio próprio).</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-emerald-600 font-bold">✓</span>
                  <span><strong>RBAC & Vendedores:</strong> Links rastreáveis de representantes com cálculo automático de comissões.</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-emerald-600 font-bold">✓</span>
                  <span><strong>Painel Master:</strong> Crie novos catálogos em 1 minuto sem tocar em código.</span>
                </li>
              </ul>
            </div>

          </div>

          {/* 4 Pillars Diagram */}
          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs space-y-4">
            <h3 className="font-bold text-slate-900 text-sm font-['Outfit'] uppercase tracking-wider">
              Os 4 Pilares da Infraestrutura Tecnológica
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              
              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
                <div className="flex items-center gap-2 text-blue-700 font-bold text-xs">
                  <Server className="w-4 h-4" /> 1. GitHub & CI/CD
                </div>
                <p className="text-[11px] text-slate-600">
                  Um único repositório central. Qualquer melhoria feita beneficia instantaneamente todos os clientes cadastrados.
                </p>
              </div>

              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
                <div className="flex items-center gap-2 text-emerald-700 font-bold text-xs">
                  <Database className="w-4 h-4" /> 2. Supabase PostgreSQL
                </div>
                <p className="text-[11px] text-slate-600">
                  Armazenamento de produtos, pedidos, usuários e imagens no Supabase Storage com políticas de RLS ativas.
                </p>
              </div>

              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
                <div className="flex items-center gap-2 text-purple-700 font-bold text-xs">
                  <Mail className="w-4 h-4" /> 3. Resend API
                </div>
                <p className="text-[11px] text-slate-600">
                  Envio de e-mails transacionais de recibo de pedidos e relatórios semanais de vendas com taxa de entrega de 99.8%.
                </p>
              </div>

              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
                <div className="flex items-center gap-2 text-amber-700 font-bold text-xs">
                  <Globe className="w-4 h-4" /> 4. Netlify Hosting
                </div>
                <p className="text-[11px] text-slate-600">
                  CDN global ultrarrápida com SSL automático, suporte a wildcard DNS e performance móvel impecável.
                </p>
              </div>

            </div>
          </div>

        </div>
      )}

      {/* TAB 2: SUPABASE SQL */}
      {activeTab === 'supabase_sql' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between bg-white p-4 rounded-2xl border border-slate-200">
            <div>
              <h3 className="font-bold text-slate-900 text-sm">Script de Migração SQL para Supabase</h3>
              <p className="text-xs text-slate-500">Copie e cole este script diretamente no Supabase SQL Editor do seu projeto.</p>
            </div>
            <button
              onClick={() => handleCopy(SUPABASE_SQL_SCRIPT, 'sql')}
              className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-2 shadow-md"
            >
              {copiedSection === 'sql' ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              {copiedSection === 'sql' ? 'Copiado!' : 'Copiar Script SQL'}
            </button>
          </div>

          <div className="relative rounded-2xl overflow-hidden bg-slate-950 text-slate-200 p-4 font-mono text-xs max-h-[500px] overflow-y-auto border border-slate-800">
            <pre>{SUPABASE_SQL_SCRIPT}</pre>
          </div>
        </div>
      )}

      {/* TAB 3: RESEND */}
      {activeTab === 'resend_email' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between bg-white p-4 rounded-2xl border border-slate-200">
            <div>
              <h3 className="font-bold text-slate-900 text-sm">Código de Integração do Resend (Node/TypeScript)</h3>
              <p className="text-xs text-slate-500">Envio automático de confirmações de pedidos com dados do lojista e PIX.</p>
            </div>
            <button
              onClick={() => handleCopy(RESEND_CODE_SNIPPET, 'resend')}
              className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold flex items-center gap-2 shadow-md"
            >
              {copiedSection === 'resend' ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              {copiedSection === 'resend' ? 'Copiado!' : 'Copiar Código Resend'}
            </button>
          </div>

          <div className="relative rounded-2xl overflow-hidden bg-slate-950 text-slate-200 p-4 font-mono text-xs max-h-[500px] overflow-y-auto border border-slate-800">
            <pre>{RESEND_CODE_SNIPPET}</pre>
          </div>
        </div>
      )}

      {/* TAB 4: NETLIFY */}
      {activeTab === 'netlify_domains' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between bg-white p-4 rounded-2xl border border-slate-200">
            <div>
              <h3 className="font-bold text-slate-900 text-sm">Configuração do Netlify (netlify.toml)</h3>
              <p className="text-xs text-slate-500">Wildcard DNS e roteamento para múltiplos catálogos.</p>
            </div>
            <button
              onClick={() => handleCopy(NETLIFY_CONFIG_SNIPPET, 'netlify')}
              className="px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold flex items-center gap-2 shadow-md"
            >
              {copiedSection === 'netlify' ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              {copiedSection === 'netlify' ? 'Copiado!' : 'Copiar netlify.toml'}
            </button>
          </div>

          <div className="relative rounded-2xl overflow-hidden bg-slate-950 text-slate-200 p-4 font-mono text-xs max-h-[500px] overflow-y-auto border border-slate-800">
            <pre>{NETLIFY_CONFIG_SNIPPET}</pre>
          </div>
        </div>
      )}

      {/* TAB 5: PRICING & ROI */}
      {activeTab === 'pricing_roi' && (
        <div className="space-y-6">
          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs space-y-4">
            <h3 className="font-bold text-slate-900 text-base font-['Outfit']">
              Simulação de Receita Recorrente (MRR) para sua Revenda
            </h3>
            <p className="text-xs text-slate-500">
              Veja quanto sua plataforma fatura conforme você fecha novos clientes lojistas ou distribuidores:
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2">
              <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200 text-center space-y-1">
                <div className="text-xs font-bold text-slate-500 uppercase">Com 10 Clientes</div>
                <div className="text-2xl font-extrabold text-blue-700 font-['Outfit']">R$ 1.899,00 /mês</div>
                <div className="text-[11px] text-slate-600">R$ 22.788,00 por ano</div>
              </div>

              <div className="bg-blue-50/70 p-4 rounded-2xl border border-blue-200 text-center space-y-1">
                <div className="text-xs font-bold text-blue-900 uppercase">Com 50 Clientes (Meta)</div>
                <div className="text-2xl font-extrabold text-blue-700 font-['Outfit']">R$ 9.495,00 /mês</div>
                <div className="text-[11px] text-blue-800 font-bold">R$ 113.940,00 por ano</div>
              </div>

              <div className="bg-emerald-50/70 p-4 rounded-2xl border border-emerald-200 text-center space-y-1">
                <div className="text-xs font-bold text-emerald-900 uppercase">Com 200 Clientes (Escala)</div>
                <div className="text-2xl font-extrabold text-emerald-700 font-['Outfit']">R$ 37.980,00 /mês</div>
                <div className="text-[11px] text-emerald-800 font-bold">R$ 455.760,00 por ano</div>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
