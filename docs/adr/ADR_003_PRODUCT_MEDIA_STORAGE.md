# ADR 003: Armazenamento e Isolamento de Mídias de Produtos (Product Media Storage V1)

## Status
**Aceito** (Data: 2026-09-16)  
*Status documental de implantação:* **PRODUCT MEDIA STORAGE IMPLEMENTADO NO WORKSPACE AGUARDANDO DEPLOY**

---

## Contexto
O catálogo multi-tenant do Corsys exige o suporte ao envio e gestão de fotos oficiais dos produtos cadastrados. Anteriormente, as referências de imagens de produtos estavam contidas no array `images TEXT[]` da tabela `public.products`, contendo referências a uma instância anterior pausada (`oysznehftuovxchrfmfx.supabase.co`) ou URLs externas.

Para estruturar o ecossistema de mídias de produto sob rigorosos padrões de segurança multi-tenant, menor privilégio e consistência de dados, foram definidos os seguintes requisitos arquiteturais:
1. **Segregação de Buckets por Propósito:** O bucket `tenant-assets` é estritamente reservado para ativos de identidade visual (logo e banner). As fotos dos produtos devem residir em bucket dedicado (`product-media`).
2. **Restrição de Formatos e Vetores Maliciosos:** SVG é estritamente proibido devido ao risco crítico de execução de scripts (XSS). GIF animado é desabilitado nesta etapa. Os únicos formatos permitidos são **PNG, JPEG e WebP**, validados por extensão, tipo MIME e **magic bytes binários**.
3. **Limite Rígido de Volume:** Limite de **1 MiB** por arquivo para fotos de produtos, otimizando o consumo de rede e armazenamento.
4. **Isolamento Multi-Tenant e Multi-Produto no Storage:** A estrutura de diretórios no bucket é obrigatória e determinística: `<tenant_uuid>/products/<product_uuid>/media_<versao>.<ext>`. Apenas UUIDs canônicos são aceitos (fail-closed contra injeções de caminhos ou slugs textuais).
5. **Menor Privilégio nas Políticas RLS do Storage:**
   - Leitura pública realizada diretamente via CDN do bucket público pelo storefront.
   - **NENHUMA** policy de `SELECT` público em `storage.objects` para impedir enumeração e listagem arbitrária de arquivos.
   - `SELECT`, `INSERT` e `DELETE` autenticados estritamente restritos a `tenant_admin` no escopo do seu próprio `tenant_id` ou `platform_admin`.
   - **NENHUMA** policy de `UPDATE` (uploads utilizam nomenclatura versionada por timestamp/random com `upsert: false`).
6. **Consistência Compensatória Client-Side:** Devido à natureza desacoplada entre a API do Supabase Storage e o banco de dados relacional PostgreSQL, o fluxo de persistência adota reversão compensatória: validação -> upload de novos arquivos -> persistência no banco -> confirmação do banco -> remoção controlada de mídias antigas desvinculadas. Caso qualquer etapa falhe, os novos arquivos recém-enviados são imediatamente deletados do Storage.
7. **Preservação de Referências Legadas:** URLs de instâncias legadas e links externos mantidos no banco não são deletados fisicamente do storage durante a remoção de itens, retornando `null` de forma segura.

---

## Decisões Tomadas

### 1. Declaração do Bucket no `config.toml`
O bucket local e de infraestrutura é declarado exclusivamente no arquivo de configuração:
```toml
[storage.buckets.product-media]
public = true
file_size_limit = "1MiB"
allowed_mime_types = ["image/png", "image/jpeg", "image/webp"]
```

### 2. Políticas de Menor Privilégio na Migration 000008 (`20260916_000008_product_media_storage.sql`)
*Status:* **Políticas definidas na migration 000008 / aguardando deploy**
- Não executa DML direto em `storage.buckets`.
- Não executa `ALTER TABLE storage.objects`.
- Estabelece as seguintes policies em `storage.objects` com validação server-side de posse do produto (`EXISTS (SELECT 1 FROM public.products p WHERE p.id::text = (storage.foldername(name))[3] AND p.tenant_id::text = (storage.foldername(name))[1])`):
  - `product_media_select_authenticated`: Restrito a `tenant_admin` no próprio tenant sob `/products/<product_id>` ou `platform_admin`, com produto existente e pertencente ao tenant.
  - `product_media_insert_tenant_admin`: Restrito a `tenant_admin` no próprio tenant sob `/products/<product_id>` ou `platform_admin`, com produto existente e pertencente ao tenant.
  - `product_media_delete_tenant_admin`: Restrito a `tenant_admin` no próprio tenant sob `/products/<product_id>` ou `platform_admin`, com produto existente e pertencente ao tenant.
  - Nenhuma policy de `UPDATE` ou `SELECT` público amplo.

### 3. Serviço de Storage Especializado (`src/services/productMediaStorageService.ts`)
- **Validação Binária:** Função `detectRealProductImageType` inspeciona os magic bytes dos primeiros 16 bytes do arquivo (PNG `0x89 50 4E 47`, JPEG `0xFF D8 FF`, WebP `RIFF...WEBP`).
- **Validação Síncrona Preliminar e Profunda Assíncrona:** Bloqueia SVG, GIF, arquivos acima de 1 MiB e extensões adulteradas.
- **Fail-Closed em Identificadores:** Rejeita chamadas onde `tenantId` ou `productId` não sejam UUIDs v4 válidos.
- **Extração Segura de Caminho (`extractOwnedProductMediaPath`):** Valida a posse da mídia pelo tenant e produto antes de qualquer deleção física, rejeitando path traversal (`..`, `\`), schemas perigosos (`blob:`, `data:`, `javascript:`) e ignorando URLs de outro tenant, de outro produto ou de outros hosts.
- **Rotinas Compensatórias:** `rollbackProductMediaUploads` e `removeProductMediaImage` para garantir higienização sem orfandade de arquivos.

### 4. Integração no `AdminCatalogService` (`src/services/adminCatalogService.ts`)
- O payload de atualização `AdminProductUpdatePayload` aceita `images?: string[]`.
- Sanitização estrita em `updateAdminProduct` (HTTPS-Only):
  - Garante que seja um array de strings.
  - Aplica `trim()` e descarta strings vazias.
  - Aceita exclusivamente URLs com esquema `https://` (incluindo URLs legadas HTTPS já existentes e URLs Supabase).
  - Rejeita qualquer esquema não-HTTPS (`http://`, `blob:`, `data:`, `javascript:`, `file:`, etc.) sem conversão automática.
  - Elimina duplicatas preservando a ordem original definida pelo operador.

### 5. Experiência de Edição no `ProductEditModal` (`src/components/tenantadmin/ProductEditModal.tsx`)
- Seção "Fotos do Produto" com suporte a múltiplas imagens.
- **Upload Apenas ao Salvar:** A seleção de arquivos no computador gera apenas previews locais controlados via `URL.createObjectURL` e rastreados em `useRef<Set<string>>` para revogação pontual via `URL.revokeObjectURL`. Nenhum upload é realizado antes do clique explícito em "Salvar Alterações".
- **Cancelamento Inócuo:** Fechar ou cancelar o modal não aciona nenhum envio remoto e revoga todos os ObjectURLs criados.
- **Ordem Determinística & Foto Destaque:** O índice `0` do array representa a foto principal (badge Destaque), com controles para definir principal, reordenar (`subir`/`descer`) e remover.
- **Trava de Concorrência (`saving`):** Durante o processo de envio e persistência, o formulário bloqueia interações concorrentes.

---

## Consequências

### Positivas
- **Imunidade a XSS em Mídias:** Proibição irrestrita de arquivos SVG elimina o risco de execução de código embutido no contexto do navegador do usuário.
- **Isolamento de Diretórios:** Garantia de que cada tenant e cada produto operem exclusivamente em seu subdiretório UUID.
- **Sem Degradação de Catálogo Legado:** A substituição ou remoção de imagens não quebra URLs legadas já persistidas nem gera exceções no Storage.
- **Zero Blobs Persistidos:** Validação e sanitização estritas impedem que URLs transitórias `blob:` ou `data:` sejam gravadas no banco de dados.

### Restrições Conhecidas
- O upload em massa (ZIP/lote associado por SKU) não faz parte desta entrega e permanece planejado para etapa futura dedicada.
- O catálogo oficial atual possui produtos com `images = []` ou URLs legadas, sendo populado progressivamente pelo operador através do modal de edição.
