# ADR 012 — Configuração de campos do checkout por tenant

Data: 2026-10-08. Escopo: Item 4 exclusivamente.

## Problema
O formulário fixo solicita todos os campos, enquanto lojas precisam ocultar informações opcionais ou exigir dados adicionais. Uma configuração apenas no navegador não protege a persistência do pedido.

## Decisão
Adicionar `tenant_public_settings.checkout_fields`, JSONB com allowlist completa de 14 campos e exatamente `{visible:boolean, required:boolean}` por campo. O padrão mantém o formulário existente: todos visíveis, nome/telefone/documento/logradouro obrigatórios. Esses quatro campos permanecem fixos nesta versão para preservar os contratos do gateway, identificação e endereço. Pagamento, entrega, modalidade e identidade B2B não são configuráveis. Não há campos livres, scripts, rótulos editáveis ou regras financeiras.

Campos configuráveis: `companyName`, `email`, `number`, `complement`, `neighborhood`, `city`, `state`, `zipCode`, `notes`, `sellerCode`. Razão social configurável aplica-se exclusivamente ao varejo PJ; o atacado mantém identidade oficial do cadastro aprovado. E-mail operacional obrigatório exige entrada no checkout em ambas as modalidades; quando oculto, o e-mail não é persistido, inclusive via fallback do cadastro B2B. Telefone operacional B2B continua opcional com fallback oficial.

O CHECK valida chaves, tipos booleanos, `required => visible` e campos fixos. Grant de UPDATE somente para a nova coluna; RLS existente mantém tenant_admin do mesmo tenant e platform_admin. Nenhuma policy ampliada. Helper privado é SECURITY INVOKER, immutable e sem leitura de dados. A RPC de checkout continua service-role-only, com search_path vazio e todas as regras anteriores de preço, entrega, estoque, buyer, tracking e idempotência preservadas.

A RPC lê a política persistida, exige valores obrigatórios não vazios e elimina dados ocultos antes do snapshot e da resolução de vendedor. Limites e validação de CPF/CNPJ do gateway permanecem. Repetição idempotente devolve o pedido original antes de aplicar uma política nova. Pedidos históricos não são reescritos. A configuração lida no início da transação vale para aquele pedido; alterações posteriores valem para próximos pedidos.

A administração usa componente separado em Configurações da Loja com tenant UUID do resolvedor oficial do dashboard. Falha de leitura bloqueia edição. UPDATE condicional pelo JSON anterior evita perda silenciosa de alterações concorrentes. Falha de permissão, conflito ou rede não aparece como sucesso. Campos ocultos são também removidos do payload e da revisão no frontend. O catálogo carrega a política ao recarregar; formulário antigo pode receber rejeição server-side se uma exigência mudar.

## Evolução e implantação
Migration 000018 criada via CLI e ordenada após 000017 (prefixos 000016/17 já usam data futura). Migrations 1–17 permanecem byte-equivalentes. Guard de hash verifica a baseline do checkout antes de substituí-lo; drift aborta. Alteração aditiva e transacional, lock_timeout de 5s. Aplicar schema antes de publicar o novo frontend. Defaults preservam clientes antigos. Sem nova Edge Function ou backend paralelo.

Recuperação: restaurar a política padrão por tenant usando edição autorizada; frontend anterior permanece compatível com o schema aditivo. Falhas de schema exigem forward-fix; não usar DOWN nem editar migration aplicada. Antes de reduzir exigências por rollback, registrar a decisão, pois altera a política comercial.

## Verificação
Unitários: parser, chaves/tipos inválidos, PF/PJ/B2B, required e projeção de campos ocultos. Regressão existente mantida; contagem de migrations evolui de 17 para 18. SQL transacional em `02_checkout_fields_test.sql`: constraints, grant/RLS anon/admin/sales/stock/platform/cross-tenant, campos obrigatórios, descarte de ocultos, identidade B2B, preços, estoque e idempotência. Fixtures sintéticas são revertidas; sucessos podem consumir valores da sequence, que não é transacional. CI, Hosted e Cloudflare devem ser registrados no handoff após execução.

Fontes oficiais consultadas: [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [PostgreSQL 17 constraints](https://www.postgresql.org/docs/17/ddl-constraints.html). Changelog markdown indisponível pela ferramenta; nenhuma API ou SDK novo introduzido.
