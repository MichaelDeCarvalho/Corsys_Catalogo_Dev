# RELEASE CHECKLIST — Corsys.Catálogo

Use conforme o escopo da mudança. Um item não aplicável deve ser marcado como N/A; não transforme item não testado em PASS.

## Código
- [ ] `bun run lint`
- [ ] `bun run test:regression`
- [ ] `bun run build`
- [ ] Diff revisado
- [ ] Sem arquivos temporários ou dados sensíveis versionados

## Banco / Supabase
- [ ] Nenhuma migration aplicada/congelada foi editada retroativamente
- [ ] Nova migration é forward-only e versionada, quando aplicável
- [ ] RLS/grants revisados
- [ ] Cenários não autenticado, sem permissão e cross-tenant testados quando aplicável
- [ ] Rollback/forward-fix definido
- [ ] Edge Functions alteradas foram validadas em ambiente apropriado

## Segurança
- [ ] Autenticação permanece fail-closed
- [ ] Autorização server-side determinística
- [ ] Least privilege mantido
- [ ] Nenhum secret em frontend, bundle, logs ou repositório
- [ ] Inputs e payload limits revisados
- [ ] Storage/upload revisado quando aplicável
- [ ] Logs não contêm PII/secrets

## Frontend / Cloudflare
- [ ] SPA abre e rotas internas sobrevivem a refresh
- [ ] Assets carregam corretamente
- [ ] Console sem erro crítico conhecido
- [ ] Variáveis `VITE_*` tratadas como públicas
- [ ] `wrangler.jsonc` alterado somente com necessidade comprovada
- [ ] Deploy técnico validado antes de domínio/DNS

## GitHub / CI
- [ ] PR revisado
- [ ] Workflow de qualidade concluído
- [ ] Actions com permissões mínimas
- [ ] Nenhum secret de produção exposto à CI de PR
- [ ] Merge em `main` considerado como potencial gatilho de deploy Cloudflare

## Documentação
- [ ] ADR atualizado/criado quando necessário
- [ ] `PROJECT_CONTEXT.md` atualizado quando o estado do sistema mudou
- [ ] `CURRENT_ARCHITECTURE.md` atualizado quando a arquitetura mudou
- [ ] `SECURITY_REGISTER.md` atualizado para novos riscos/controles
- [ ] `SESSION_HANDOFF.md` atualizado com estado e próxima ação

## Resultado
- [ ] PASS
- [ ] BLOCKED — motivo registrado
