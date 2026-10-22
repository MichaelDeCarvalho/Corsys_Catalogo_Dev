# 🏛️ 01. Arquitetura & Engenharia de Software

## 1. Visão Geral do Sistema

O **OmniCatálogo SaaS** foi concebido para resolver uma dor crítica de distribuidores, indústrias e atacadistas: a dependência de planilhas desatualizadas e catálogos em PDF estáticos que dificultam as vendas e geram atritos no atendimento pelo WhatsApp.

A plataforma opera sob o modelo **Software as a Service (SaaS) Whitelabel Multitenant**, permitindo que uma única instância de software atenda simultaneamente centenas de empresas com total isolamento de dados, identidades visuais personalizadas e gestão de equipes de vendas.

---

## 2. Stack Tecnológica

| Camada | Tecnologia | Justificativa Técnica |
| :--- | :--- | :--- |
| **Frontend Core** | React 19 + TypeScript | Reatividade de ponta, concorrência otimizada, tipagem estrita com contratos previsíveis em tempo de compilação. |
| **Build & Dev Server** | Vite 6 | Inicialização instantânea, empacotamento Rollup ultrarrápido para produção e compatibilidade com ES Modules modernos. |
| **Estilização** | Tailwind CSS v4 | Zero overhead de runtime, utilitários CSS de baixo consumo de memória e sistema de design tokens padronizado. |
| **Animações** | Motion (`motion/react`) | Transições fluidas com aceleração por hardware, suporte a micro-interações táteis no catálogo mobile. |
| **Ícones** | Lucide React | Biblioteca leve, padronizada e modular com ícones vetoriais modernos. |
| **Banco de Dados** | PostgreSQL via Supabase | Banco relacional robusto com suporte a JSONB, Row Level Security (RLS) nativo e replicação em tempo real. |
| **Autenticação** | Supabase Auth (JWT) | Autenticação stateless baseada em tokens com claims de permissão e tenant vinculados no payload. |
| **Armazenamento** | Supabase Storage | Buckets S3-compatíveis para fotos de produtos com redimensionamento e CDN global. |
| **Mensageria Transacional** | Resend API | API moderna de envio de e-mails com 99.8% de taxa de entrega, DKIM e SPF automatizados. |
| **Hospedagem / CDN** | Netlify / Google Cloud Run | Roteamento dinâmico de subdomínios, borda CDN com baixa latência e certificados SSL gratuitos. |

---

## 3. Padrão Multitenant: Banco Único com Isolamento RLS

Em vez de criar uma base de dados separada para cada cliente (estratégia que encarece a infraestrutura e dificulta as atualizações de schema), o OmniCatálogo adota a arquitetura **Shared Database, Isolated Schemas via Row Level Security (RLS)**:

```
                          ┌────────────────────────┐
                          │  Requisição do Cliente │
                          └───────────┬────────────┘
                                      │
                         [JWT Token com tenant_id]
                                      ▼
                        ┌───────────────────────────┐
                        │   Supabase Postgres RLS   │
                        └─────────────┬─────────────┘
                                      │
            ┌─────────────────────────┴─────────────────────────┐
            ▼                                                   ▼
┌───────────────────────┐                           ┌───────────────────────┐
│ Tenant: MC Distribuição│                          │ Tenant: Outro Lojista │
│ tenant_id = 'mc-dist' │                           │ tenant_id = 'outro'   │
└───────────────────────┘                           └───────────────────────┘
```

### Benefícios deste Padrão:
1. **Custo Marginal Próximo de Zero**: Adicionar 100 novos lojistas não exige provisionar novos servidores ou bancos.
2. **Atualização Centralizada**: Qualquer novo recurso ou migração de banco é executado uma única vez e beneficia todas as lojas.
3. **Segurança de Nível Bancário**: O isolamento é aplicado diretamente no kernel do banco PostgreSQL via políticas RLS. Mesmo se um atacante adulterar a aplicação web, o banco recusará consultas cruzadas entre tenants.

---

## 4. Roteamento e Resolução de Domínios

O sistema suporta três formatos de acesso aos catálogos:

1. **Subdomínio Dinâmico:** `https://mcdistribuicao.omnicatalogo.com.br`
2. **Path Baseado em Slug:** `https://omnicatalogo.com.br/mc-distribuicao`
3. **Domínio Personalizado (Whitelabel):** `https://catalogo.mcdistribuicao.com.br`

### Algoritmo de Resolução de Tenant (Client-Side & Edge):

```typescript
export function resolveTenant(hostname: string, pathname: string, tenants: Tenant[]): Tenant {
  // 1. Busca por Domínio Customizado
  const customMatch = tenants.find(t => t.customization.customDomain === hostname);
  if (customMatch) return customMatch;

  // 2. Busca por Subdomínio (ex: mc-distribuicao.app.com)
  const parts = hostname.split('.');
  if (parts.length > 2 && parts[0] !== 'www' && parts[0] !== 'app') {
    const subMatch = tenants.find(t => t.slug === parts[0]);
    if (subMatch) return subMatch;
  }

  // 3. Busca por Slug na URL (ex: /mc-distribuicao)
  const pathSlug = pathname.split('/')[1];
  const slugMatch = tenants.find(t => t.slug === pathSlug);
  if (slugMatch) return slugMatch;

  // Fallback seguro: Tenant padrão (MC Distribuição)
  return tenants[0];
}
```

---

## 5. Controle de Acesso Baseado em Papéis (RBAC)

A plataforma possui quatro níveis hierárquicos de acesso:

| Nível de Acesso | Escopo | Funcionalidades Autorizadas |
| :--- | :--- | :--- |
| **SuperAdmin** | Global (SaaS Master) | Criar e suspender tenants, alterar planos e limites, monitorar faturamento global de assinaturas. |
| **Tenant Admin** | Empresa (Lojista) | Gerenciar mix de produtos, estoque, faixas de preço de atacado, pedidos, dados cadastrais, chave PIX e fretes. |
| **Sales Rep** | Vendedor / Representante | Acessar catálogo com código próprio de rastreamento, gerar links de pedidos com comissão vinculada, consultar seus próprios pedidos. |
| **Stock Manager** | Operacional / Estoque | Atualizar quantidade de produtos em estoque, alterar status de separação e despacho de pedidos. |

---

## 6. Estado da Aplicação & Persistência Local

O cliente web utiliza React Context (`AppContext.tsx`) com sincronização reativa:
- **LocalStorage Versionado (`omnicatalogo_saas_data_v3`)**: Garante que os dados de demonstração ou customizações feitas pelo lojista persistam mesmo após recarregar o navegador.
- **Cache Otimista**: Alterações de status de pedidos e estoque são aplicadas imediatamente na interface e sincronizadas em background, proporcionando sensação instantânea de velocidade.
- **Botão de Restauração Demo**: Permite restaurar o catálogo oficial de 92 produtos técnicos da MC Distribuição a qualquer momento com um clique.
