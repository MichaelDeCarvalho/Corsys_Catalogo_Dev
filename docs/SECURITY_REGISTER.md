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
