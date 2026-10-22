# ECC ADOPTION — Corsys.Catálogo

- **Data da adoção:** 2026-10-02
- **Fonte de orientação:** `GUIA_RECURSOS_ECC.md` v1.0 e `PROMPT_IMPLANTACAO_ECC.md`
- **Modo:** adoção seletiva e incremental
- **Runtime ECC completo:** não copiado
- **Motivo:** o projeto já possui governança, ADRs, testes e controles de segurança equivalentes; o pacote-fonte ECC 2.2.2 não está versionado neste repositório. A implantação usa a metodologia do guia e registra explicitamente onde há adaptação nativa.

## Evidência observada

- React 19 + Vite 6 + TypeScript.
- Bun como package manager, com `bun.lock`.
- Supabase para Auth, PostgreSQL/RLS, Storage e Edge Functions.
- Cloudflare Workers Static Assets para frontend.
- Migrations aplicadas/congeladas e governança forward-only.
- ADRs existentes e registro de segurança existente.
- Suítes de regressão específicas em `scripts/`.
- Ausência observada de workflow GitHub Actions de CI antes desta adoção.

## Seleção ECC

| Família | Estado | Ação neste projeto |
|---|---|---|
| Mapeamento e retomada | já atendido | `PROJECT_CONTEXT`, `CURRENT_ARCHITECTURE`, README e handoff são fontes de retomada. |
| Documentação viva e decisões | já atendido / reforçado | Mantidos ADRs; handoff atualizado; referência central adicionada em `AGENTS.md`. |
| Intenção e planejamento | já atendido | ADRs e documentação de estado são usados em mudanças relevantes; sem nova cerimônia obrigatória. |
| Pesquisa e reutilização | implementado como regra | `AGENTS.md` exige pesquisar o código e documentação oficial atual antes de APIs mutáveis. |
| Padrões e arquitetura | já atendido | Preservação da arquitetura React/Vite + Supabase + Cloudflare. |
| Contratos de fronteira | já atendido parcialmente | Tipos TypeScript, validações fail-closed e gateways Supabase existentes; evoluir quando novos endpoints forem criados. |
| Qualidade estática e build | implementado | `bun run check` consolida typecheck, regressões e build. |
| Testes unitários/regressão | já atendido / integrado | Cinco suítes existentes passam a ter comando único `bun run test:regression`. |
| Fluxos de interface/navegador | adiado | Não foi observado runner E2E versionado; adotar Playwright somente quando houver fluxo crítico que justifique. |
| Acessibilidade/UX | adiado | Sem novo scanner ou gate automático nesta implantação. |
| Performance/publicação web | já atendido parcialmente | Há suíte de performance do catálogo e configuração Cloudflare existente. |
| Git, CI e entrega | implementado | GitHub Actions de qualidade em PR/push, separado do deploy Cloudflare. |
| Segurança/cadeia de dependências | já atendido / reforçado | Registro de segurança, RLS, fail-closed e least privilege já existem; CI não recebe secrets. |
| Banco e migrações | já atendido | Migrations aplicadas permanecem congeladas; evolução somente forward. |
| IA e avaliação | adiado | Dependência Gemini existe, porém esta inspeção não demonstrou um fluxo LLM crítico que justifique eval harness dedicado. |
| Custos/observabilidade | adiado | Não adicionados serviços, dashboards ou processos permanentes. |
| MCP e integrações de agente | não aplicável ao runtime | Nenhum MCP é necessário para o produto funcionar. |
| Orquestração multiagente | opcional/adiado | Sem necessidade para o runtime do produto. |
| Gestão de configuração ECC | adaptação nativa | Não foi instalado bundle ECC global/local; somente controles úteis ao repositório foram integrados. |
| Hooks do ambiente | não aplicado | Nenhum hook global ou bloqueio de editor foi instalado. |
| React/Vite | já atendido | Mantida stack atual; nenhuma migração de framework. |
| Demais famílias especializadas | não aplicável agora | Mobile, desktop, Kubernetes, mídia, trading, healthcare e outras áreas não foram introduzidas. |

## Arquivos e ativações

| Recurso | Arquivo | Ativação |
|---|---|---|
| Orientação do agente | `AGENTS.md` | Lido por hosts compatíveis; não é runtime do produto. |
| Registro de adoção | `docs/engineering/ecc-adoption.md` | Referência versionada. |
| Checklist de release | `docs/RELEASE_CHECKLIST.md` | Uso manual antes de release. |
| Verificação consolidada | `package.json` | `bun run check`. |
| CI | `.github/workflows/quality.yml` | PR para `main`, push em `main` e execução manual. |
| Decisão | `docs/adr/ADR_008_ECC_ENGINEERING_GOVERNANCE.md` | Registro arquitetural/processual. |

## Validação e limites

- A criação dos arquivos e configuração de CI é verificável no diff/PR.
- GitHub Actions Quality runs #2 e #3: **PASS** para `bun run check`.
- Evidência observada nos runs #2/#3: `bun run lint` concluiu; todas as suítes configuradas em `test:regression` concluíram; suíte principal de integração marcou **212/212**; suíte de performance marcou **34/34**; `vite build` concluiu com sucesso.
- O run #1 falhou porque os testes pré-rede encontraram a guarda de Supabase não configurado (503) antes dos cenários pretendidos. A CI foi corrigida com URL/chave **públicas sintéticas** em domínio `.invalid`, sem backend real e sem secrets; runs #2 e #3 validaram a correção e o estado final pré-merge.
- Nenhuma migration, Edge Function, configuração Supabase hosted, DNS ou deploy de produção foi alterado nesta adoção.
- Nenhum secret foi criado, copiado ou solicitado.

## Reversão

A reversão desta adoção consiste em remover os arquivos de governança/CI, restaurar os scripts anteriores do `package.json` e reverter o ADR/documentação correspondente. Não há rollback de banco porque nenhuma migration ou dado é alterado.
