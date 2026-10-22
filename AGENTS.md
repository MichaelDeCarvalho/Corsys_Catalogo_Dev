# AGENTS.md — Corsys.Catálogo

Este arquivo orienta agentes compatíveis. As fontes canônicas continuam sendo o código e a documentação versionada do projeto.

## Ordem de leitura
1. `docs/PROJECT_CONTEXT.md`
2. `docs/CURRENT_ARCHITECTURE.md`
3. ADRs em `docs/adr/`
4. `docs/SECURITY_REGISTER.md`
5. `docs/SESSION_HANDOFF.md`
6. `docs/engineering/ecc-adoption.md`

## Regras de alteração
- Ler o código e as dependências antes de editar.
- Preservar padrões válidos; fazer a menor mudança segura.
- Não alterar retroativamente migrations aplicadas/congeladas. Evoluções de banco são forward-only.
- Não duplicar backend: Supabase permanece responsável por Auth, PostgreSQL/RLS, Storage e Edge Functions.
- Cloudflare Workers Static Assets permanece responsável pelo frontend; Worker server-side só com necessidade comprovada.
- Secrets são server-side; variáveis `VITE_*` são públicas por definição.
- Autorização crítica deve ser determinística, fail-closed e least privilege.
- Toda mudança multi-tenant deve considerar isolamento cross-tenant e RLS.
- Mudanças relevantes em arquitetura, banco, auth, segurança, deploy ou integrações exigem ADR quando aplicável e atualização dos documentos vivos.
- Não declarar teste, deploy, segurança ou runtime como PASS sem evidência observada.

## Ferramentas e comandos
- Package manager canônico: Bun.
- Desenvolvimento: `bun run dev`
- Typecheck/lint: `bun run lint`
- Regressão: `bun run test:regression`
- Verificação consolidada: `bun run check`
- Build: `bun run build`
- Deploy Cloudflare: `bun run deploy` somente quando autorizado.

## Segurança de entrega
- Trabalhar em branch/PR para mudanças relevantes.
- A CI de qualidade não recebe secrets e usa apenas `contents: read`.
- Não usar `main` como área de teste: ela está ligada ao pipeline de deploy Cloudflare.
- Antes de release, revisar `docs/RELEASE_CHECKLIST.md`.
