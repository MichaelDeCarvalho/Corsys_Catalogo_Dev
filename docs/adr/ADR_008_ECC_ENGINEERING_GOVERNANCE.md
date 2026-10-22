# ADR 008: Adoção Seletiva do ECC e Gate de Qualidade

## Status
**ACEITO** (2026-10-02)

## Contexto
O projeto já possui documentação viva, ADRs, registro de segurança, migrations governadas, testes de regressão específicos, Supabase com RLS e deploy frontend em Cloudflare Workers Static Assets. O guia ECC determina adoção seletiva por evidência e proíbe instalar o bundle inteiro sem necessidade.

Antes desta decisão, o `package.json` possuía comandos separados de lint/build e as suítes de regressão eram executadas individualmente. Não foi observado workflow GitHub Actions de CI no repositório.

## Problema
Era necessário adotar os benefícios de engenharia do ECC sem:
- duplicar arquitetura ou backend;
- introduzir hooks globais, MCPs ou serviços permanentes sem caso de uso;
- editar migrations aplicadas;
- acoplar CI de qualidade ao deploy;
- declarar capacidades do runtime ECC que não foram efetivamente instaladas.

## Decisão
1. Adotar o ECC como metodologia seletiva versionada neste repositório.
2. Criar `AGENTS.md` com fontes canônicas, regras de mudança mínima e comandos reais.
3. Registrar seleção e exclusões em `docs/engineering/ecc-adoption.md`.
4. Criar `bun run test:regression` e `bun run check`.
5. Criar GitHub Actions `.github/workflows/quality.yml` com:
   - execução em PR para `main`, push em `main` e manual;
   - `permissions: contents: read`;
   - zero secrets;
   - Bun 1.4.2;
   - `bun install --frozen-lockfile`;
   - `bun run check`.
6. Manter o deploy Cloudflare separado da CI de qualidade.
7. Não instalar runtime ECC completo, hooks globais, MCPs ou auto-update.

## Alternativas consideradas
- **Instalar o ECC inteiro:** rejeitado por ampliar superfície, contexto e manutenção sem benefício demonstrado.
- **Não criar CI:** rejeitado porque o projeto já possui checks reproduzíveis úteis e branch/PR é a fronteira adequada para validá-los.
- **Executar deploy no mesmo workflow de CI:** rejeitado para preservar separação de responsabilidade e reduzir privilégio/risco.

## Consequências positivas
- Um comando único para verificar o projeto.
- Regressões existentes entram em um gate reproduzível.
- PRs recebem verificação sem acesso a secrets de produção.
- Governança ECC fica explícita e reversível.

## Trade-offs / riscos
- O primeiro workflow pode revelar dependências implícitas de ambiente e falhar; isso deve ser tratado como evidência, não mascarado.
- A CI aumenta consumo de GitHub Actions conforme a política da conta.
- `AGENTS.md` só é automaticamente lido por hosts que suportem essa convenção.

## Impacto em segurança
Positivo: least privilege, zero secrets na CI e reforço de fail-closed. Nenhuma autorização do produto é alterada.

## Impacto em dados/migrations
Nenhum. Nenhuma migration ou dado é alterado.

## Plano de rollout
1. Branch dedicada.
2. Revisão por PR.
3. Executar `bun run check` localmente quando houver ambiente.
4. Observar primeiro run da GitHub Action.
5. Somente então considerar o gate remoto VERIFICADO.

## Rollback
Reverter os arquivos desta adoção e restaurar o `package.json` anterior. Não há rollback de banco.

## PR/commit relacionado
- PR: #1 — `chore: adoção seletiva do ECC e gate de qualidade`
- Branch: `chore/ecc-adoption-20261002`
- Commit de merge: registrar após merge, se necessário.
