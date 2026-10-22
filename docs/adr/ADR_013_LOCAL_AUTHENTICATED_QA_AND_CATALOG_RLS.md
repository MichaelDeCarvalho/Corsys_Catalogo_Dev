# ADR 013 — QA autenticado local e controles de catálogo

Data: 2026-10-10. Status: implementado na branch de revisão; sem aplicação Hosted.

## Evidência e decisão

O Supabase local gratuito, autorizado pelo usuário, executou schema real e Auth real com fixtures fictícias. A consulta autenticada à view pública retornava zero produtos para um comprador sem vínculo de equipe; a mesma consulta anon retornava o catálogo. O storefront passa a usar um cliente exclusivo sem sessão para as projeções públicas. Catálogo B2B e checkout continuam usando a sessão do comprador e autorização server-side. Não conceder SELECT amplo em products a compradores para resolver o problema.

A suíte SQL falhava ao arquivar um produto próprio: a policy SELECT escondia a nova linha com deleted_at preenchido. A migration 000020 permite ao tenant_admin ler os produtos arquivados do próprio tenant. Não amplia acesso de estoquistas, vendedores ou outros tenants. A migração também remove leitura pública de wholesale_tiers, cujas linhas contêm preços B2B e contornavam o gateway de aprovação. Políticas de equipe e gestão permanecem. Atualizações de matriz RLS neste ADR prevalecem sobre as tabelas legadas que descrevem tiers como públicos.

000019 não foi reutilizada: corresponde ao trabalho de entrega ainda não publicado no checkout original. Não incluir esse rascunho nem alterar seu escopo.

O frontend exige HTTPS nos recibos em produção. Em desenvolvimento Vite permite exclusivamente o origin HTTP 127.0.0.1 configurado para Supabase e o caminho de assinatura order-documents; testes rejeitam outro host, porta, caminho e credenciais na URL. A cópia local da Edge Function adapta o hostname interno kong:8000 para 127.0.0.1:54321. Essa adaptação é somente fixture do ambiente, não parte do gateway publicado.

## Limites e operação

Rancher Desktop Moby, Kubernetes e telemetria desativados. Rede Docker própria com portas publicadas somente em 127.0.0.1. Sem vínculo Hosted, sem import de catálogo comercial, sem mensagens enviadas. Migrations 000002/000003 adaptadas apenas na cópia QA para bootstrap fictício; estrutura das demais preservada. Testes SQL rodam em transações e rollback; sequência de pedidos pode avançar.

Antes de publicar: revisar diff e CI atualizado, verificar impacto da leitura privada de tiers e aplicar migration 000020 antes de declarar a proteção presente no Hosted. Produção ainda possui políticas anteriores até uma implantação autorizada. Rollback de tiers não deve restaurar divulgação pública de preços B2B. Itens 5/6 e integração de distância permanecem sujeitos à validação funcional, sem custo autorizado.
