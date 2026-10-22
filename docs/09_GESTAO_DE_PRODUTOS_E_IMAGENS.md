# 09 - GESTÃO DE PRODUTOS E IMAGENS

> **Documento Normativo e Operacional**  
> **Status:** Ativo (Etapa 2.6 - Validação Final da Correção de Imagens)  
> **Aplica-se a:** Catálogo MC Ferramentas e Distribuição & Plataforma Multi-Tenant

---

## 1. Fonte Oficial dos Dados de Produto

A verdade canônica sobre produtos, especificações técnicas, SKUs, categorias e preços é originada de cadastros comerciais e tabelas de faturamento validadas. No contexto atual da aplicação:

1. **Catálogo Canônico Inicial:** `src/data/mcCatalogProducts.ts` (92 produtos industriais genuínos da MC Distribuição).
2. **Dados em Runtime:** Contexto React (`AppContext.tsx`) com persistência client-side (`localStorage`), preparado estruturalmente para sincronização bidirecional com o Supabase Postgres na **Etapa 3 (Schema + Migration Inicial + RLS)**.
3. **Integridade de Registro:** Nenhuma rotina visual ou falha de carregamento de recursos externos pode mutar, corromper ou sobrescrever o registro dos produtos na base de dados ou no estado da aplicação.

---

## 2. Proibição Categórica de Imagens Fake, Genéricas ou de IA

Para proteger a credibilidade comercial da MC Distribuição e dos tenants do ecossistema:

* **PROIBIÇÃO TOTAL de fotos aleatórias da internet:** Bancos genéricos (Unsplash, Pexels, Shutterstock, etc.) estão terminantemente proibidos no catálogo.
* **PROIBIÇÃO de imagens de categoria aproximada:** Um disco de corte fino não pode exibir a foto de um rebolo diamantado genérico.
* **PROIBIÇÃO de fotos geradas por Inteligência Artificial:** Não é permitido gerar produtos sintéticos para preencher espaço.
* **Regra de Ausência / Indisponibilidade:** Se a fotografia real do produto ainda não foi enviada para o Storage ou se o bucket de origem estiver temporariamente indisponível (ex: projeto Supabase V1 pausado), a interface exibirá **exclusivamente um placeholder neutro** (*"Imagem não disponível"*).
* **Defesa de Dados no Fallback:** Falhas de rede (404, DNS, CORS) acionam o fallback apenas no DOM via `onError`. Em hipótese alguma o registro do produto, seu array de imagens ou a persistência sofrem mutação.

---

## 3. Fluxos Operacionais

### 3.1. Cadastro de Produto Individual
* **Interface:** Painel Administrativo do Tenant (`ProductManager.tsx` -> *"Novo Produto"*).
* **Campos Obrigatórios:** Nome, SKU (único por tenant), Categoria, Preço de Varejo, Unidade de Medida.
* **Imagens:** O operador pode registrar a URL de uma imagem oficial já hospedada ou deixar o campo vazio (o produto será exibido com o placeholder neutro de integridade até a vinculação da foto real).

### 3.2. Edição de Produto
* **Acesso:** Tabela de produtos -> Botão *"Editar"*.
* **Permissões:** Apenas operadores com a permissão `canEditProducts` têm autorização de salvar alterações.
* **Preservação de Histórico:** A alteração de preços, estoque ou outros metadados preserva rigorosamente as referências fotográficas anteriores.

### 3.3. Upload Individual de Imagens (Etapa Dedicada de Storage)
* **Aviso de Fase:** *O upload será habilitado após a configuração do Supabase Storage V2 (em etapa posterior específica de Supabase Storage V2 + Upload + Policies + Integração Administrativa, subsequente à Etapa 3).*
* **Validação Prévia:** O client-side inspecionará tipo MIME, extensão e tamanho antes do envio.
* **Atribuição:** A URL pública gerada pelo Supabase Storage será associada ao registro de imagens do produto.

### 3.4. Upload em Lote / Importação em Massa (Etapa Dedicada de Storage)
* **Módulo:** Painel Administrativo -> Aba *"Importar Imagens em Massa"*.
* **Mecanismo:** O administrador poderá enviar múltiplos arquivos locais simultaneamente ou pacote compactado.
* **Associação:** O sistema fará a correspondência pelo SKU contido no nome original do arquivo (ex: `BR090.jpg`, `CU010.webp` vinculam-se aos respectivos produtos de SKU `BR090` e `CU010`).
* **Relatório de Conformidade:** Ao final, o sistema exibirá:
  * Imagens vinculadas com sucesso ao respectivo `product_id`.
  * Arquivos cujo SKU não foi localizado no catálogo do tenant.
  * Produtos do catálogo que permaneceram sem foto.

---

## 4. Arquitetura de Imagens: Principal, Múltiplas Imagens e Ciclo de Vida

O modelo de dados e a arquitetura de armazenamento são projetados para suportar o ciclo de vida completo de ativos visuais:

1. **Múltiplas Imagens por Produto:** Cada produto pode possuir um conjunto ordenado de fotografias em ângulos complementares, detalhes técnicos e aplicações industriais.
2. **Imagem Principal:** Uma imagem é expressamente designada como principal (`is_primary` / índice 0), utilizada como capa nos cards do catálogo, storefront e checkout.
3. **Ordenação:** Os operadores podem reorganizar a sequência de exibição das imagens através de controles de ordenação (`sort_order`).
4. **Remoção:** Exclusão individual de imagens indesejadas, acionando a desvinculação no banco e a remoção segura do arquivo no Storage.
5. **Substituição:** Substituição controlada de fotos existentes por novas versões de melhor qualidade, mantendo o histórico de integridade.
6. **Associação Exata ao `product_id`:** O vínculo canônico no banco de dados é sempre a chave primária `product_id` (UUID) do produto, com separação estrita por `tenant_id`.

---

## 5. Estrutura Conceitual de Storage no Supabase V2

### 5.1. Diretriz de Segurança para Caminhos de Arquivos
> **REGRA CRÍTICA:** Não confiar no nome original do arquivo como path final de Storage.
> 
> O nome original do arquivo (ex: `BR090.jpg`) é utilizado exclusivamente pelo client-side / rotina de importação para efetuar o *matching* lógico com o SKU do catálogo. No momento da gravação no bucket, o sistema gera identificadores únicos universais (UUIDs) para compor o path final, eliminando colisões, problemas de codificação de caracteres e riscos de *path traversal*.

### 5.2. Hierarquia de Pastas e Caminhos
```text
product-images/
  └── {tenant_id}/
        └── {product_id}/
              ├── {generated-file-id-1}.webp
              └── {generated-file-id-2}.jpg
```

* Exemplo real:
  `product-images/tenant-mc-distribuicao/prod-mc-br090/a8f1b2c3-4d5e-6f7a-8b9c-0d1e2f3a4b5c.webp`

### 5.3. Bucket Canônico e Políticas RLS
* **Bucket:** `product-images` (público para leitura, com escrita e deleção restritas por RLS a administradores autenticados do respectivo tenant).

---

## 6. Formatos Aceitos e Validações de Upload

| Parâmetro | Especificação Inicial | Observação / Política |
| :--- | :--- | :--- |
| **Formatos Aceitos Inicialmente** | `image/jpeg` (.jpg, .jpeg)<br>`image/png` (.png)<br>`image/webp` (.webp) | Flexibilidade na ingestão; conversão/otimização adicional para WebP poderá ocorrer na infraestrutura. |
| **Limite de Tamanho por Arquivo** | 2 MB (Recomendação Inicial) | Parâmetro configurável na governança do sistema, sujeito a ajuste conforme decisão de infraestrutura. |
| **Resoluções Recomendadas** | 800 x 800 px a 1200 x 1200 px (1:1) | Ideal para zoom e visualização em alta fidelidade. Mínimo aceitável: 400 x 400 px. |
| **Sanitização de Metadados** | Stripping de EXIF/GPS | Recomendado na esteira de upload para otimização de banda e privacidade de dados. |

---

## 7. Políticas de Acesso e RLS para Imagens (Storage Supabase)

### 7.1. Leitura Pública (Catálogo e Storefront)
```sql
-- Qualquer visitante ou cliente pode visualizar as imagens públicas dos produtos
CREATE POLICY "Public Access for Product Images"
ON storage.objects FOR SELECT
USING ( bucket_id = 'product-images' );
```

### 7.2. Upload e Modificação Restritos ao Administrador do Tenant
```sql
-- Somente administradores autenticados do respectivo tenant podem fazer upload
CREATE POLICY "Tenant Admins Upload Product Images"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'product-images'
  AND (storage.foldername(name))[1] = (
    SELECT tenant_id FROM public.profiles WHERE id = auth.uid()
  )
);

-- Somente administradores do tenant podem atualizar ou deletar imagens de seus produtos
CREATE POLICY "Tenant Admins Delete Product Images"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'product-images'
  AND (storage.foldername(name))[1] = (
    SELECT tenant_id FROM public.profiles WHERE id = auth.uid()
  )
);
```

---

## 8. Estratégia de Migração do Supabase V1 para o V2

### 8.1. Diagnóstico do Supabase V1
* **Host V1:** `oysznehftuovxchrfmfx.supabase.co`
* **Status Atual:** Instância pausada/inativa pelo provedor.
* **Preservação de Referência:** Todas as 92 URLs e caminhos originais foram inventariados e permanecem integralmente preservados no código-fonte e no banco como referência canônica histórica.

### 8.2. Roteiro de Migração Técnica para o Supabase Storage V2
*Nota: Este roteiro será executado exclusivamente na etapa posterior dedicada a Storage V2 + Upload + Policies + Integração Administrativa, após a conclusão da Etapa 3 (Schema + Migration Inicial + RLS).*

1. **Recuperação e Validação de Ativos:** Restauração dos arquivos das fotos genuínas da MC Distribuição a partir do acervo oficial.
2. **Provisionamento do Bucket V2:** Criação do bucket `product-images` com RLS por tenant no novo projeto ativo.
3. **Carga em Lote com Hash:** Upload dos arquivos associados por SKU e gravados na estrutura `{tenant_id}/{product_id}/{uuid}.{ext}`.
4. **Atualização das URLs:** Atualização controlada dos registros de produtos apontando para os novos endpoints do Supabase V2.
5. **Transição Transparente:** Os placeholders neutros serão automaticamente substituídos pelas fotografias oficiais sem interrupção de serviço.

---

## 9. Inventário Técnico dos 92 Produtos do Catálogo MC

Mapeamento detalhado de cada produto, sua referência de imagem original preservada e o nome sugerido de arquivo para preparação pelos operadores:

| # | SKU | Nome do Produto | URL / Referência Original | Status Atual | Arquivo Sugerido |
| :---: | :---: | :--- | :--- | :---: | :---: |
| 1 | `BR090` | BROCA HSS AÇO RÁPIDO - #9,5X125MM | `https://oysznehftuovxchrfmfx.supabase.co/storage/v1/object/public/product-images/products/f50a7177-6b66-441c-992b-f18a209df38c.jpg` | Referência original preservada — origem V1 atualmente indisponível/pausada | `br090.[jpg|png|webp]` |
| 2 | `RB008` | REBOLO CONICO MINI #120 | `https://oysznehftuovxchrfmfx.supabase.co/storage/v1/object/public/product-images/seed/rebolos-conico-rebaixo-reto.jpg` | Referência original preservada — origem V1 atualmente indisponível/pausada | `rb008.[jpg|png|webp]` |
| 3 | `BR076` | BROCA HSS AÇO RÁPIDO - #3,5X70MM | `https://oysznehftuovxchrfmfx.supabase.co/storage/v1/object/public/product-images/seed/broca-hss-aco-rapido.jpg` | Referência original preservada — origem V1 atualmente indisponível/pausada | `br076.[jpg|png|webp]` |
| 4 | `FL004` | FLAP 115MM (T29) GRÃO #40 (K) | `https://oysznehftuovxchrfmfx.supabase.co/storage/v1/object/public/product-images/seed/disco-flap.jpg` | Referência original preservada — origem V1 atualmente indisponível/pausada | `fl004.[jpg|png|webp]` |
| 5 | `BR043` | BROCA CHATA - #3/8 | `https://oysznehftuovxchrfmfx.supabase.co/storage/v1/object/public/product-images/seed/broca-chata-para-madeira.jpg` | Referência original preservada — origem V1 atualmente indisponível/pausada | `br043.[jpg|png|webp]` |
| 6 | `DS013` | DISCO DIAMANTADO TURBO REDE PORCELANATO C/ FLANGE 110MM | `https://oysznehftuovxchrfmfx.supabase.co/storage/v1/object/public/product-images/seed/disco-turbo-rede-porcelanato.jpg` | Referência original preservada — origem V1 atualmente indisponível/pausada | `ds013.[jpg|png|webp]` |
| 7 | `PR002` | PROTETOR AURICULAR PLUG SILICONE DELTAPLUS | `https://oysznehftuovxchrfmfx.supabase.co/storage/v1/object/public/product-images/seed/protetor-auricular-de-silicone.jpg` | Referência original preservada — origem V1 atualmente indisponível/pausada | `pr002.[jpg|png|webp]` |
| 8 | `FL002` | FLAP 115MM (T29) GRÃO #80 (K) | `https://oysznehftuovxchrfmfx.supabase.co/storage/v1/object/public/product-images/seed/disco-flap.jpg` | Referência original preservada — origem V1 atualmente indisponível/pausada | `fl002.[jpg|png|webp]` |
| 9 | `FL003` | FLAP 115MM (T29) GRÃO #100 (K) | `https://oysznehftuovxchrfmfx.supabase.co/storage/v1/object/public/product-images/seed/disco-flap.jpg` | Referência original preservada — origem V1 atualmente indisponível/pausada | `fl003.[jpg|png|webp]` |
| 10 | `BR087` | BROCA HSS AÇO RÁPIDO - #8,0X117MM | `https://oysznehftuovxchrfmfx.supabase.co/storage/v1/object/public/product-images/seed/broca-hss-aco-rapido.jpg` | Referência original preservada — origem V1 atualmente indisponível/pausada | `br087.[jpg|png|webp]` |
| 11 | `SR001` | SERRA ALMA SILENCIOSA OURO 350MM | `https://oysznehftuovxchrfmfx.supabase.co/storage/v1/object/public/product-images/seed/serra-ouro-silenciosa-350mm.jpg` | Referência original preservada — origem V1 atualmente indisponível/pausada | `sr001.[jpg|png|webp]` |
| 12 | `AV002` | AVENTAL BIDIM 1,20X0,70M | `https://oysznehftuovxchrfmfx.supabase.co/storage/v1/object/public/product-images/seed/avental-1-20-x-0-70.jpg` | Referência original preservada — origem V1 atualmente indisponível/pausada | `av002.[jpg|png|webp]` |
| 13 | `SR020` | SERRA WIDEA P/ MADEIRA 110MM | `https://oysznehftuovxchrfmfx.supabase.co/storage/v1/object/public/product-images/seed/serras-widea-110mm-e-185mm.jpg` | Referência original preservada — origem V1 atualmente indisponível/pausada | `sr020.[jpg|png|webp]` |
| 14 | `SP009` | SUPORTE DE LIXA S/VELCRO RÍGIDO 7/180MM | `https://oysznehftuovxchrfmfx.supabase.co/storage/v1/object/public/product-images/seed/suporte-de-lixa-s-velcro-rigido.jpg` | Referência original preservada — origem V1 atualmente indisponível/pausada | `sp009.[jpg|png|webp]` |
| 15 | `LX057` | LIXA DURITE - #120 | `https://oysznehftuovxchrfmfx.supabase.co/storage/v1/object/public/product-images/seed/lixa-durit.jpg` | Referência original preservada — origem V1 atualmente indisponível/pausada | `lx057.[jpg|png|webp]` |
| 16 | `LX003` | LIXA 5 PASSOS #3 METAL | `https://oysznehftuovxchrfmfx.supabase.co/storage/v1/object/public/product-images/seed/lixa-diamantada-5-passos.jpg` | Referência original preservada — origem V1 atualmente indisponível/pausada | `lx003.[jpg|png|webp]` |
| 17 | `BR019` | BROCA DIAMANTADA 8MM | `https://oysznehftuovxchrfmfx.supabase.co/storage/v1/object/public/product-images/seed/broca-ceramica-porcelanato.jpg` | Referência original preservada — origem V1 atualmente indisponível/pausada | `br019.[jpg|png|webp]` |
| 18 | `SP015` | SUPORTE DE PLÁSTICO P/ LIXA DE ÁGUA | `https://oysznehftuovxchrfmfx.supabase.co/storage/v1/object/public/product-images/products/46be30c1-0211-4edd-9357-429cef6e35aa.jpg` | Referência original preservada — origem V1 atualmente indisponível/pausada | `sp015.[jpg|png|webp]` |
| 19 | `LX061` | LIXA FLOWER #1 | `https://oysznehftuovxchrfmfx.supabase.co/storage/v1/object/public/product-images/seed/lixa-flower-3-passos.jpg` | Referência original preservada — origem V1 atualmente indisponível/pausada | `lx061.[jpg|png|webp]` |
| 20 | `SP014` | SUPORTE DE ESPUMA COM VELCRO 100MM | `https://oysznehftuovxchrfmfx.supabase.co/storage/v1/object/public/product-images/seed/suporte-de-espuma-com-velcro.jpg` | Referência original preservada — origem V1 atualmente indisponível/pausada | `sp014.[jpg|png|webp]` |
| 21 | `MF006` | MÃO FRANCESA - #50CM | `https://oysznehftuovxchrfmfx.supabase.co/storage/v1/object/public/product-images/seed/mao-francesa.jpg` | Referência original preservada — origem V1 atualmente indisponível/pausada | `mf006.[jpg|png|webp]` |
| 22 | `VE080` | VENTOSA TITANIUM 80KG | `https://oysznehftuovxchrfmfx.supabase.co/storage/v1/object/public/product-images/seed/ventosa-titanium-80kg.jpg` | Referência original preservada — origem V1 atualmente indisponível/pausada | `ve080.[jpg|png|webp]` |
| 23 | `BR098` | BROCA P/ FIBROCIMENTO E MOURÃO AÇO RÁPIDO - #5/16X280MM | `https://oysznehftuovxchrfmfx.supabase.co/storage/v1/object/public/product-images/seed/broca-para-fibrocimento-e-mourao.jpg` | Referência original preservada — origem V1 atualmente indisponível/pausada | `br098.[jpg|png|webp]` |
| 24 | `PR001` | PROTETOR AUDITIVO TIPO PLUG SILICONE | `https://oysznehftuovxchrfmfx.supabase.co/storage/v1/object/public/product-images/seed/protetor-auricular-de-silicone.jpg` | Referência original preservada — origem V1 atualmente indisponível/pausada | `pr001.[jpg|png|webp]` |
| 25 | `MA005` | MARTELO DE BORRACHA PRETO 60MM | `https://oysznehftuovxchrfmfx.supabase.co/storage/v1/object/public/product-images/seed/martelo-de-borracha.jpg` | Referência original preservada — origem V1 atualmente indisponível/pausada | `ma005.[jpg|png|webp]` |
| 26 | `BR018` | BROCA DIAMANTADA 80MM | `https://oysznehftuovxchrfmfx.supabase.co/storage/v1/object/public/product-images/seed/broca-ceramica-porcelanato.jpg` | Referência original preservada — origem V1 atualmente indisponível/pausada | `br018.[jpg|png|webp]` |
| 27 | `BR051` | BROCA DE VIDEA - #12X150MM | `https://oysznehftuovxchrfmfx.supabase.co/storage/v1/object/public/product-images/products/7753b984-9f1d-4447-ba79-64e5d633c614.jpg` | Referência original preservada — origem V1 atualmente indisponível/pausada | `br051.[jpg|png|webp]` |
| 28 | `BR016` | BROCA DIAMANTADA 60MM | `https://oysznehftuovxchrfmfx.supabase.co/storage/v1/object/public/product-images/seed/broca-ceramica-porcelanato.jpg` | Referência original preservada — origem V1 atualmente indisponível/pausada | `br016.[jpg|png|webp]` |
| 29 | `GZ002` | GIZ DE MARCAÇÃO VERMELHO 12UN | `https://oysznehftuovxchrfmfx.supabase.co/storage/v1/object/public/product-images/products/697690a8-e009-4a38-b164-b93e802e5d6f.jpg` | Referência original preservada — origem V1 atualmente indisponível/pausada | `gz002.[jpg|png|webp]` |
| 30 | `BR031` | BROCA CERAMICA/PORCELANATO 50MM | `https://oysznehftuovxchrfmfx.supabase.co/storage/v1/object/public/product-images/seed/broca-ceramica-porcelanato.jpg` | Referência original preservada — origem V1 atualmente indisponível/pausada | `br031.[jpg|png|webp]` |
| 31 | `SP008` | SUPORTE DE LIXA S/VELCRO FLEXÍVEL 7/180MM | `https://oysznehftuovxchrfmfx.supabase.co/storage/v1/object/public/product-images/seed/suporte-de-lixa-s-velcro-flexivel.jpg` | Referência original preservada — origem V1 atualmente indisponível/pausada | `sp008.[jpg|png|webp]` |
| 32 | `CU010` | CUBA GOURMET 50X40 C/ ACESSÓRIOS | `https://oysznehftuovxchrfmfx.supabase.co/storage/v1/object/public/product-images/seed/cuba-gourmet-5040.jpg` | Referência original preservada — origem V1 atualmente indisponível/pausada | `cu010.[jpg|png|webp]` |
| 33 | `BR055` | BROCA DE VIDEA - #8X120MM | `https://oysznehftuovxchrfmfx.supabase.co/storage/v1/object/public/product-images/seed/broca-de-videa.jpg` | Referência original preservada — origem V1 atualmente indisponível/pausada | `br055.[jpg|png|webp]` |
| 34 | `BR021` | BROCA CERAMICA/PORCELANATO 100MM | `https://oysznehftuovxchrfmfx.supabase.co/storage/v1/object/public/product-images/seed/broca-ceramica-porcelanato.jpg` | Referência original preservada — origem V1 atualmente indisponível/pausada | `br021.[jpg|png|webp]` |
| 35 | `BR027` | BROCA CERAMICA/PORCELANATO 32MM | `https://oysznehftuovxchrfmfx.supabase.co/storage/v1/object/public/product-images/seed/broca-ceramica-porcelanato.jpg` | Referência original preservada — origem V1 atualmente indisponível/pausada | `br027.[jpg|png|webp]` |
| 36 | `DS008` | DISCO DIAMANTADO SEGMENTADO OURO 115MM | `https://oysznehftuovxchrfmfx.supabase.co/storage/v1/object/public/product-images/seed/disco-segmentado-ouro.jpg` | Referência original preservada — origem V1 atualmente indisponível/pausada | `ds008.[jpg|png|webp]` |
| 37 | `CU011` | CUBA GOURMET 60X42 C/ ACESSORIOS | `https://oysznehftuovxchrfmfx.supabase.co/storage/v1/object/public/product-images/seed/cuba-gourmet-6042.jpg` | Referência original preservada — origem V1 atualmente indisponível/pausada | `cu011.[jpg|png|webp]` |
| 38 | `BR060` | BROCA DE VIDEA DE ENCAIXE SDS PLUS - #24X350MM | `https://oysznehftuovxchrfmfx.supabase.co/storage/v1/object/public/product-images/seed/broca-de-videa-sds-plus.jpg` | Referência original preservada — origem V1 atualmente indisponível/pausada | `br060.[jpg|png|webp]` |
| 39 | `AP002` | APLICADOR REFORÇADO DE SILICONE | `https://oysznehftuovxchrfmfx.supabase.co/storage/v1/object/public/product-images/seed/silicone-profissional-incolor-280g.jpg` | Referência original preservada — origem V1 atualmente indisponível/pausada | `ap002.[jpg|png|webp]` |
| 40 | `FL001` | FLAP 115MM (T29) GRÃO #120 (K) | `https://oysznehftuovxchrfmfx.supabase.co/storage/v1/object/public/product-images/products/52018a30-cc3b-41b5-b8c2-5579016ad95a.jpg` | Referência original preservada — origem V1 atualmente indisponível/pausada | `fl001.[jpg|png|webp]` |
| 41 | `RV001` | REVITALIZADOR DE PEDRA INCOLOR ARGACOLOR 900ML | `https://oysznehftuovxchrfmfx.supabase.co/storage/v1/object/public/product-images/seed/revitalizador-argacolor-incolor.jpg` | Referência original preservada — origem V1 atualmente indisponível/pausada | `rv001.[jpg|png|webp]` |
| 42 | `BR100` | BROCA PARA MADEIRA 3 PONTAS - #3X60MM | `https://oysznehftuovxchrfmfx.supabase.co/storage/v1/object/public/product-images/seed/broca-para-madeira-3-pontas.jpg` | Referência original preservada — origem V1 atualmente indisponível/pausada | `br100.[jpg|png|webp]` |
| 43 | `VE001` | VENTOSA DUPLA ARTICULADA 90° | `https://oysznehftuovxchrfmfx.supabase.co/storage/v1/object/public/product-images/seed/ventosa-articulada-90.jpg` | Referência original preservada — origem V1 atualmente indisponível/pausada | `ve001.[jpg|png|webp]` |
| 44 | `DS015` | DISCO DIAMANTADO TURBO VINHO 110MM | `https://oysznehftuovxchrfmfx.supabase.co/storage/v1/object/public/product-images/seed/disco-turbo-wine-pro.jpg` | Referência original preservada — origem V1 atualmente indisponível/pausada | `ds015.[jpg|png|webp]` |
| 45 | `SL003` | SILICONE PROFISSIONAL INCOLOR 280G | `https://oysznehftuovxchrfmfx.supabase.co/storage/v1/object/public/product-images/seed/silicone-profissional-incolor-280g.jpg` | Referência original preservada — origem V1 atualmente indisponível/pausada | `sl003.[jpg|png|webp]` |
| 46 | `BR079` | BROCA HSS AÇO RÁPIDO - #4,0X75MM | `https://oysznehftuovxchrfmfx.supabase.co/storage/v1/object/public/product-images/seed/broca-hss-aco-rapido.jpg` | Referência original preservada — origem V1 atualmente indisponível/pausada | `br079.[jpg|png|webp]` |
| 47 | `EC001` | ESCOVA ABRASIVA DE CARBETO - #120 | `https://oysznehftuovxchrfmfx.supabase.co/storage/v1/object/public/product-images/seed/escova-abrasiva-de-carbeto.jpg` | Referência original preservada — origem V1 atualmente indisponível/pausada | `ec001.[jpg|png|webp]` |
| 48 | `BR003` | BROCA DIAMANTADA 110MM | `https://oysznehftuovxchrfmfx.supabase.co/storage/v1/object/public/product-images/seed/broca-ceramica-porcelanato.jpg` | Referência original preservada — origem V1 atualmente indisponível/pausada | `br003.[jpg|png|webp]` |
| 49 | `MA004` | MARTELO CABO FIBRA 25MM | `https://oysznehftuovxchrfmfx.supabase.co/storage/v1/object/public/product-images/products/833fc982-fb65-4f94-912d-fa382432e338.jpg` | Referência original preservada — origem V1 atualmente indisponível/pausada | `ma004.[jpg|png|webp]` |
| 50 | `SP002` | SUPORTE DE LIXA C/ VELCRO BORRACHA RÍGIDO 4 | `https://oysznehftuovxchrfmfx.supabase.co/storage/v1/object/public/product-images/seed/suporte-de-lixa-c-velcro-borracha-rigida.jpg` | Referência original preservada — origem V1 atualmente indisponível/pausada | `sp002.[jpg|png|webp]` |
| 51 | `RB004` | REBOLO CÔNICO 4 | `https://oysznehftuovxchrfmfx.supabase.co/storage/v1/object/public/product-images/seed/rebolos-conico-rebaixo-reto.jpg` | Referência original preservada — origem V1 atualmente indisponível/pausada | `rb004.[jpg|png|webp]` |
| 52 | `RB006` | REBOLO CÔNICO 4 | `https://oysznehftuovxchrfmfx.supabase.co/storage/v1/object/public/product-images/seed/rebolos-conico-rebaixo-reto.jpg` | Referência original preservada — origem V1 atualmente indisponível/pausada | `rb006.[jpg|png|webp]` |
| 53 | `BR023` | BROCA CERAMICA/PORCELANATO 15MM | `https://oysznehftuovxchrfmfx.supabase.co/storage/v1/object/public/product-images/seed/broca-ceramica-porcelanato.jpg` | Referência original preservada — origem V1 atualmente indisponível/pausada | `br023.[jpg|png|webp]` |
| 54 | `BR002` | BROCA DIAMANTADA 10MM | `https://oysznehftuovxchrfmfx.supabase.co/storage/v1/object/public/product-images/seed/broca-ceramica-porcelanato.jpg` | Referência original preservada — origem V1 atualmente indisponível/pausada | `br002.[jpg|png|webp]` |
| 55 | `BR017` | BROCA DIAMANTADA 6MM | `https://oysznehftuovxchrfmfx.supabase.co/storage/v1/object/public/product-images/products/b3403591-c2bc-42bb-93da-1017f1c0491c.jpg` | Referência original preservada — origem V1 atualmente indisponível/pausada | `br017.[jpg|png|webp]` |
| 56 | `BR024` | BROCA CERAMICA/PORCELANATO 20MM | `https://oysznehftuovxchrfmfx.supabase.co/storage/v1/object/public/product-images/products/026694e6-7b36-498a-b853-702628c313b4.jpg` | Referência original preservada — origem V1 atualmente indisponível/pausada | `br024.[jpg|png|webp]` |
| 57 | `DS016` | DISCO SEGMENTADO 115X20 SUPER PRO | `https://oysznehftuovxchrfmfx.supabase.co/storage/v1/object/public/product-images/seed/disco-segmentado-super-pro.jpg` | Referência original preservada — origem V1 atualmente indisponível/pausada | `ds016.[jpg|png|webp]` |
| 58 | `SP004` | SUPORTE DE LIXA C/ VELCRO PVC C/ ESPUMA 4/100MM | `https://oysznehftuovxchrfmfx.supabase.co/storage/v1/object/public/product-images/seed/suporte-de-lixa-c-velcro-pvc-c-espuma.jpg` | Referência original preservada — origem V1 atualmente indisponível/pausada | `sp004.[jpg|png|webp]` |
| 59 | `MF005` | MÃO FRANCESA - #45CM | `https://oysznehftuovxchrfmfx.supabase.co/storage/v1/object/public/product-images/seed/mao-francesa.jpg` | Referência original preservada — origem V1 atualmente indisponível/pausada | `mf005.[jpg|png|webp]` |
| 60 | `BR107` | BROCA VIDEA LONGA - 10X350MM | `https://oysznehftuovxchrfmfx.supabase.co/storage/v1/object/public/product-images/seed/broca-de-videa-longa.jpg` | Referência original preservada — origem V1 atualmente indisponível/pausada | `br107.[jpg|png|webp]` |
| 61 | `BR070` | BROCA HSS AÇO RÁPIDO - #12,0X151MM | `https://oysznehftuovxchrfmfx.supabase.co/storage/v1/object/public/product-images/seed/broca-hss-aco-rapido.jpg` | Referência original preservada — origem V1 atualmente indisponível/pausada | `br070.[jpg|png|webp]` |
| 62 | `BR040` | BROCA CHATA - #1/2 | `https://oysznehftuovxchrfmfx.supabase.co/storage/v1/object/public/product-images/seed/broca-chata-para-madeira.jpg` | Referência original preservada — origem V1 atualmente indisponível/pausada | `br040.[jpg|png|webp]` |
| 63 | `SG002` | SARGENTO 4 | `https://oysznehftuovxchrfmfx.supabase.co/storage/v1/object/public/product-images/seed/sargento-4.jpg` | Referência original preservada — origem V1 atualmente indisponível/pausada | `sg002.[jpg|png|webp]` |
| 64 | `BR004` | BROCA DIAMANTADA 120MM | `https://oysznehftuovxchrfmfx.supabase.co/storage/v1/object/public/product-images/seed/broca-ceramica-porcelanato.jpg` | Referência original preservada — origem V1 atualmente indisponível/pausada | `br004.[jpg|png|webp]` |
| 65 | `TQ001` | TANQUE INOX 40X34X20 AÇO 430 | `https://oysznehftuovxchrfmfx.supabase.co/storage/v1/object/public/product-images/products/42df2430-de81-477e-befe-26e46dd24213.jpg` | Referência original preservada — origem V1 atualmente indisponível/pausada | `tq001.[jpg|png|webp]` |
| 66 | `CU006` | CUBA 56X34X14 AÇO 430 | `https://oysznehftuovxchrfmfx.supabase.co/storage/v1/object/public/product-images/seed/cuba-563414.jpg` | Referência original preservada — origem V1 atualmente indisponível/pausada | `cu006.[jpg|png|webp]` |
| 67 | `BR065` | BROCA ESCALONADA HSS 4-32MM | `https://oysznehftuovxchrfmfx.supabase.co/storage/v1/object/public/product-images/seed/broca-escalonada-hss.jpg` | Referência original preservada — origem V1 atualmente indisponível/pausada | `br065.[jpg|png|webp]` |
| 68 | `MP001` | MASSA GEL INCOLOR 500G MARMOFIX | `https://oysznehftuovxchrfmfx.supabase.co/storage/v1/object/public/product-images/seed/marmofix-cola-plastica-em-gel.jpg` | Referência original preservada — origem V1 atualmente indisponível/pausada | `mp001.[jpg|png|webp]` |
| 69 | `SR003` | SERRA MARMOGLAS 350MM | `https://oysznehftuovxchrfmfx.supabase.co/storage/v1/object/public/product-images/seed/serra-marmoglass-ultra-compacto-350mm.jpg` | Referência original preservada — origem V1 atualmente indisponível/pausada | `sr003.[jpg|png|webp]` |
| 70 | `BR015` | BROCA DIAMANTADA 50MM | `https://oysznehftuovxchrfmfx.supabase.co/storage/v1/object/public/product-images/seed/broca-ceramica-porcelanato.jpg` | Referência original preservada — origem V1 atualmente indisponível/pausada | `br015.[jpg|png|webp]` |
| 71 | `NV001` | NIVEL DE ALUMINIO MANUAL 3 BOLHAS 12P | `https://oysznehftuovxchrfmfx.supabase.co/storage/v1/object/public/product-images/products/9ccb531d-e31e-408c-a50c-12e709ffef5e.jpg` | Referência original preservada — origem V1 atualmente indisponível/pausada | `nv001.[jpg|png|webp]` |
| 72 | `TA001` | TORQUES ARMADOR 10P (25CM) | `https://oysznehftuovxchrfmfx.supabase.co/storage/v1/object/public/product-images/products/a2b58b7a-8645-4548-b18c-68347315fb5a.jpg` | Referência original preservada — origem V1 atualmente indisponível/pausada | `ta001.[jpg|png|webp]` |
| 73 | `SR002` | SERRA ALMA SILENCIOSA PRÓ 350MM | `https://oysznehftuovxchrfmfx.supabase.co/storage/v1/object/public/product-images/seed/serra-alma-silenciosa-pro-350mm.jpg` | Referência original preservada — origem V1 atualmente indisponível/pausada | `sr002.[jpg|png|webp]` |
| 74 | `LA001` | LAPIS PARA CARPINTEIRO | `https://oysznehftuovxchrfmfx.supabase.co/storage/v1/object/public/product-images/seed/lapis-para-carpinteiro.jpg` | Referência original preservada — origem V1 atualmente indisponível/pausada | `la001.[jpg|png|webp]` |
| 75 | `BR014` | BROCA DIAMANTADA 45MM | `https://oysznehftuovxchrfmfx.supabase.co/storage/v1/object/public/product-images/seed/broca-ceramica-porcelanato.jpg` | Referência original preservada — origem V1 atualmente indisponível/pausada | `br014.[jpg|png|webp]` |
| 76 | `LX029` | LIXA DIAMANTADA HÍBRIDA - #50 | `https://oysznehftuovxchrfmfx.supabase.co/storage/v1/object/public/product-images/seed/lixa-hibrida-50-a-3000.jpg` | Referência original preservada — origem V1 atualmente indisponível/pausada | `lx029.[jpg|png|webp]` |
| 77 | `CU002` | CUBA 40X34X14 AÇO 430 | `https://oysznehftuovxchrfmfx.supabase.co/storage/v1/object/public/product-images/seed/cuba-403414.jpg` | Referência original preservada — origem V1 atualmente indisponível/pausada | `cu002.[jpg|png|webp]` |
| 78 | `CU015` | CUBA REDONDA 30CM AÇO 430 | `https://oysznehftuovxchrfmfx.supabase.co/storage/v1/object/public/product-images/seed/cuba-redonda-30-cm.jpg` | Referência original preservada — origem V1 atualmente indisponível/pausada | `cu015.[jpg|png|webp]` |
| 79 | `CU009` | CUBA DE LOUÇA OVAL INCEPA 39X30 | `https://oysznehftuovxchrfmfx.supabase.co/storage/v1/object/public/product-images/seed/cuba-oval-incepa-3930.jpg` | Referência original preservada — origem V1 atualmente indisponível/pausada | `cu009.[jpg|png|webp]` |
| 80 | `VL001` | VÁLVULA INOX 3 1/2 | `https://oysznehftuovxchrfmfx.supabase.co/storage/v1/object/public/product-images/seed/valvula-inox-3-1-2.jpg` | Referência original preservada — origem V1 atualmente indisponível/pausada | `vl001.[jpg|png|webp]` |
| 81 | `TQ002` | TANQUE 40X40X20 AÇO 304 | `https://oysznehftuovxchrfmfx.supabase.co/storage/v1/object/public/product-images/tanque-em-inox-404020cm.jpg` | Referência original preservada — origem V1 atualmente indisponível/pausada | `tq002.[jpg|png|webp]` |
| 82 | `CU014` | CUBA REDONDA 25CM AÇO 304 | `https://oysznehftuovxchrfmfx.supabase.co/storage/v1/object/public/product-images/seed/cuba-redonda-25-cm.jpg` | Referência original preservada — origem V1 atualmente indisponível/pausada | `cu014.[jpg|png|webp]` |
| 83 | `CV001` | CARVÃO PARA LIXADEIRA (IMPORTADA) | `https://oysznehftuovxchrfmfx.supabase.co/storage/v1/object/public/product-images/seed/carvao-para-lixadeira.jpg` | Referência original preservada — origem V1 atualmente indisponível/pausada | `cv001.[jpg|png|webp]` |
| 84 | `EC020` | ESCOVA DE AÇO CIRCULAR TRANÇADA 5X1/2 | `https://oysznehftuovxchrfmfx.supabase.co/storage/v1/object/public/product-images/seed/escova-circular-trancada-5-x-1-2.jpg` | Referência original preservada — origem V1 atualmente indisponível/pausada | `ec020.[jpg|png|webp]` |
| 85 | `IM001` | IMPERMEABILIZANTE OLEOFUGANTE H2OFF 900ML | `https://oysznehftuovxchrfmfx.supabase.co/storage/v1/object/public/product-images/seed/impermeabilizante-h2off.jpg` | Referência original preservada — origem V1 atualmente indisponível/pausada | `im001.[jpg|png|webp]` |
| 86 | `DS020` | DISCO DE CORTE P/ AÇO INOX 9 | `https://oysznehftuovxchrfmfx.supabase.co/storage/v1/object/public/product-images/seed/disco-de-corte-para-aco-e-inox.jpg` | Referência original preservada — origem V1 atualmente indisponível/pausada | `ds020.[jpg|png|webp]` |
| 87 | `CH001` | CHAVE HIDRAULICA MULTIFUNCIONAL 10 | `https://oysznehftuovxchrfmfx.supabase.co/storage/v1/object/public/product-images/seed/chave-hidraulica-10-250mm.jpg` | Referência original preservada — origem V1 atualmente indisponível/pausada | `ch001.[jpg|png|webp]` |
| 88 | `TR002` | TRENA 5MX25MM C/ 3 TRAVAS SEM BLISTER | `https://oysznehftuovxchrfmfx.supabase.co/storage/v1/object/public/product-images/seed/trena-5-metros.jpg` | Referência original preservada — origem V1 atualmente indisponível/pausada | `tr002.[jpg|png|webp]` |
| 89 | `PB001` | POLIBRILHO REVITALIZADOR PEDRAS ESCURAS 900ML | `https://oysznehftuovxchrfmfx.supabase.co/storage/v1/object/public/product-images/seed/revitalizador-argacolor-incolor.jpg` | Referência original preservada — origem V1 atualmente indisponível/pausada | `pb001.[jpg|png|webp]` |
| 90 | `PU001` | PU BRANCO ARGACON 400G | `https://oysznehftuovxchrfmfx.supabase.co/storage/v1/object/public/product-images/seed/pu-branco-argacon.jpg` | Referência original preservada — origem V1 atualmente indisponível/pausada | `pu001.[jpg|png|webp]` |
| 91 | `DS018` | DISCO DE CORTE P/ AÇO INOX 4,5 | `https://oysznehftuovxchrfmfx.supabase.co/storage/v1/object/public/product-images/seed/disco-de-corte-para-aco-e-inox.jpg` | Referência original preservada — origem V1 atualmente indisponível/pausada | `ds018.[jpg|png|webp]` |
| 92 | `CH003` | CHAVE INGLESA 12 (30CM) | `https://oysznehftuovxchrfmfx.supabase.co/storage/v1/object/public/product-images/seed/chave-inglesa.jpg` | Referência original preservada — origem V1 atualmente indisponível/pausada | `ch003.[jpg|png|webp]` |

---

## 10. Procedimentos para Novos Tenants

Ao integrar uma nova distribuidora ou marca no sistema SaaS multi-tenant:

1. **Provisionamento do Tenant:** Criação do isolamento na pasta `{tenant_id}/` no bucket `product-images`.
2. **Template de Cadastro:** O tenant recebe a planilha de cadastro com identificador SKU único.
3. **Upload de Imagens:** Ingestão de fotos nomeadas pelo SKU para associação automática ao `product_id`.
4. **Validação e Armazenamento:** Sanitização, geração de UUID para o arquivo e persistência segura no Storage V2.
