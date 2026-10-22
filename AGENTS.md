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

## Protocolo incremental: velocidade com qualidade e segurança

Este protocolo vale para toda continuação do projeto. **Otimizar consultas e contexto, nunca enfraquecer controles, testes ou evidências.**

1. **Retomada por checkpoint:** ler apenas o trecho vigente de `docs/SESSION_HANDOFF.md` e o objetivo do turno. Consultar contexto, arquitetura, ADRs e código **sob demanda**, exclusivamente nas áreas afetadas. O handoff é índice de trabalho, não substitui código nem prova de execução.
2. **Análise por delta:** identificar branch, HEAD, arquivos modificados e diferença desde o último commit comprovadamente validado. Não reabrir decisões ou testes encerrados sem dependência nova, regressão ou indício de risco.
3. **Plano curto e orientado a aceite:** definir a menor alteração segura, risco, critério observável de PASS e teste relevante antes de editar. Para tarefas simples, executar sem planejamento cerimonial.
4. **Consultas e leitura seletivas:** preferir diff, buscas por símbolo, intervalos de linhas e logs do **primeiro passo que falhou** em vez de arquivos, históricos ou logs completos; agrupar chamadas independentes quando possível. Não refazer pesquisa de SDK/API sem mudança de versão, dúvida material ou necessidade de verificar comportamento atual.
5. **Falhas com diagnóstico, não tentativa cega:** registrar falha exata, separar infraestrutura de aplicação e formar hipótese antes de alterar código ou disparar novo CI. Se logs não estiverem disponíveis, marcar **BLOCKED/NOT EVALUATED**, sem conjecturar PASS ou multiplicar reruns.
6. **Testar na proporção do risco:** documentação isolada recebe revisão do diff; mudança funcional recebe teste focal e regressão afetada; auth, RLS, tenant, dados, checkout, pagamentos, storage e deploy exigem também testes negativos, isolamento e execução no ambiente correto. Não remover testes de segurança para economizar tempo.
7. **Evidência rastreável por revisão:** relacionar PASS/FAIL/NOT EVALUATED ao commit SHA, comando/workflow e ambiente. Um PASS antigo continua válido apenas para aquele escopo/revisão; não aprova código novo sem execução ou justificativa verificável de não impacto.
8. **Portões de segurança fail-closed:** proteger secrets/PII em prompts e logs; nenhuma escrita em Hosted, migration, merge, deploy, ativação de custo ou dado real de teste sem autorização explícita própria. CI descartável não constitui autorização de produção.
9. **Mudança mínima, rollback fácil:** preservar interfaces e invariantes, evitar refatorações ou dependências não exigidas, revisar o diff antes de concluir e identificar reversão quando houver risco material.
10. **Handoff compacto e sem duplicação:** atualizar apenas resultado, SHA, evidência, bloqueio e próximo passo; não republicar contexto histórico. Para mudanças relevantes, ainda cumprir ADR, arquitetura, segurança e checklist quando aplicáveis.
11. **Comunicação objetiva:** relatar o que foi alterado, validado, bloqueado e a próxima ação, sem narrar reanálise ou repetir resumos. Expor imediatamente incertezas que mudem decisão de segurança ou release.

**Ordem de prioridade:** segurança e integridade dos dados > correção funcional > testes/evidências > continuidade/reversibilidade > velocidade e economia de tokens. Nenhuma otimização pode inverter essa ordem.
