# SECURITY REGISTER - PRIVACIDADE E RLS

## 1. Tratamento de Dados Financeiros e de Custo (`cost_price`)
- **Status do Campo:** O campo `cost_price` foi carregado para os 520 produtos na tabela `public.products`.
- **Diagnóstico Atual das Camadas de Acesso:**
  - **Acesso Anônimo (`anon`):** Não recebe `cost_price` ao consultar a VIEW pública `public.catalog_products` (que projeta apenas as colunas públicas do catálogo).
  - **View Pública (`public.catalog_products`):** NÃO contém e não expõe a coluna `cost_price`.
  - **Usuários Autenticados (`authenticated`):** Atualmente possuem grant de `SELECT` completo na tabela base `public.products` (restringidos por `tenant_id` via RLS). Consequentemente, qualquer usuário autenticado com acesso às linhas do tenant pode ler a coluna `cost_price`.
- **Risco Pendente Registrado:** Exposição do preço de custo a perfis autenticados que não deveriam ter visibilidade financeira irrestrita (como clientes B2C logados, `sales_rep` e `stock_manager`).
- **Resolução Planejada:** A correção de autorização e granularidade de acesso à coluna `cost_price` será implementada em uma migration de segurança dedicada ANTES da criação de usuários reais (`sales_rep`, `stock_manager`, clientes), mantendo a migration 000002 estritamente focada no bootstrap de produtos sem alterar grants ou RLS.

## 2. Isolamento de Tenants
- Nenhuma consulta ou mutação pode omitir `tenant_id`.
- Todas as operações administrativas continuam filtradas por `private.get_current_tenant_id()` e validadas contra `tenant_users`.
- A migration `20260903_000002_import_official_catalog.sql` não cria tenants e não altera `tenant_public_settings`.

## 3. Segurança no Supabase Storage (`tenant-assets`)
- **Prevenção contra XSS:**
  - Formato SVG (`image/svg+xml`) expressamente rejeitado no frontend por MIME e magic bytes (`<svg`), e restrito a `image/png, image/jpeg, image/webp` na configuração do bucket. Hardening client-side complementado por restrições no bucket (`allowed_mime_types`).
- **Proteção contra Path Traversal e Spoofing Multi-tenant:**
  - O primeiro segmento da URI de storage é estritamente o UUID canônico do tenant (`<tenant_uuid>/branding/...`).
  - Falha fechada (`isValidUUID`): Nenhum upload ou deleção é aceito se o tenant autenticado não tiver um UUID v4 válido. Slugs ou fallbacks arbitrários são recusados.
- **Princípio do Menor Privilégio nas Policies RLS:**
  - `SELECT`: Concedido estritamente a usuários autenticados para objetos do seu próprio `tenant_id` (`tenant_admin`) ou `platform_admin`. Esta política é indispensável pois a API `storage.remove()` do Supabase requer verificação via SELECT + DELETE. Não há policy SELECT pública em `storage.objects` (anon não pode enumerar arquivos; imagens são entregues via URL pública de CDN do bucket).
  - `INSERT`: Restrito estritamente a `tenant_admin` autenticado no diretório do seu próprio `tenant_id` ou `platform_admin`.
  - `UPDATE`: Não concedido a nenhuma role. Todos os arquivos são versionados por timestamp com `upsert: false`.
  - `DELETE`: Restrito estritamente a `tenant_admin` no diretório do seu próprio `tenant_id` ou `platform_admin` para fluxos compensatórios e substituição de mídia.
- **Deleção Segura e Compatibilidade com Registros Legados:**
  - Validação estrita via `extractOwnedBrandingPath`: Apenas URLs/paths comprovadamente originados do bucket `tenant-assets` e dentro do diretório `<tenant_uuid>/branding/` são passíveis de exclusão física.
  - Registros antigos ou URLs externas (ex: `https://site-externo.com/logo.png`) são substituídos no banco de dados sem tentativa de remoção no Storage, evitando erros e tentativas de acesso fora do boundary do tenant.
- **Validação de Runtime e Risco Residual Cross-Tenant:**
  - Runtime validado no AI Studio Preview: logo upload/reload/persistência/substituição/remoção = PASS; banner upload/reload/persistência/substituição/remoção = PASS.
  - Teste em runtime de acesso Cross-tenant: **NOT TESTABLE IN CURRENT DATASET** (o dataset atual de homologação contém apenas o tenant canônico demo; não declarar risco zero. A proteção é mantida estruturalmente por RLS na migration 000006 e validação Fail-Closed no client).
- **Segregação de Escopo de Storage:**
  - O bucket `tenant-assets` atende estritamente o branding institucional da loja (logo e banner).
  - Imagens de produtos pertencem à etapa futura `PRODUCT MEDIA STORAGE` e não utilizam nem compartilham o fluxo de branding atual.

## 4. Reconciliação B2B e Governança de Migrations (000001–000007)
- **Defesa em Profundidade na Reconciliação (Migration 000007):**
  - Reafirmação explícita de grants: o papel `anon` possui SELECT apenas nas 23 colunas públicas de `public.products`, sem acesso a `cost_price`, `wholesale_price`, `wholesale_enabled` e `wholesale_min_quantity`.
  - Recriação determinística de `public.catalog_products` (`security_invoker = true`) sem qualquer coluna de atacado ou custo.
  - RPC `public.get_wholesale_catalog` com fail-closed estrito (`COALESCE(s.allow_b2b_mode, false)`), exigindo aprovação de credenciamento B2B e privilégios revogados de `PUBLIC` e `anon`.
- **Congelamento Estrito das Migrations 000001 a 000007:**
  - Todas as 7 migrations encontram-se aplicadas e congeladas no Supabase Hosted. Nenhuma alteração retroativa é permitida; evoluções futuras exigirão `000008+`.

## 5. Segurança no Supabase Storage de Mídias de Produto (`product-media` - V1)
- **Status:** **PRODUCT MEDIA STORAGE IMPLEMENTADO NO WORKSPACE AGUARDANDO DEPLOY**
- **Prevenção contra XSS e Arquivos Maliciosos:**
  - Formato SVG (`image/svg+xml`) estritamente proibido tanto na camada de frontend (`validateProductMediaFile`, `validateProductMediaFileDeep`) quanto no bucket (`allowed_mime_types = ["image/png", "image/jpeg", "image/webp"]`).
  - Inspeção binária de magic bytes para PNG (`0x89 50 4E 47`), JPEG (`0xFF D8 FF`) e WebP (`RIFF...WEBP`). Impede spoofing de extensão em executáveis ou scripts renomeados.
  - GIF animado bloqueado nesta etapa.
- **Isolamento de Namespace Multi-Tenant & Multi-Produto:**
  - Diretório canônico no bucket: `<tenant_uuid>/products/<product_uuid>/media_<timestamp>_<random>.<ext>`.
  - Fail-Closed: Validação obrigatória de UUID v4 (`isValidUuid`) tanto para o `tenant_id` quanto para o `product_id`. Rejeição total de slugs, strings vazias, sequências de path traversal (`..`, `\`) e caracteres especiais.
  - Função `extractOwnedProductMediaPath` impede deleções cruzadas entre tenants (cross-tenant) e entre produtos do mesmo tenant (cross-product).
- **Políticas RLS em `storage.objects` (Migration 000008 e Forward-Fix 000009):**
  - *Status:* **000008 aplicada no Supabase hosted; Forward-fix 000009 criado / aguardando deploy**.
  - **Incidente de Escopo / Shadowing em 000008:** No Postgres real, dentro da subquery `EXISTS (SELECT 1 FROM public.products p ...)`, a chamada `storage.foldername(name)` sofreu shadowing por `p.name` (coluna da tabela `products`).
  - **Correção Forward na 000009:** Recria as policies qualificando explicitamente o outer row com `storage.foldername(storage.objects.name)`. Preserva rigorosamente as permissões de 000008 sem qualquer ampliação de privilégios.
  - Validação server-side estrita de vínculo do produto: cláusula `EXISTS (SELECT 1 FROM public.products p WHERE p.id::text = (storage.foldername(storage.objects.name))[3] AND p.tenant_id::text = (storage.foldername(storage.objects.name))[1])`.
  - `product_media_select_authenticated`: Restrito a `tenant_admin` autenticado sob `<tenant_uuid>/products/<product_uuid>` ou `platform_admin`, com produto existente e vinculado ao tenant. Impede enumeração e listagem pública de objetos no banco.
  - `product_media_insert_tenant_admin`: Restrito a `tenant_admin` autenticado sob `<tenant_uuid>/products/<product_uuid>` ou `platform_admin`, com produto existente e vinculado ao tenant.
  - `product_media_delete_tenant_admin`: Restrito a `tenant_admin` sob `<tenant_uuid>/products/<product_uuid>` ou `platform_admin`, com produto existente e vinculado ao tenant.
  - **Zero UPDATE policies:** Arquivos são versionados deterministicamente com `upsert: false`.
  - **Sem SELECT público em `storage.objects`:** A leitura pública no catálogo ocorre diretamente pela URL de CDN do bucket público.
  - **Sem DML direto** em `storage.buckets` e sem alteração estrutural em `storage.objects`.
  - *Runtime de Product Media:* **Ainda aguarda validação em ambiente real após o deploy da migration 000009** (não declarar runtime PASS).
- **Sanitização de Payloads e Prevenção de Blobs (HTTPS-Only):**
  - `AdminCatalogService.updateAdminProduct` sanitiza o array `images`: aceita exclusivamente URLs `https://` (novas ou legadas), rejeitando categoricamente esquemas não-HTTPS (`http://`, `blob:`, `data:`, `javascript:`, `file:`, etc.), elimina duplicatas preservando a ordem original e filtra strings vazias.
  - Gestão rigorosa de `URL.revokeObjectURL` no ciclo de vida do componente React para evitar vazamento de memória e URLs transitórias órfãs.
- **Consistência por Compensação (Client-Side):**
  - Fluxo: Validação profunda -> Uploads novos -> Atualização no PostgreSQL -> Confirmação do banco -> Remoção de mídias antigas desvinculadas.
  - Se qualquer upload intermediário ou a atualização do banco falhar, todos os novos arquivos recém-enviados são imediatamente deletados do Storage (`rollbackProductMediaUploads`).
  - Mídias legadas do Supabase V1 (`LEGACY_SUPABASE_V1_HOST`) ou URLs externas são desvinculadas do banco com segurança sem tentativas de deleção física no Storage.

## 6. Segurança em Pedidos e Checkout V1 (Hardening & Feature Gate)
- **Status:** **MIGRATION 000010 APLICADA/CONGELADA NO HOSTED + FORWARD HARDENING 000011 CRIADA NO WORKSPACE + EDGE FUNCTION HOSPEDADA BLOQUEADA POR FEATURE GATE**
- **Eliminação de Autoridade Financeira do Cliente:**
  - O contrato de backend (`submit-order-checkout` e `create_order_checkout_internal`) rejeita rigorosamente qualquer parâmetro financeiro no body (`unitPrice`, `totalPrice`, `subtotal`, `discount`, `shipping_fee`, `total`) e rejeita `buyerUserId` com HTTP 400.
  - O recálculo é estritamente server-side a partir de `public.products` (`price`, `promotional_price`, `wholesale_price`).
- **Ciclo de Vida de Estoque sem Vulnerabilidade de DoS:**
  - Pedidos recebidos pelo storefront entram exclusivamente com `status = 'pending'`.
  - A criação em `pending` valida a existência do estoque, mas **NÃO decrementa estoque**.
  - Impede ataques de esgotamento malicioso de inventário (*stock exhaustion DoS*) por atores anônimos.
  - O decremento de estoque ocorre exclusivamente na aprovação (`pending -> approved`) via RPC administrativa com locks pessimistas determinísticos (`FOR UPDATE` ordenado por UUID dos produtos) e validação de `GET DIAGNOSTICS v_affected_rows = 1`.
  - Em cancelamento de pedido aprovado/em separação, o estoque é restaurado atômica e exatamente uma vez com diagnóstico de linha única (`v_affected_rows = 1`). Cancelamento de pedido `pending` não altera estoque.
- **Isolamento de Privilégios (Least Privilege):**
  - A RPC `public.create_order_checkout_internal` tem `REVOKE ALL` para `PUBLIC`, `anon` e `authenticated`.
  - Acesso concedido estritamente para `service_role`, invocado exclusivamente pelo gateway da Edge Function.
  - A RPC `public.manage_order_status` teve seus privilégios de execução revogados de `PUBLIC`, `anon`, `authenticated` e `service_role` na migration 000013, eliminando a superfície de execução direta por papéis de API (menor privilégio estrito).
- **Idempotência Composta & UUID v4 Estrito:**
  - A tabela `public.orders` possui constraint `UNIQUE (tenant_id, idempotency_key)` reafirmada com verificação scoped em `public.orders`::regclass.
  - Apenas UUIDs na versão 4 (`/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/`) são aceitos; UUID v1/v5 são rejeitados fail-closed.
  - Tentativas repetidas de submissão retornam o pedido preexistente sem duplicação de registros ou inconsistência.
- **Snapshots Canônicos e Limites de Strings (Defense-in-Depth):**
  - A RPC constrói snapshots canônicos estritos para `customer` e `shippingAddress`, impedindo a persistência de JSONs arbitrários ou adulterados.
  - Limites rígidos de caracteres aplicados tanto na Edge Function quanto no PostgreSQL (slug <= 120, seller_code <= 64, delivery_method <= 64, notes <= 1000, name <= 160, street <= 200, selectedVariant <= 160).
- **Feature Gate Fail-Closed & Chaves Modernas na Edge Function:**
  - `CHECKOUT_ENABLED !== "true"` bloqueia imediatamente qualquer checkout com HTTP 503 (`Checkout temporariamente indisponível.`).
  - Uso exclusivo de `SUPABASE_SECRET_KEYS` com extração segura da chave default (`SUPABASE_SERVICE_ROLE_KEY` legada removida).
  - Limite de 64 KB aferido por bytes UTF-8 (`TextEncoder.encode(rawBody).byteLength`).
  - Honeypot anti-bot e sanitização/minimização de erros e PII na resposta HTTP.
  - Validação estrita de CPF/CNPJ (módulo 11) no frontend (`src/utils/brDocument.ts`), `orderService.ts` e na Edge Function (`submit-order-checkout`), normalizando para dígitos puros e rejeitando documentos inválidos.
  - Isolamento de PII: `confirmedCustomerSnapshot` preservado estritamente em memória volátil de componente React durante o ciclo de checkout; zero persistência de PII em `sessionStorage`, `localStorage` ou `IndexedDB`.
- **Governança de Deployment:**
  - Push para GitHub main deve ser tratado como potencial gatilho de deploy Supabase; não usar main como simples backup para mudanças ainda não aprovadas de migration ou Edge Function.

## 7. Armazenamento Seguro de Documentos de Pedido (PDF) e Handoff WhatsApp (V1.2 / ADR 006)
- **Bucket Privado `order-documents` (Migration 000012):**
  - Configuração: `public = false`, `file_size_limit = 5242880` (5 MiB), `allowed_mime_types = ARRAY['application/pdf']`.
  - Zero acesso público ou de cliente: ZERO client policies em storage.objects para order-documents (nenhuma policy para anon, authenticated, tenant_admin ou platform_admin).
  - O bucket é estritamente server-managed: uploads e criação de signed URLs ocorrem exclusivamente via `service_role` na Edge Function (`submit-order-checkout`).
  - Path canônico determinístico: `<tenant_uuid>/orders/<order_uuid>/pedido-<order_number>.pdf`. O browser não possui autoridade para definir diretórios ou nomes de arquivo e não acessa storage.objects diretamente.
- **Acesso Temporário via Signed URL (7 Dias):**
  - A URL assinada expira em exatamente 604.800 segundos (7 dias).
  - A URL é entregue exclusivamente sob protocolo HTTPS.
  - A resposta da Edge Function é minimizada: expõe apenas `documentUrl` e `documentExpiresAt`, sem expor credenciais de storage, `tenant_id` ou nomes internos de bucket.
- **Proteção e Minimização de PII no WhatsApp:**
  - O texto enviado ao WhatsApp é curto e profissional, não incluindo CPF/CNPJ completo, e-mail ou endereço completo.
  - Dados cadastrais completos permanecem confinados ao documento PDF no bucket privado e ao registro interno no banco de dados.
- **Fail-Closed de Contato e Pop-up Blocker:**
  - O número de WhatsApp da loja é validado antes de qualquer chamada à rede; se ausente ou inválido, o processo aborta sem tocar o banco.
  - Uma janela neutra é aberta antes do `await` para prevenir bloqueio de pop-up pelo navegador; em caso de erro da transação, a janela é fechada imediatamente.

## 8. Hardening de Funções SECURITY DEFINER e Acesso B2B Privilegiado (Migration 000013)
- **Status:** **MIGRATION 000013 APLICADA / CONGELADA NO SUPABASE HOSTED (DATABASE HARDENING: RUNTIME VERIFIED) | EDGE FUNCTION GET-WHOLESALE-CATALOG: CORREÇÃO DE BUNDLE PREPARADA / AGUARDANDO REDEPLOY E RUNTIME VALIDATION**
- **Supabase Security Advisor:**
  - Os 3 achados `authenticated_security_definer_function_executable` foram eliminados com sucesso no banco Hosted.
  - Risco residual aceito: `auth_leaked_password_protection` permanece devido a restrições de tiers do plano Free do Supabase.
- **Cloudflare Frontend:** Último build do commit de hardening concluído com sucesso (SUCCESS).
- **Tratamento dos Achados do Supabase Security Advisor (`authenticated_security_definer_function_executable`):**
  - **1. `public.get_my_wholesale_status(p_tenant_slug text)`:**
    - Convertida de `SECURITY DEFINER` para `SECURITY INVOKER` com `SET search_path = ''`.
    - Resolução canônica de tenant realizada exclusivamente sobre `public.tenant_public_settings` (onde `authenticated` possui SELECT sob RLS, sem requerer vínculo em `tenant_users`).
    - Consulta a `public.wholesale_customers` protegida deterministicamente pela política RLS `wholesale_customers_select_self` (`user_id = auth.uid()`).
    - Preserva exatamente o contrato público e estados esperados (`unauthenticated`, `tenant_not_found`, `not_registered`, `pending`, `approved`, `rejected`, `suspended`).
    - Privilégios: `REVOKE ALL FROM PUBLIC, anon; GRANT EXECUTE TO authenticated;`.
  - **2. `public.get_wholesale_catalog(p_tenant_slug text)`:**
    - Não convertida para `SECURITY INVOKER` direto no browser, para evitar expansão indevida de RLS em `public.products` que pudesse expor `cost_price` ou dados operacionais a compradores B2B.
    - Privilégio de execução revogado de `PUBLIC`, `anon` e `authenticated`. Função física preservada no banco para segurança de rollback.
    - Nova RPC interna `public.get_wholesale_catalog_internal(p_tenant_slug text, p_user_id uuid)` criada com `SECURITY DEFINER`, `SET search_path = ''`, com execução concedida **EXCLUSIVAMENTE a `service_role`** (`REVOKE ALL FROM PUBLIC, anon, authenticated;`).
    - Projeção atacadista estritamente sanitizada: retorna exclusivamente 4 colunas (`product_id`, `sku`, `wholesale_price`, `wholesale_min_quantity`). Jamais projeta `cost_price`, dados internos ou PII.
  - **3. Gateway Edge Function Autenticado (`get-wholesale-catalog`):**
    - Ponto único de entrada para o browser obter preços de atacado.
    - Validação obrigatória de cabeçalho `Authorization: Bearer <token>` via `supabaseAdmin.auth.getUser(token)`.
    - O `userId` é estritamente derivado da sessão validada server-side; o payload do cliente não possui autoridade para declarar `userId` ou `tenantId`.
    - Bloqueio imediato de campos proibidos no body (`userId`, `costPrice`, chaves financeiras, etc.) e allowlist exata de campos (`tenantSlug`).
    - Limite técnico de tamanho de body de 4 KB aferido em bytes UTF-8.
    - Status de Deploy: Correção de bundle preparada no workspace; aguardando redeploy e validação em runtime.
  - **4. `public.manage_order_status(p_order_id uuid, p_new_status text)`:**
    - Privilégios de execução revogados de `PUBLIC`, `anon`, `authenticated` e `service_role` (`REVOKE EXECUTE FROM PUBLIC, anon, authenticated, service_role`).
    - Zero concessão para `service_role` nesta etapa por não existir gateway server-side ativo consumindo a RPC (menor privilégio estrito).
    - Função física preservada no banco para integridade e rollback; futura integração administrativa deverá estabelecer arquitetura server-side explícita antes de qualquer novo GRANT.
    - Elimina o achado de segurança de execução direta de RPC `SECURITY DEFINER` por papéis de API.

## 9. Gestão Administrativa de Pedidos V2 — Ciclo de Vida Server-Side, Transacionalidade de Estoque e PDF (Migration 000014 / ADR 009)
- **Status:** **MIGRATION 000014 APLICADA / FROZEN NO SUPABASE HOSTED | EDGE FUNCTIONS VERIFICADAS EM TESTES AUTOMATIZADOS**
- **Migration 000014 (Forward-Only):**
  - Migrations 000001 a 000013 permanecem aplicadas e congeladas.
  - Reafirma defensivamente o bloqueio total da RPC legada `manage_order_status(UUID, TEXT)` sem execução para nenhum papel (`PUBLIC`, `anon`, `authenticated`, `service_role`).
  - Cria `public.manage_order_status_internal(p_order_id UUID, p_new_status TEXT, p_actor_user_id UUID)` com `SECURITY DEFINER`, `SET search_path = ''`.
  - Permissões restritas: `REVOKE ALL FROM PUBLIC, anon, authenticated; GRANT EXECUTE TO service_role;`.
  - Trava pessimista `FOR UPDATE` na linha do pedido.
  - Validação estrita do operador (`p_actor_user_id`): `platform_admin` ou `tenant_admin`/`stock_manager` do mesmo tenant. Operadores `sales_rep` e cross-tenant são expressamente rejeitados (erro `42501`).
  - Trava pessimista de produtos ordenada por `productId UUID ASC` para prevenir deadlocks.
  - Controle atômico de estoque: débito na aprovação (`pending -> approved`) e estorno controlado no cancelamento (`approved/preparing -> cancelled`).
  - Retorno mínimo sanitizado sem PII: `{ id, order_number, status, updated_at }`.
- **Edge Functions Gateway Segregadas (Responsabilidade Única):**
  - **`manage-order-status`:**
    - Declarada com `verify_jwt = true` em `supabase/config.toml`.
    - Payload JSON rigorosamente restrito a `{ "orderId": string, "newStatus": string }` com limite de 4 KB (rejeita chaves extras, `action`, `role` ou identificadores de usuário).
    - Validação de sessão e derivação estrita do `actorUserId` server-side via `auth.getUser()`.
    - Chamada à RPC interna via client com credenciais `service_role`.
    - Mapeamento e sanitização de erros PostgreSQL (400, 403, 404, 409, 500).
  - **`generate-admin-order-pdf`:**
    - Declarada com `verify_jwt = true` em `supabase/config.toml`.
    - Payload JSON rigorosamente restrito a `{ "orderId": string }` com limite de 4 KB.
    - **Autorização RLS Contextual:** Leitura do pedido executada exclusivamente via client autenticado com o token do usuário (`Authorization: Bearer <token>`). A RLS decide a autorização de leitura — permitindo que operadores autorizados pela RLS (incluindo `sales_rep`) gerem o PDF.
    - Se a RLS não retornar a linha do pedido, responde com 404 sanitizado sem vazar metadados entre tenants.
    - **Service Role estritamente pós-leitura:** Invocada apenas após leitura autorizada para renderizar os bytes via `generateOrderPdf`, gravar no bucket privado `order-documents` (`<tenant_id>/orders/<order_id>/pedido-<order_number>.pdf`) e emitir Signed URL temporária.
    - **TTL de Signed URL:** Exatamente 600 segundos (10 minutos). Zero log de URLs assinadas.
- **Frontend & Proibição de Hard Delete:**
  - `src/services/adminOrderService.ts` isola as chamadas entre `updateAdminOrderStatus` e `generateAdminOrderPdf` sem envio de `action`.
  - Zero métodos `.delete()` no frontend administrativo; registros transacionais de pedidos permanecem auditáveis e imutáveis contra deleção física.

## 10. Acompanhamento de Pedidos pelo Cliente (Customer Order Tracking V1 / ADR 011 / Migrations 000015–000016)
- **Status da Feature:** **MIGRATION 000015 APLICADA / FROZEN NO SUPABASE HOSTED; MIGRATION 000016 RELEASE CANDIDATE / HOSTED STATUS PENDING POST-SYNC VERIFICATION**
- **Risco Registrado:**
  - O Retail Tracking Token armazenado em `localStorage` opera como uma credencial de posse (*bearer credential*).
- **Mitigações Estruturais Implementadas:**
  1. **Alta Entropia Criptográfica:** Geração server-side via CSPRNG de 256 bits (64 hex lowercase). Impossibilita ataques de adivinhação, enumeração ou força bruta.
  2. **Persistência Exclusiva de Hash (Hash-Only):** Somente o hash SHA-256 é armazenado em `public.orders.tracking_token_hash`. O token em claro nunca reside no banco de dados.
  3. **Token Fora de URLs:** O token nunca trafega em *query strings*, URLs ou links compartilháveis. Trafega exclusivamente no body POST HTTPS e no cabeçalho do recibo imediato.
  4. **Zero Logging de Tokens ou Hashes:** O token em claro e seu hash nunca são logados nos consoles das Edge Functions.
  5. **Storage Local Sem PII:** O storage do navegador armazena estritamente `{ orderNumber, trackingToken, createdAt }`. Zero PII (nome, telefone, CPF, e-mail ou endereço) no storage local.
  6. **Isolamento de Chaves por Tenant:** Storage chaveado estritamente por tenant (`corsys_order_tracking_v1:<slug>`), impedindo vazamento de tokens entre lojas.
  7. **Escopo Mínimo de Acesso:** O token concede leitura restrita a exatamente um pedido de varejo vinculado ao tenant do slug.
  8. **Resposta de Tracking sem Endereço / PII:** A RPC e a Edge Function retornam exclusivamente dados operacionais de status e itens (`orderNumber`, `status`, `shoppingMode`, `deliveryMethod`, `paymentMethod`, `items`, `subtotal`, `discount`, `shippingFee`, `total`, `createdAt`, `updatedAt`). `customer`, `customerName` e `shippingAddress` foram totalmente removidos da resposta.
  9. **Impossibilidade de Lookup por PII ou Order Number:** O gateway rejeita qualquer consulta por `order_number`, CPF, CNPJ, telefone ou e-mail.
- **Risco Residual:**
  - Vulnerabilidades de Cross-Site Scripting (XSS) no navegador podem permitir a exfiltração do bearer token salvo em `localStorage`.
- **Status do Risco:**
  - **MITIGATED / RESIDUAL** (NÃO ELIMINATED).



## Item 4 — Controle de campos por tenant / ADR 012
- CHECK estrito proíbe campos desconhecidos, valores não booleanos e required em campo oculto; quatro campos essenciais permanecem obrigatórios.
- Nova coluna pública contém apenas regras do formulário, sem PII. Grant UPDATE por coluna + RLS já existente: same-tenant tenant_admin ou platform_admin; vendedores/estoque/anon negados.
- Checkout lê política no banco, elimina campos ocultos e impõe required antes da persistência. ACL service-role-only e search_path vazio preservados.
- Identidade B2B é derivada de cadastro aprovado; ocultar razão social de varejo não permite adulterar identidade B2B. E-mail oculto não vaza via fallback B2B.
- Pedidos idempotentes/históricos permanecem imutáveis. Catálogo com política antiga pode receber 400 após mudança administrativa: recarregar e corrigir, sem pedido parcial.
- Concorrência administrativa usa UPDATE condicional; conflito exige recarregar. Sem secrets, PII em docs, campos livres ou expansão de políticas.
- Auditoria de configuração não adiciona log por operador nesta versão; updated_at existente registra a alteração. Risco residual: atribuição individual depende de logs existentes; não declarada como implementada.
- Testes de papéis reais e Hosted registrados no handoff após execução; até lá NOT EVALUATED.

Advisors Hosted antes/depois do Item 4: nenhum finding novo. Aviso preexistente: [Leaked password protection desabilitada](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection), fora do escopo desta implementação. Testes de papéis reais/isolamento: PASS (ver SESSION_HANDOFF).


---

## Respostas B2B assíncronas obsoletas — isolamento de sessão (2026-10-09)

- **Evidência adicional de componente:** React DOM/jsdom reproduziu manutenção de modalidade/carrinho e modal de A após troca direta para B (5 PASS / 2 FAIL na baseline PR #6). Comparação de identidade no efeito encerra a sessão comercial anterior; após correção 7/7 PASS. Stubs Auth/rede não comprovam isolamento no backend. Estado permanece FIX PREPARED / NOT DEPLOYED; não houve remediação ou mutação de produção.

- **Área:** `src/context/WholesaleAccessContext.tsx`; cache privado em memória do catálogo atacadista e identidade do comprador.
- **Finding de revisão de código:** na revisão anterior, callbacks de `refreshWholesaleStatus` e `loadWholesaleCatalog` podiam concluir depois de `clearWholesaleSession`/troca de usuário e voltar a preencher status, dados comerciais ou mapa de preços no estado React. Modal de mudança de modo também não revalidava a aprovação ao confirmar. Cenário potencial, não foi observado como exploração real em produção.
- **Impacto potencial:** exposição transitória em UI de dados do catálogo de outro usuário no mesmo navegador e estado visual B2B inconsistente após logout. O risco NÃO equivale a execução de RPC privilegiada, pois a autorização server-side e a RLS permanecem obrigatórias.
- **Correção candidata (PR #6, não publicada):** guard versionado por identidade (`createWholesaleRequestGate`) para status e catálogo; invalidação no logout, troca de usuário, nova consulta e revogação; descarte de respostas antigas; catálogo e identidade renderizados somente para a identidade atual; revalidação da aprovação antes de confirmar troca para atacado; controle de catálogo vazio sem loop de refetch.
- **Testes propostos:** testes determinísticos de versão e ordem de resolução de Promises, logout/revogação e usuário diferente anexados à suíte `scripts/test-checkout-fields.ts`. Evidência de CI por commit registrada no PR após executar. Teste com React renderizado, JWT real e browser multiusuário ainda `NOT EVALUATED`.
- **Risco residual:** requisições já transmitidas podem completar no servidor (são ignoradas pelo client); resposta já exibida antes da limpeza ou captura de tela não pode ser recuperada; backend continua sendo o perímetro de autorização. A validação B2B E2E em ambiente isolado permanece necessária.
- **Estado:** `FIX PREPARED / NOT DEPLOYED`; não declarar remediação em produção antes de merge, deploy e homologação.


---

## Pré-release 2026-10-14 — acesso público a faixas de atacado em Hosted

- **Evidência:** consulta somente leitura ao Supabase Hosted confirmou `public.wholesale_tiers` com `has_table_privilege('anon', ..., 'SELECT') = true`, política RLS `wholesale_tiers_select_public` presente e RLS habilitada. A contagem observada foi **0 registros**. Portanto não houve demonstração de exposição de preço privado de linha real, mas a configuração atual deixaria faixas futuras legíveis de forma anônima quando associadas a produtos públicos.
- **Severidade:** ALTA como falha potencial de confidencialidade antes de cadastrar faixas de atacado; sem impacto observado em dados existentes (0 registros no instante auditado).
- **Correção versionada e não publicada:** migration `20261010000000_000020_product_rls_and_private_wholesale_tiers.sql` remove a política de leitura pública, revoga privilégio `anon` e preserva políticas administrativas/autenticadas por tenant. Ao aplicar, validar diretamente os grants e testes com os papéis `anon`, comprador aprovado, administrador próprio e de outro tenant. O acesso a preços atacadistas para compradores deve permanecer restrito à Edge Function autorizada.
- **Situação:** `OPEN / FIX PREPARED`. Não foi aplicada nenhuma migration Hosted nesta revisão. Pré-flight e sequência proposta em `docs/qa/PR6_RELEASE_GATE_20261014.md`.
- **Risco de release adicional:** endpoint público de Google Routes, mesmo com reserva global SQL de tentativas, não cria limite global de cobrança fora da aplicação se uma chave for extraída. Google recomenda restrições de aplicativo e API, e proteção server-side; uso da chave sem restrição por IP foi documentado como escolha de QA. Não ativar Google em produção sem decisão explícita e política de custos/monitoramento. Referência oficial: https://developers.google.com/maps/api-security-best-practices .


## Mitigação RLS Hosted e gate Google — atualização 2026-10-14

- **Corrigido no BANCO Hosted:** 000020 aplicada e versão reconciliada. Verificação explícita confirmou has_table_privilege('anon','public.wholesale_tiers','SELECT') = false, política wholesale_tiers_select_public ausente, política tenant-scoped mantida e RLS habilitada; 0 faixas existentes, 6 pedidos e 520 produtos preservados. Achado anterior de preço público está REMEDIATED para grants/policies no schema Hosted. Teste E2E multissessão no frontend da PR não equivale a isso; continua pendente.
- **Google Routes não ativado:** sem migrations usage/burst no Hosted, sem função estimate-delivery, nenhuma configuração estimateEnabled=true. UI comprador em CartDrawer e opção administrativa de habilitar estimativa em DeliverySettings são desativadas quando VITE_GOOGLE_ROUTES_UI_ENABLED não é exatamente 'true' no build. O servidor continua exigindo GOOGLE_ROUTES_ENABLED === 'true' separadamente; flag pública não substitui autenticação/cotas e não contém chave. Riscos de key IP irrestrita, cobrança e abuso permanecem ABERTOS antes de ativação futura.
- A continuação da QA é autorizada, mas merge/deploy/custos requerem gates distintos. Plano completo em docs/qa/PR6_RELEASE_GATE_20261014.md.

## Risco checkout B2B: idempotência sem vínculo de comprador — 16/10/2026

- **Severidade:** ALTA (potencial divulgação de pedido/documento de outro comprador mediante chave de idempotência reutilizada; chave não equivale a autorização).
- **Origem:** fast-path de `public.create_order_checkout_internal` na migration congelada 000018 consulta `tenant_id/idempotency_key` e retorna `orders` antes de vincular a identidade e status do comprador B2B.
- **Evidência:** revisão de SQL e [Isolated Browser QA negativa #38978866418](https://github.com/MichaelDeCarvalho/Corsys_Catalogo/actions/runs/38978866418) com falha de asserção na etapa do replay entre tenants; status exato da resposta não registrado. Não há evidência de incidente real/Hosted.
- **Mitigação proposta QA:** migration forward-only `20261016000000_000023_checkout_idempotency_buyer_guard.sql`, registrada em ADR 015. Wrapper SECURITY DEFINER verifica comprador aprovado, mesmo em replay, compara dono/modalidade de pedido existente e serializa por chave; legado movido para schema privado com grants retirados dos papéis de API.
- **Status:** FIX EM QA / NÃO PUBLICADO. Gate de merge/release **BLOCKED** até PASS da QA integrada e autorização explícita do deploy/migration seletiva. Migrations 000018–000020 aplicadas não devem ser editadas, revertidas ou reaplicadas. Migrations Google mais antigas na pasta ainda não estão no Hosted.
- **Atualização de validação:** a mitigação da migration 000023 passou [Browser QA #38979869345](https://github.com/MichaelDeCarvalho/Corsys_Catalogo/actions/runs/38979869345) no banco/Edge descartável, com negativa de replay cruzado e revogação, e [Quality #38979475405](https://github.com/MichaelDeCarvalho/Corsys_Catalogo/actions/runs/38979475405) SUCCESS. **Status: MITIGADO NA BRANCH / AINDA NÃO REMEDIADO EM HOSTED**; aprovação de produção continua bloqueada até migration seletiva autorizada.
