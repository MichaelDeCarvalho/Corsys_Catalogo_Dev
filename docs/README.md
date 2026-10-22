# 📦 OmniCatálogo SaaS & MC Distribuição - Documentação Oficial do Sistema

Bem-vindo à documentação técnica e operacional completa do **OmniCatálogo SaaS**, a plataforma B2B de catálogos digitais com pedido express via WhatsApp, gestão multitenant isolada via Supabase, integração de e-mails transacionais com Resend e infraestrutura moderna para alta performance.

---

## 📑 Sumário da Documentação

Esta documentação foi estruturada para desenvolvedores, arquitetos de software, administradores de infraestrutura e gestores comerciais:

1. **[01. Arquitetura & Engenharia de Software](./01_ARQUITETURA_E_ENGENHARIA.md)**
   - Visão geral da solução
   - Pilares de tecnologia (React 19, TypeScript, Tailwind CSS, Vite, Supabase PostgreSQL, Resend)
   - Princípios de Isolamento Multitenant (Single Database com RLS)
   - Padrão de Roteamento de Subdomínios e Custom Domains
   - Fluxo de dados e segurança da informação

2. **[02. Banco de Dados & RLS Supabase](./02_BANCO_DE_DADOS_E_RLS_SUPABASE.md)**
   - DDL completo das tabelas (`platform_admins`, `tenants`, `tenant_public_settings`, `tenant_users`, `products`, `wholesale_tiers`, `orders`)
   - View pública segura `catalog_products` (`WITH (security_invoker = true)`) e proteção rigorosa de `cost_price`
   - Regras de Row Level Security (RLS) e matriz de Grants explícitos por perfil (`anon`, `authenticated`)
   - Helper privado `private.is_tenant_active()` com `SECURITY DEFINER` e `SET search_path = ''`
   - Integridade composta `(tenant_id, seller_id)` em `orders`
   - Bloqueio de escrita direta via browser em `orders`, `tenant_users` e `tenants`

3. **[03. Catálogo Técnico de Produtos MC Distribuição](./03_CATALOGO_PRODUTOS_MC.md)**
   - Especificação dos 92 produtos cadastrados
   - Categorias: Brocas HSS, Brocas Vídea, SDS Plus, Madeira, Mourão, Porcelanato, Discos Flap Zircônio, Discos Diamantados Turbo e Segmentados, Rebolos Cônicos e Retos, Lixas 5 Passos e Híbridas, Cubas e Tanques Inox, Ferramentas Manuais e EPIs
   - Tabela de SKUs, especificações de polegadas/milímetros, precificação e regras de atacado

4. **[04. Manual de Operações do Administrador](./04_MANUAL_DO_ADMINISTRADOR.md)**
   - Guia de uso do Painel da Loja (Tenant Admin)
   - Cadastro e edição de produtos com upload de fotos (auto-enquadramento e compressão)
   - Definição de tabela progressiva de atacado (tabela de descontos por volume)
   - Fluxo operacional de pedidos (Pendente -> Aprovado -> Em Separação -> Despachado -> Entregue)
   - Gestão de Representantes/Vendedores (links exclusivos, rastreamento e cálculo de comissões)
   - Configurações da Loja (cores, banner, logotipo e políticas de frete)

5. **[05. Guia de Implantação e Deploy em Produção](./05_GUIA_DE_IMPLANTACAO_E_DEPLOY.md)**
   - Deploy no Netlify com `netlify.toml` e wildcard DNS
   - Deploy em Cloud Run / Docker / Vercel
   - Configuração de Storage Buckets no Supabase com CDN e políticas públicas
   - Checklist de variáveis de ambiente (`.env.example`) e certificados SSL

6. **[06. Integrações Externas (WhatsApp & Resend API)](./06_INTEGRACOES_WHATSAPP_E_RESEND.md)**
   - Algoritmo de geração de mensagem estruturada para o WhatsApp (carrinho B2B formatado)
   - Integração com Resend para envio de recibos de compra e notificações para o lojista
   - Tratamento de webhooks e templates HTML responsivos

7. **[07. Modelo Comercial SaaS & Projeção de Faturamento](./07_MODELO_DE_NEGOCIO_E_ROI_SAAS.md)**
   - Planos de Assinatura (Starter, Pro, Enterprise)
   - Estrutura de Custos de Infraestrutura vs. Lucratividade
   - Projeções de MRR (Receita Recorrente Mensal) e ARR
   - Roteiro de expansão e estratégias de aquisição de novos lojistas e distribuidores

8. **[08. Matriz de Testes e Validação de RLS](./08_RLS_TEST_MATRIX.md)**
   - Especificação formal de validação de políticas Row Level Security (RLS) e integridade
   - Cenários para Usuário Anônimo (Anon)
   - Cenários para Tenant Admin (Admin Loja A)
   - Cenários para Stock Manager (Estoquista Loja A)
   - Cenários para Sales Rep (Vendedor Loja A - autorização estrita por `seller_id = (SELECT auth.uid())`)
   - Cenários de isolamento Cross-Tenant e integridade referencial de banco
   - Script SQL automatizado de testes: `supabase/tests/01_rls_security_test.sql`

9. **[09. Gestão de Produtos, Integridade de Imagens & Storage](./09_GESTAO_DE_PRODUTOS_E_IMAGENS.md)**
   - Fonte canônica dos dados e proibição estrita de fotos genéricas, fake ou de IA
   - Fluxos de cadastro, edição e importação em lote por associação de SKU
   - Arquitetura do Supabase Storage V2, nomenclatura de arquivos e validações MIME/tamanho
   - Políticas de RLS para leitura pública e escrita restrita a administradores do tenant
   - Inventário técnico completo dos 92 produtos com referências originais V1 preservadas

10. **[ADR 001. Arquitetura de Multi-Tenancy, Isolamento RLS e Autorização](./adr/ADR_001_MULTI_TENANCY_RLS_AUTHORIZATION.md)**
    - Registro formal de decisões de engenharia (ADR)
    - Multi-tenancy canônico por `tenant_id`
    - RLS Deny-by-default com Least Privilege
    - Platform Admins isolados
    - Escrita em pedidos e gestão de equipe restritos a backend server-side
    - Allowlist estrita de atualização de configurações públicas e proteção de segredo industrial

---

## ⚡ Status da Integração com Supabase (Etapa 3.2.1 - Hardened Pré-Run)

> **⚠️ AVISO OPERACIONAL:**
> - **Estado da Migration:** **Migration pronta e blindada (v2.3), aguardando primeiro run no Supabase V2.**
> - **Definição de RLS e Hardening:** O RLS, grants e constraints estão formalmente definidos no arquivo de migration versionada (`supabase/migrations/20260902_000001_initial_schema.sql`), com suíte de testes executável em `supabase/tests/01_rls_security_test.sql`.
> - **Concessões Cirúrgicas:** `deleted_at` concedido a `anon` para avaliação segura de WHERE; `cost_price` estritamente confidencial; concessões explícitas completas para `service_role`.
> - **Read-Only no Browser para `orders`:** Todas as operações de `orders` via cliente direto estão restritas a `SELECT`. Inserções e atualizações financeiras serão implementadas via RPC/Edge Function server-side.
> - **Read-Only no Browser para `tenant_users`:** Membros e atribuições de cargo são somente leitura via browser. Convites e gestão de roles serão executados via RPC segura.
> - **Proteção de `plan`, `status` e `slug`:** Dados contratuais em `public.tenants` são gerenciados exclusivamente server-side. `tenants.slug` é a fonte canônica com replicação unidirecional via triggers (`sync_tenant_slug` e `enforce_tenant_public_settings_slug`) para `tenant_public_settings.slug`.
> - **Column-Level Security:** Atualizações em `tenant_public_settings` são restritas por grant em nível de coluna (`public_name, whatsapp_number, logo_url, banner_url, primary_color, accent_color, min_order_value, allow_b2b_mode, hide_prices_without_login, delivery_methods`), bloqueando `tenant_id` e `slug`.
> - **Integridade Referencial Composta:** A FK `fk_orders_tenant_seller` utiliza `ON DELETE SET NULL (seller_id)` preservando `tenant_id NOT NULL`.
> - **Operações de Estoque:** Atualizações granulares de estoque por `stock_manager` serão implementadas em etapa posterior via RPC/função dedicada.
> - **Checkout Server-Side:** A criação pública de pedidos será desenvolvida via backend server-side seguro com validação e recálculo de preços e frete.
> - **Supabase Storage:** A criação do bucket de imagens e policies de upload continua pendente para etapa posterior.
> - **Execução em Runtime:** A aplicação frontend continua operando temporariamente via `localStorage` e dados canônicos locais até a etapa de migração de runtime.

---

## 🚀 Como Executar o Projeto Localmente

```bash
# 1. Instalar as dependências do projeto
npm install

# 2. Iniciar o servidor de desenvolvimento
npm run dev

# 3. Validar tipagem TypeScript
npm run lint

# 4. Gerar build de produção
npm run build
```

O dev server rodará em `http://localhost:3000`.

## Governança de Engenharia / ECC

- **[Adoção seletiva do ECC](./engineering/ecc-adoption.md)** — recursos adotados, adiados, excluídos, ativação e reversão.
- **[Release Checklist](./RELEASE_CHECKLIST.md)** — verificação antes de merge/release.
- **[ADR 008 — ECC Engineering Governance](./adr/ADR_008_ECC_ENGINEERING_GOVERNANCE.md)** — decisão de adoção seletiva e CI de qualidade.
- **[Session Handoff](./SESSION_HANDOFF.md)** — estado operacional mais recente e próxima ação.
