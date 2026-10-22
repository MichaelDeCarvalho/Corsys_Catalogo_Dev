# ADR 005: Cloudflare Workers Static Assets Frontend Deployment

## Status
**Aprovado / Validado em Runtime** (2026-09-28)

---

## 1. Contexto
O frontend do **Corsys.Catálogo** é uma Single Page Application (SPA) desenvolvida em **React 19** e compilada com **Vite 6** usando **Bun** como runtime e gerenciador de pacotes.

Todo o backend transacional, autenticação, catálogo, isolamento multi-tenant (RLS), armazenamento de mídias e lógica transacional de checkout residem no **Supabase** (PostgreSQL, Supabase Storage e Edge Functions em Deno).

Com a conclusão do hardening do frontend de Orders V1, era necessário definir a arquitetura e a esteira de deploy do frontend de forma moderna, performática e com isolamento estrito de responsabilidades.

---

## 2. Decisão Arquitetural
1. **Frontend Hosting no Cloudflare Workers Static Assets:**
   - O repositório no **GitHub** (`main`) alimenta o **Cloudflare Workers Builds**.
   - Comando de build: `bun run build` (output em `dist/`).
   - Comando de deploy: `npx wrangler deploy` (Wrangler configurado via `wrangler.jsonc` com Static Assets).
   - Variável de ambiente do build Cloudflare: `BUN_VERSION=1.4.2`.
   - `wrangler.jsonc` mantém explicitamente:
     - `workers_dev: true` (endpoint de validação ativo).
     - `preview_urls: false` (sem exposição desnecessária de URLs de preview).
     - `assets.directory: "./dist"`.

2. **Zero Backend no Cloudflare:**
   - Nenhum Worker server-side, binding, D1, KV, R2, Queue ou Durable Object foi introduzido no Cloudflare.
   - O Cloudflare atua estritamente como camada de distribuição de ativos estáticos de alta performance (Edge CDN).

3. **Manutenção Integral do Backend no Supabase:**
   - **Autenticação:** Supabase Auth.
   - **Banco de Dados & RLS:** Supabase PostgreSQL com RLS forçado por tenant.
   - **Storage:** Buckets `tenant-assets` e `product-media`.
   - **Edge Functions:** `submit-order-checkout`, `manage-wholesale-customer`, `submit-wholesale-application`.

---

## 3. Justificativas
- **Desacoplamento e Não Duplicação:** Evita duplicação de regras de negócio ou camadas intermediárias de backend, preservando o Supabase como a única fonte da verdade e autoridade transacional.
- **Performance na Edge:** Entrega de assets estáticos (HTML, JS, CSS, fontes) com latência mínima e cache global via infraestrutura Cloudflare.
- **Deploy Reproduzível:** Processo de build determinístico via Bun e Vite integrado ao fluxo Git.
- **Segurança de Ativos Públicos:** Expurgamento de documentações internas e arquivos binários do diretório `public/`, garantindo que apenas assets estritamente necessários ao funcionamento da UI sejam incluídos no bundle final (`dist/`).

---

## 4. Fronteiras de Segurança & Variáveis de Ambiente
- **Variáveis Públicas do Frontend (Vite):**
  - `VITE_SUPABASE_URL`: Endpoint da API pública do Supabase.
  - `VITE_SUPABASE_PUBLISHABLE_KEY`: Chave anônima pública com autorização restrita por RLS.
  - `VITE_PUBLIC_TENANT_SLUG`: Slug canônico do tenant exibido no storefront (`corsys-catalogo-demo`).
  - *Essas variáveis são públicas por definição e embutidas no bundle client-side no momento do build.*

- **Segredos e Credenciais:**
  - `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_SECRET_KEYS`, tokens administrativos ou chaves de provedores NUNCA entram no Cloudflare nem no repositório Git.
  - O arquivo `.gitignore` bloqueia estritamente `.wrangler/`, `.dev.vars`, `.dev.vars.*`, `.env*` (exceto `.env.example`) e `dist/`.

- **Feature Gate de Checkout:**
  - `CHECKOUT_ENABLED` pertence **exclusivamente** ao ambiente server-side da Edge Function `submit-order-checkout` no Supabase.
  - O Feature Gate permanece desligado (`CHECKOUT_ENABLED !== "true"`), retornando HTTP 503 fail-closed em todas as tentativas públicas até a ativação controlada.

---

## 5. Validação em Runtime
- **Deploy Cloudflare Workers Static Assets:** PASS (`https://corsys-catalogo.corsys1.workers.dev`).
- **Storefront & Conexão Supabase:** PASS (Catálogo público carregado, imagens de produto exibidas e navegação responsiva).
- **Checkout Fail-Closed:** PASS (Tentativa de submissão retornou HTTP 503 com mensagem amigável no CartDrawer, sem perda de estado).
- **Integridade da Base:** `public.orders` permaneceu com exatamente 0 registros antes e depois dos testes de deploy.
- **Domínio Customizado:** Ainda não configurado (será implementado na fase de ativação e go-live).
